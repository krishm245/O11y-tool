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
      completeVideo: vi.fn(async () => ({
        ...session,
        state: "ready" as const,
      })),
      fail: vi.fn(async () => ({ ...session, state: "failed" as const })),
      pause: vi.fn(async (request) => ({
        ...session,
        state: "paused" as const,
        activeDurationMs: request.activeDurationMs,
      })),
      resume: vi.fn(async () => ({ ...session, state: "recording" as const })),
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

  it("starts video and page events on the same active-time clock", async () => {
    const { adapters, coordinator } = buildHarness();
    const captureStart = vi.fn(async () => ({
      codec: "vp9" as const,
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
    }));
    const pageStart = vi.fn(async () => undefined);
    adapters.capture = {
      start: captureStart,
      stop: vi.fn(async () => ({
        codec: "vp9" as const,
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      })),
      isActive: vi.fn(async () => true),
    };
    adapters.pageRecorder = {
      start: pageStart,
      stop: vi.fn(async () => undefined),
    };

    await coordinator.start({
      id: 7,
      title: "Checkout",
      origin: "https://example.com",
    });

    const startedAt = Date.parse("2026-08-18T12:00:00.000Z");
    expect(captureStart).toHaveBeenCalledWith(7, "session-1", startedAt);
    expect(pageStart).toHaveBeenCalledWith(
      7,
      "session-1",
      "https://example.com",
      "2026-08-18T12:00:00.000Z",
    );
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

  it("pauses every capture source off-origin and resumes on the same clock", async () => {
    const { adapters, coordinator, setNow } = buildHarness();
    const capturePause = vi.fn(async () => undefined);
    const captureResume = vi.fn(async () => undefined);
    const pageStart = vi.fn(async () => undefined);
    const pageStop = vi.fn(async () => undefined);
    adapters.capture = {
      start: vi.fn(async () => ({
        codec: "vp9" as const,
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      })),
      stop: vi.fn(async () => ({
        codec: "vp9" as const,
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      })),
      isActive: vi.fn(async () => true),
      pause: capturePause,
      resume: captureResume,
    };
    adapters.pageRecorder = { start: pageStart, stop: pageStop };
    await coordinator.start({
      id: 7,
      title: "Checkout",
      origin: "https://example.com",
    });
    pageStart.mockClear();

    setNow(Date.parse("2026-08-18T12:00:10.000Z"));
    const paused = await coordinator.pauseForOrigin(7);
    expect(capturePause).toHaveBeenCalledBefore(pageStop);
    expect(adapters.sessions.pause).toHaveBeenCalledWith(
      expect.objectContaining({ activeDurationMs: 10_000 }),
    );
    expect(paused).toMatchObject({
      clock: { pausedAtWallTime: Date.parse("2026-08-18T12:00:10.000Z") },
    });

    setNow(Date.parse("2026-08-18T12:00:25.000Z"));
    await coordinator.resumeForOrigin(7);
    expect(captureResume).toHaveBeenCalledBefore(pageStart);
    expect(pageStart).toHaveBeenLastCalledWith(
      7,
      "session-1",
      "https://example.com",
      "2026-08-18T12:00:25.000Z",
      10_000,
    );

    setNow(Date.parse("2026-08-18T12:00:30.000Z"));
    await coordinator.stop();
    expect(adapters.sessions.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ activeDurationMs: 15_000 }),
    );
  });

  it("stops capture, finalizes metadata, and completes video in order", async () => {
    const { adapters, coordinator } = buildHarness();
    const order: string[] = [];
    const capture: NonNullable<RecordingCoordinatorAdapters["capture"]> = {
      start: vi.fn(async () => ({
        codec: "vp9" as const,
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      })),
      stop: vi.fn(async () => {
        order.push("capture");
        return {
          codec: "vp9" as const,
          viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
        };
      }),
      isActive: vi.fn(async () => true),
    };
    adapters.capture = capture;
    vi.mocked(adapters.sessions.finalize).mockImplementation(async () => {
      order.push("finalize");
      return { ...buildHarness().session, state: "processing" };
    });
    vi.mocked(adapters.sessions.completeVideo!).mockImplementation(async () => {
      order.push("complete");
      return { ...buildHarness().session, state: "ready" };
    });

    await coordinator.start({
      id: 7,
      title: "Checkout",
      origin: "https://example.com",
    });
    await Promise.all([coordinator.stop(), coordinator.stop()]);

    expect(order).toEqual(["capture", "finalize", "complete"]);
    expect(capture.stop).toHaveBeenCalledOnce();
    expect(adapters.sessions.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        codec: "vp9",
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      }),
    );
  });

  it("finalizes when the page recorder is no longer available", async () => {
    const { adapters, coordinator } = buildHarness();
    const captureStop = vi.fn(async () => ({
      codec: "vp9" as const,
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
    }));
    adapters.capture = {
      start: vi.fn(async () => ({
        codec: "vp9" as const,
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      })),
      stop: captureStop,
      isActive: vi.fn(async () => true),
    };
    adapters.pageRecorder = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => {
        throw new Error("The page recorder did not stop");
      }),
    };

    await coordinator.start({
      id: 7,
      title: "Checkout",
      origin: "https://example.com",
    });

    await expect(coordinator.stop()).resolves.toEqual({ status: "idle" });
    expect(captureStop).toHaveBeenCalledOnce();
    expect(adapters.sessions.finalize).toHaveBeenCalledOnce();
    expect(adapters.sessions.completeVideo).toHaveBeenCalledOnce();
    await expect(coordinator.get()).resolves.toEqual({ status: "idle" });
  });

  it("marks the Session failed when capture cannot flush its chunks", async () => {
    const { adapters, coordinator } = buildHarness();
    adapters.capture = {
      start: vi.fn(async () => ({
        codec: "vp8" as const,
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      })),
      stop: vi.fn(async () => {
        throw new Error("Video chunk upload failed");
      }),
      isActive: vi.fn(async () => true),
    };
    await coordinator.start({
      id: 7,
      title: "Checkout",
      origin: "https://example.com",
    });

    await expect(coordinator.stop()).resolves.toEqual({ status: "idle" });
    expect(adapters.sessions.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "capture_stop_failed",
        message: "Video chunk upload failed",
      }),
    );
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

  it("stops capture and retries finalization after an API failure", async () => {
    const { adapters, coordinator } = buildHarness();
    await coordinator.start({
      id: 7,
      title: "Checkout",
      origin: "https://example.com",
    });
    vi.mocked(adapters.sessions.finalize).mockRejectedValueOnce(
      new Error("API unavailable"),
    );

    await expect(coordinator.stop()).resolves.toMatchObject({
      status: "finalizing",
      session: { id: "session-1" },
    });
    await expect(coordinator.recover()).resolves.toEqual({ status: "idle" });
    expect(adapters.sessions.finalize).toHaveBeenCalledTimes(2);
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

  it("finishes video assembly after a service-worker restart", async () => {
    const source = buildHarness();
    const recording: RecordingState = {
      status: "recording",
      tabId: 7,
      session: source.session,
      clock: { startedAtWallTime: Date.parse("2026-08-18T12:00:00.000Z") },
      capture: {
        codec: "vp9",
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      },
    };
    const { adapters, coordinator } = buildHarness(recording);
    vi.mocked(adapters.sessions.get).mockResolvedValueOnce({
      ...source.session,
      state: "processing",
      codec: "vp9",
      timestamps: {
        ...source.session.timestamps,
        recordingEndedAt: "2026-08-18T12:00:10.000Z",
        processingStartedAt: "2026-08-18T12:00:10.000Z",
      },
    });

    await expect(coordinator.recover()).resolves.toEqual({ status: "idle" });
    expect(adapters.sessions.completeVideo).toHaveBeenCalledWith("session-1");
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
