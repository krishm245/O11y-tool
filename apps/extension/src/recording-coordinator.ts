import {
  PRIVACY_POLICY_VERSION,
  SESSION_SCHEMA_VERSION,
  isSessionManifest,
  type CreateSessionRequest,
  type FinalizeSessionRequest,
  type FailSessionRequest,
  type SessionManifest,
} from "@app-o11y/protocol";
import {
  activeTimeAt,
  isSessionClockSnapshot,
  startSessionClock,
  type SessionClockSnapshot,
} from "@app-o11y/session-clock";

export const RECORDING_STORAGE_KEY = "recording-session";

export type TabSummary = {
  id: number;
  title: string;
  origin: string;
};

export type RecordingState =
  | { status: "idle" }
  | {
      status: "recording";
      tabId: number;
      session: SessionManifest;
      clock: SessionClockSnapshot;
      capture?: CaptureMetadata;
    };

export type CaptureMetadata = {
  codec: "vp9" | "vp8";
  viewport: { width: number; height: number; devicePixelRatio: number };
};

export type RecordingMessage =
  | { type: "recording:get" }
  | { type: "recording:start"; tab: TabSummary }
  | { type: "recording:stop" };

export type RecordingCoordinatorAdapters = {
  state: {
    read(): Promise<unknown>;
    write(state: RecordingState): Promise<void>;
  };
  indicator: {
    setRecording(isRecording: boolean): Promise<void>;
  };
  sessions: {
    create(request: CreateSessionRequest): Promise<SessionManifest>;
    finalize(request: FinalizeSessionRequest): Promise<SessionManifest>;
    get(sessionId: string): Promise<SessionManifest | null>;
    completeVideo?(sessionId: string): Promise<SessionManifest>;
    fail?(request: FailSessionRequest): Promise<SessionManifest>;
  };
  capture?: {
    start(tabId: number, sessionId: string): Promise<CaptureMetadata>;
    stop(sessionId: string): Promise<CaptureMetadata>;
    isActive(sessionId: string): Promise<boolean>;
  };
  tabs: {
    exists(tabId: number): Promise<boolean>;
  };
  now?: () => number;
};

class CaptureStopError extends Error {
  constructor(error: unknown) {
    super(
      error instanceof Error ? error.message : "Tab capture failed to stop",
    );
    this.name = "CaptureStopError";
  }
}

export function isRecordingState(value: unknown): value is RecordingState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RecordingState>;

  if (candidate.status === "idle") return true;
  return (
    candidate.status === "recording" &&
    typeof candidate.tabId === "number" &&
    isSessionManifest(candidate.session) &&
    isSessionClockSnapshot(candidate.clock)
  );
}

