import { describe, expect, it, vi } from "vitest";
import {
  PRIVACY_POLICY_VERSION,
  SESSION_SCHEMA_VERSION,
  type SessionManifest,
} from "@app-o11y/protocol";
import {
  createRecordingCoordinator,
  type RecordingCoordinatorAdapters,
  type RecordingState,
} from "./recording-coordinator";

function buildHarness(initial: unknown = { status: "idle" }) {
  let stored: unknown = initial;
  let now = Date.parse("2026-08-18T12:00:00.000Z");
  const session: SessionManifest = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    privacyVersion: PRIVACY_POLICY_VERSION,
    id: "session-1",
    origin: "https://example.com",
    title: "Checkout",
    state: "recording",
    timestamps: {
      createdAt: "2026-08-18T12:00:00.000Z",
      recordingStartedAt: "2026-08-18T12:00:00.000Z",
      recordingEndedAt: null,
      processingStartedAt: null,
      processingEndedAt: null,
    },
    activeDurationMs: 0,
    viewport: null,
    codec: null,
    artifactSizes: { videoBytes: 0, eventsBytes: 0, totalBytes: 0 },
    failure: null,
  };
  const indicator = vi.fn<(isRecording: boolean) => Promise<void>>(
    async () => undefined,
  );
  const adapters: RecordingCoordinatorAdapters = {
    state: {
      read: async () => stored,
      write: async (state: RecordingState) => {
        stored = state;
      },
    },
    indicator: { setRecording: indicator },
    sessions: {
      create: vi.fn(async () => session),
      finalize: vi.fn(async () => ({ ...session, state: "ready" as const })),
      get: vi.fn(async () => session),
    },
    tabs: { exists: vi.fn(async () => true) },
    now: () => now,
  };

  return {
    adapters,
    coordinator: createRecordingCoordinator(adapters),
    indicator,
    session,
    setNow(value: number) {
      now = value;
    },
  };
}

describe("recording coordination", () => {
  it("creates and persists one recording Session", async () => {
    const { adapters, coordinator, indicator } = buildHarness();
    const state = await coordinator.start({
      id: 7,
      title: "Checkout",
      origin: "https://example.com",
    });

    expect(adapters.sessions.create).toHaveBeenCalledWith({
      schemaVersion: SESSION_SCHEMA_VERSION,
      privacyVersion: PRIVACY_POLICY_VERSION,
      title: "Checkout",
      origin: "https://example.com",
    });
    expect(state).toMatchObject({
      status: "recording",
      tabId: 7,
      session: { id: "session-1" },
      clock: { startedAtWallTime: Date.parse("2026-08-18T12:00:00.000Z") },
    });
    expect(indicator).toHaveBeenCalledWith(true);
  });

  it("makes repeated starts idempotent", async () => {
    const { adapters, coordinator } = buildHarness();
    const tab = { id: 7, title: "Checkout", origin: "https://example.com" };

    await coordinator.start(tab);
    await coordinator.start(tab);

    expect(adapters.sessions.create).toHaveBeenCalledTimes(1);
  });

  it("finalizes before clearing a stopped Session", async () => {
    const { adapters, coordinator, indicator, setNow } = buildHarness();
    await coordinator.start({
      id: 7,
      title: "Checkout",
      origin: "https://example.com",
    });
    setNow(Date.parse("2026-08-18T12:00:12.000Z"));

    await coordinator.stop();

    expect(adapters.sessions.finalize).toHaveBeenCalledWith({
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: "session-1",
      recordingEndedAt: "2026-08-18T12:00:12.000Z",
      activeDurationMs: 12_000,
      viewport: null,
      codec: null,
    });
    await expect(coordinator.get()).resolves.toEqual({ status: "idle" });
    expect(indicator).toHaveBeenLastCalledWith(false);
  });

  it("finalizes when the owned tab closes", async () => {
    const { adapters, coordinator } = buildHarness();
    await coordinator.start({
      id: 7,
      title: "Checkout",
      origin: "https://example.com",
    });

    await coordinator.closeTab(7);

    expect(adapters.sessions.finalize).toHaveBeenCalledOnce();
    await expect(coordinator.get()).resolves.toEqual({ status: "idle" });
  });

  it("keeps recoverable state when finalization fails", async () => {
    const { adapters, coordinator } = buildHarness();
    await coordinator.start({
      id: 7,
      title: "Checkout",
      origin: "https://example.com",
    });
    vi.mocked(adapters.sessions.finalize).mockRejectedValueOnce(
      new Error("API unavailable"),
    );

    await expect(coordinator.stop()).rejects.toThrow("API unavailable");
    await expect(coordinator.get()).resolves.toMatchObject({
      status: "recording",
      session: { id: "session-1" },
    });
  });

  it("recovers an active Session and restores its indicator", async () => {
    const recording: RecordingState = {
      status: "recording",
      tabId: 7,
      session: buildHarness().session,
      clock: { startedAtWallTime: Date.parse("2026-08-18T12:00:00.000Z") },
    };
    const { coordinator, indicator } = buildHarness(recording);

    await expect(coordinator.recover()).resolves.toEqual(recording);
    expect(indicator).toHaveBeenLastCalledWith(true);
  });

  it("keeps persisted state when an active Session lookup fails", async () => {
    const source = buildHarness();
    const recording: RecordingState = {
      status: "recording",
      tabId: 7,
      session: source.session,
      clock: { startedAtWallTime: Date.parse("2026-08-18T12:00:00.000Z") },
    };
    const { adapters, coordinator } = buildHarness(recording);
    vi.mocked(adapters.sessions.get).mockRejectedValueOnce(
      new Error("API unavailable"),
    );

    await expect(coordinator.recover()).rejects.toThrow("API unavailable");
    await expect(coordinator.get()).resolves.toEqual(recording);
  });

  it("clears local state when the API Session is already complete", async () => {
    const source = buildHarness();
    const recording: RecordingState = {
      status: "recording",
      tabId: 7,
      session: source.session,
      clock: { startedAtWallTime: Date.parse("2026-08-18T12:00:00.000Z") },
    };
    const { adapters, coordinator } = buildHarness(recording);
    vi.mocked(adapters.sessions.get).mockResolvedValueOnce({
      ...source.session,
      state: "ready",
    });

    await expect(coordinator.recover()).resolves.toEqual({ status: "idle" });
    expect(adapters.sessions.finalize).not.toHaveBeenCalled();
  });

  it("finalizes a recovered Session whose tab no longer exists", async () => {
    const source = buildHarness();
    const recording: RecordingState = {
      status: "recording",
      tabId: 7,
      session: source.session,
      clock: { startedAtWallTime: Date.parse("2026-08-18T12:00:00.000Z") },
    };
    const { adapters, coordinator } = buildHarness(recording);
    vi.mocked(adapters.tabs.exists).mockResolvedValueOnce(false);

    await expect(coordinator.recover()).resolves.toEqual({ status: "idle" });
    expect(adapters.sessions.finalize).toHaveBeenCalledOnce();
  });

  it("recovers invalid persisted state as idle", async () => {
    const { coordinator } = buildHarness({ status: "recording", tabId: "bad" });
    await expect(coordinator.get()).resolves.toEqual({ status: "idle" });
  });
});
