import {
  PRIVACY_POLICY_VERSION,
  SESSION_SCHEMA_VERSION,
  isSessionManifest,
  type CreateSessionRequest,
  type FinalizeSessionRequest,
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
  };
  tabs: {
    exists(tabId: number): Promise<boolean>;
  };
  now?: () => number;
};

function isRecordingState(value: unknown): value is RecordingState {
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
    const state: RecordingState = {
      status: "recording",
      tabId: tab.id,
      session,
      clock: startSessionClock(now()),
    };

    return persist(state);
  }

  async function finalize(
    current: Extract<RecordingState, { status: "recording" }>,
  ): Promise<void> {
    const stoppedAt = now();
    await adapters.sessions.finalize({
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: current.session.id,
      recordingEndedAt: new Date(stoppedAt).toISOString(),
      activeDurationMs: activeTimeAt(current.clock, stoppedAt),
      viewport: current.session.viewport,
      codec: current.session.codec,
    });
  }

  async function stop(): Promise<RecordingState> {
    const current = await get();
    if (current.status === "idle") return persist(idle);

    await finalize(current);
    return persist(idle);
  }

  async function closeTab(tabId: number): Promise<void> {
    const current = await get();
    if (current.status === "recording" && current.tabId === tabId) {
      await stop();
    }
  }

  async function recover(): Promise<RecordingState> {
    const current = await get();
    if (current.status === "idle") return persist(idle);

    const [session, tabExists] = await Promise.all([
      adapters.sessions.get(current.session.id),
      adapters.tabs.exists(current.tabId),
    ]);

    if (session === null || session.state !== "recording") {
      return persist(idle);
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

  return { closeTab, get, handleMessage, recover, start, stop };
}
