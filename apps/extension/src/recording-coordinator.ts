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
  pauseSessionClock,
  resumeSessionClock,
  startSessionClock,
  type SessionClockSnapshot,
} from "@app-o11y/session-clock";
import type {
  CaptureMetadata,
  RecordingCommand,
  TabSummary,
} from "./browser-messages";

export const RECORDING_STORAGE_KEY = "recording-session";

export type RecordingState =
  | { status: "idle" }
  | {
      status: "recording";
      tabId: number;
      session: SessionManifest;
      clock: SessionClockSnapshot;
      capture?: CaptureMetadata;
    }
  | {
      status: "finalizing";
      tabId: number;
      session: SessionManifest;
      clock: SessionClockSnapshot;
      stoppedAtWallTime: number;
      capture?: CaptureMetadata;
    };

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
    pause?(request: {
      schemaVersion: typeof SESSION_SCHEMA_VERSION;
      sessionId: string;
      pausedAt: string;
      activeDurationMs: number;
    }): Promise<SessionManifest>;
    resume?(request: {
      schemaVersion: typeof SESSION_SCHEMA_VERSION;
      sessionId: string;
      resumedAt: string;
    }): Promise<SessionManifest>;
  };
  capture?: {
    start(
      tabId: number,
      sessionId: string,
      startedAtWallTime: number,
    ): Promise<CaptureMetadata>;
    stop(sessionId: string): Promise<CaptureMetadata>;
    isActive(sessionId: string): Promise<boolean>;
    pause?(sessionId: string): Promise<void>;
    resume?(sessionId: string): Promise<void>;
  };
  pageRecorder?: {
    start(
      tabId: number,
      sessionId: string,
      origin: string,
      recordingStartedAt: string,
      activeTimeOffsetMs?: number,
    ): Promise<void>;
    stop(tabId: number, sessionId: string): Promise<void>;
  };
  tabs: {
    exists(tabId: number): Promise<boolean>;
  };
  uploads?: { flush(sessionId: string): Promise<void> };
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
    (candidate.status === "recording" ||
      (candidate.status === "finalizing" &&
        typeof candidate.stoppedAtWallTime === "number" &&
        Number.isFinite(candidate.stoppedAtWallTime))) &&
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
    if (current.status !== "idle") return current;

    const session = await adapters.sessions.create({
      schemaVersion: SESSION_SCHEMA_VERSION,
      privacyVersion: PRIVACY_POLICY_VERSION,
      origin: tab.origin,
      title: tab.title,
    });
    const clock = startSessionClock(now());
    let capture: CaptureMetadata | undefined;
    try {
      capture = await adapters.capture?.start(
        tab.id,
        session.id,
        clock.startedAtWallTime,
      );
      await adapters.pageRecorder?.start(
        tab.id,
        session.id,
        session.origin,
        new Date(clock.startedAtWallTime).toISOString(),
      );
    } catch (error) {
      if (capture !== undefined) {
        await adapters.capture?.stop(session.id).catch(() => undefined);
      }
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
      clock,
      ...(capture === undefined ? {} : { capture }),
    };

    return persist(state);
  }

  async function stopCapture(
    current: Extract<RecordingState, { status: "recording" }>,
  ): Promise<Extract<RecordingState, { status: "finalizing" }>> {
    const stoppedAt = now();
    let capture = current.capture;
    try {
      await adapters.pageRecorder?.stop(current.tabId, current.session.id);
    } catch {
      // A navigation or extension reload can remove the page recorder while the
      // tab and video capture are still active. Its shutdown is best effort so
      // it cannot prevent the remaining capture from being saved.
    }
    if (adapters.capture !== undefined) {
      try {
        capture = await adapters.capture.stop(current.session.id);
      } catch (error) {
        throw new CaptureStopError(error);
      }
    }
    const finalizing: Extract<RecordingState, { status: "finalizing" }> = {
      ...current,
      status: "finalizing",
      stoppedAtWallTime: stoppedAt,
      ...(capture === undefined ? {} : { capture }),
    };
    await persist(finalizing);
    return finalizing;
  }

  async function completeFinalization(
    current: Extract<RecordingState, { status: "finalizing" }>,
  ): Promise<void> {
    await adapters.uploads?.flush(current.session.id);
    await adapters.sessions.finalize({
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: current.session.id,
      recordingEndedAt: new Date(current.stoppedAtWallTime).toISOString(),
      activeDurationMs: activeTimeAt(current.clock, current.stoppedAtWallTime),
      viewport: current.capture?.viewport ?? current.session.viewport,
      codec: current.capture?.codec ?? current.session.codec,
    });
    if (current.capture !== undefined) {
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
    let current = await get();
    if (current.status === "idle") return persist(idle);

    if (current.status === "recording") {
      try {
        current = await stopCapture(current);
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
        return persist(idle);
      }
    }
    try {
      await completeFinalization(current);
      return persist(idle);
    } catch {
      return persist(current);
    }
  }

  async function closeTab(tabId: number): Promise<void> {
    const current = await get();
    if (current.status !== "idle" && current.tabId === tabId) {
      await stop();
    }
  }

  async function pauseForOrigin(tabId: number): Promise<RecordingState> {
    const current = await get();
    if (
      current.status !== "recording" ||
      current.tabId !== tabId ||
      current.clock.pausedAtWallTime != null
    ) {
      return current;
    }
    const pausedAt = now();
    const clock = pauseSessionClock(current.clock, pausedAt);
    await adapters.capture?.pause?.(current.session.id);
    try {
      await adapters.pageRecorder?.stop(tabId, current.session.id);
    } catch {
      // Full-page navigation may have already removed the content script.
    }
    await persist({ ...current, clock });
    const session =
      (await adapters.sessions.pause?.({
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: current.session.id,
        pausedAt: new Date(pausedAt).toISOString(),
        activeDurationMs: activeTimeAt(clock, pausedAt),
      })) ?? current.session;
    return persist({ ...current, session, clock });
  }

  async function resumeForOrigin(tabId: number): Promise<RecordingState> {
    const current = await get();
    if (
      current.status !== "recording" ||
      current.tabId !== tabId ||
      current.clock.pausedAtWallTime == null
    ) {
      return current;
    }
    const resumedAt = now();
    const clock = resumeSessionClock(current.clock, resumedAt);
    const session =
      (await adapters.sessions.resume?.({
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: current.session.id,
        resumedAt: new Date(resumedAt).toISOString(),
      })) ?? current.session;
    const resumed = await persist({ ...current, session, clock });
    await adapters.capture?.resume?.(current.session.id);
    await adapters.pageRecorder?.start(
      tabId,
      current.session.id,
      current.session.origin,
      new Date(resumedAt).toISOString(),
      activeTimeAt(clock, resumedAt),
    );
    return resumed;
  }

  async function fail(code: string, message: string): Promise<RecordingState> {
    const current = await get();
    if (current.status === "idle") return persist(idle);
    const failedAt = now();
    try {
      await adapters.pageRecorder?.stop(current.tabId, current.session.id);
    } catch {
      // The page may already be gone when capture failure reaches us.
    }
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

    if (current.status === "finalizing") {
      try {
        const session = await adapters.sessions.get(current.session.id);
        if (
          session === null ||
          session.state === "ready" ||
          session.state === "incomplete" ||
          session.state === "failed"
        ) {
          return persist(idle);
        }
        if (session.state === "processing") {
          await adapters.sessions.completeVideo?.(session.id);
        } else {
          await completeFinalization({ ...current, session });
        }
        return persist(idle);
      } catch {
        return persist(current);
      }
    }

    const [foundSession, tabExists] = await Promise.all([
      adapters.sessions.get(current.session.id),
      adapters.tabs.exists(current.tabId),
    ]);

    if (
      foundSession === null ||
      (foundSession.state !== "recording" &&
        foundSession.state !== "paused" &&
        foundSession.state !== "processing")
    ) {
      return persist(idle);
    }

    if (foundSession.state === "processing") {
      if (adapters.sessions.completeVideo === undefined) return persist(idle);
      await adapters.sessions.completeVideo(foundSession.id);
      return persist(idle);
    }

    const session =
      current.clock.pausedAtWallTime != null &&
      foundSession.state === "recording" &&
      adapters.sessions.pause !== undefined
        ? await adapters.sessions.pause({
            schemaVersion: SESSION_SCHEMA_VERSION,
            sessionId: foundSession.id,
            pausedAt: new Date(current.clock.pausedAtWallTime).toISOString(),
            activeDurationMs: activeTimeAt(
              current.clock,
              current.clock.pausedAtWallTime,
            ),
          })
        : foundSession;

    if (adapters.capture !== undefined) {
      const captureIsActive = await adapters.capture.isActive(session.id);
      if (
        !captureIsActive &&
        (session.state === "recording" || session.state === "paused")
      ) {
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

    if (
      tabExists &&
      session.state === "recording" &&
      current.clock.pausedAtWallTime == null
    ) {
      await adapters.pageRecorder?.start(
        current.tabId,
        session.id,
        session.origin,
        new Date(current.clock.startedAtWallTime).toISOString(),
      );
    }

    const recovered = { ...current, session };
    if (!tabExists) {
      const finalizing = await stopCapture(recovered);
      await completeFinalization(finalizing);
      return persist(idle);
    }

    return persist(recovered);
  }

  async function handleMessage(
    message: RecordingCommand,
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

  return {
    closeTab,
    fail,
    get,
    handleMessage,
    pauseForOrigin,
    recover,
    resumeForOrigin,
    start,
    stop,
  };
}