export function createRecordingCoordinator(
  adapters: RecordingCoordinatorAdapters,
) {
  const idle: RecordingState = { status: "idle" };
  const now = adapters.now ?? Date.now;
  let stopInFlight: Promise<RecordingState> | null = null;

  async function get(): Promise<RecordingState> {
    const stored = await adapters.state.read();
    return isRecordingState(stored) ? stored : idle;
  }

  async function persist(state: RecordingState): Promise<RecordingState> {
    await adapters.state.write(state);
    await adapters.indicator.setRecording(state.status === "recording");
    return state;
  }

  async function start(tab: TabSummary): Promise<RecordingState> {
    const current = await get();
    if (current.status === "recording") return current;

    const session = await adapters.sessions.create({
      schemaVersion: SESSION_SCHEMA_VERSION,
      privacyVersion: PRIVACY_POLICY_VERSION,
      origin: tab.origin,
      title: tab.title,
    });
    let capture: CaptureMetadata | undefined;
    try {
      capture = await adapters.capture?.start(tab.id, session.id);
    } catch (error) {
      const failedAt = now();
      await adapters.sessions.fail?.({
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: session.id,
        failedAt: new Date(failedAt).toISOString(),
        activeDurationMs: 0,
        code: "capture_start_failed",
        message:
          error instanceof Error
            ? error.message
            : "Tab capture failed to start.",
      });
      await persist(idle);
      throw error;
    }
    const state: RecordingState = {
      status: "recording",
      tabId: tab.id,
      session,
      clock: startSessionClock(now()),
      ...(capture === undefined ? {} : { capture }),
    };

    return persist(state);
  }

  async function finalize(
    current: Extract<RecordingState, { status: "recording" }>,
  ): Promise<void> {
    const stoppedAt = now();
    let capture = current.capture;
    if (adapters.capture !== undefined) {
      try {
        capture = await adapters.capture.stop(current.session.id);
      } catch (error) {
        throw new CaptureStopError(error);
      }
    }
    await adapters.sessions.finalize({
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: current.session.id,
      recordingEndedAt: new Date(stoppedAt).toISOString(),
      activeDurationMs: activeTimeAt(current.clock, stoppedAt),
      viewport: capture?.viewport ?? current.session.viewport,
      codec: capture?.codec ?? current.session.codec,
    });
    if (capture !== undefined) {
      await adapters.sessions.completeVideo?.(current.session.id);
    }
  }

  async function stop(): Promise<RecordingState> {
    if (stopInFlight !== null) return stopInFlight;
    stopInFlight = stopOnce();
    try {
      return await stopInFlight;
    } finally {
      stopInFlight = null;
    }
  }

  async function stopOnce(): Promise<RecordingState> {
    const current = await get();
    if (current.status === "idle") return persist(idle);

    try {
      await finalize(current);
    } catch (error) {
      if (!(error instanceof CaptureStopError)) throw error;
      if (adapters.sessions.fail === undefined) throw error;
      const failedAt = now();
      await adapters.sessions.fail({
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: current.session.id,
        failedAt: new Date(failedAt).toISOString(),
        activeDurationMs: activeTimeAt(current.clock, failedAt),
        code: "capture_stop_failed",
        message: error.message,
      });
    }
    return persist(idle);
  }

  async function closeTab(tabId: number): Promise<void> {
    const current = await get();
    if (current.status === "recording" && current.tabId === tabId) {
      await stop();
    }
  }

  async function fail(code: string, message: string): Promise<RecordingState> {
    const current = await get();
    if (current.status === "idle") return persist(idle);
    const failedAt = now();
    try {
      await adapters.capture?.stop(current.session.id);
    } catch {
      // The failure may be the capture stream itself, so stopping is best effort.
    }
    await adapters.sessions.fail?.({
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: current.session.id,
      failedAt: new Date(failedAt).toISOString(),
      activeDurationMs: activeTimeAt(current.clock, failedAt),
      code,
      message,
    });
    return persist(idle);
  }

  async function recover(): Promise<RecordingState> {
    const current = await get();
    if (current.status === "idle") return persist(idle);

    const [session, tabExists] = await Promise.all([
      adapters.sessions.get(current.session.id),
      adapters.tabs.exists(current.tabId),
    ]);

    if (
      session === null ||
      (session.state !== "recording" && session.state !== "processing")
    ) {
      return persist(idle);
    }

    if (session.state === "processing") {
      if (adapters.sessions.completeVideo === undefined) return persist(idle);
      await adapters.sessions.completeVideo(session.id);
      return persist(idle);
    }

    if (adapters.capture !== undefined) {
      const captureIsActive = await adapters.capture.isActive(session.id);
      if (!captureIsActive && session.state === "recording") {
        const failedAt = now();
        await adapters.sessions.fail?.({
          schemaVersion: SESSION_SCHEMA_VERSION,
          sessionId: session.id,
          failedAt: new Date(failedAt).toISOString(),
          activeDurationMs: activeTimeAt(current.clock, failedAt),
          code: "capture_interrupted",
          message: "Chrome stopped the tab capture stream.",
        });
        return persist(idle);
      }
    }

    const recovered = { ...current, session };
    if (!tabExists) {
      await finalize(recovered);
      return persist(idle);
    }

    return persist(recovered);
  }

  async function handleMessage(
    message: RecordingMessage,
  ): Promise<RecordingState> {
    switch (message.type) {
      case "recording:get":
        return get();
      case "recording:start":
        return start(message.tab);
      case "recording:stop":
        return stop();
    }
  }

  return { closeTab, fail, get, handleMessage, recover, start, stop };
}
