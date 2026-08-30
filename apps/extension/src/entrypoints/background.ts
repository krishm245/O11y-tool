import {
  LOCAL_API_ORIGIN,
  PRIVACY_POLICY_VERSION,
  ARTIFACT_CHUNK_SCHEMA_VERSION,
  TIMELINE_EVENT_SCHEMA_VERSION,
  SESSION_COLLECTION_PATH,
  SESSION_EVENT_CHUNK_PATH,
  SESSION_FINALIZE_PATH,
  SESSION_FAIL_PATH,
  SESSION_ITEM_PATH,
  SESSION_PAUSE_PATH,
  SESSION_RESUME_PATH,
  SESSION_SCHEMA_VERSION,
  SESSION_VIDEO_COMPLETE_PATH,
  parseCompleteVideoResponse,
  parseFailSessionResponse,
  parseFinalizeSessionResponse,
  parseGetSessionResponse,
  parsePauseSessionResponse,
  parseResumeSessionResponse,
  parseSessionManifest,
  parseTimelineEvent,
  type CreateSessionRequest,
  type FinalizeSessionRequest,
  type FailSessionRequest,
  type EventBatch,
  type TimelineEvent,
  type PauseSessionRequest,
  type ResumeSessionRequest,
} from "@app-o11y/protocol";
import {
  RECORDING_STORAGE_KEY,
  createRecordingCoordinator,
  type RecordingState,
} from "../recording-coordinator";
import {
  isAppendEventsMessage,
  isCaptureEndedMessage,
  isCaptureResponse,
  isCommandResponse,
  isRecordingCommand,
  type CaptureCommand,
  type CommandResponse,
  type PageRecorderCommand,
} from "../browser-messages";
import { drainUploads, enqueueUpload, flushUploads } from "../upload-queue";

const EVENT_SEQUENCE_PREFIX = "event-sequence:";
const eventUploadQueues = new Map<string, Promise<void>>();

async function createSession(request: CreateSessionRequest) {
  const response = await fetch(
    `${LOCAL_API_ORIGIN}${SESSION_COLLECTION_PATH}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  if (!response.ok) {
    throw new Error(`Session creation failed: ${response.status}`);
  }

  return parseSessionManifest(await response.json());
}

function sessionPath(path: string, sessionId: string) {
  return path.replace(":sessionId", encodeURIComponent(sessionId));
}

function eventChunkPath(sessionId: string, sequence: number) {
  return sessionPath(SESSION_EVENT_CHUNK_PATH, sessionId).replace(
    ":sequence",
    String(sequence),
  );
}

async function gzip(value: unknown): Promise<ArrayBuffer> {
  const input = new Blob([JSON.stringify(value)]).stream();
  return new Response(
    input.pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
}

async function checksum(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function appendEvents(sessionId: string, input: unknown[]) {
  const events = input
    .map(parseTimelineEvent)
    .sort(
      (left, right) =>
        left.activeTimeMs - right.activeTimeMs ||
        Date.parse(left.wallTime) - Date.parse(right.wallTime) ||
        left.id.localeCompare(right.id),
    );
  if (
    events.length === 0 ||
    events.some((event) => event.sessionId !== sessionId)
  ) {
    throw new Error("The event batch does not match the active Session");
  }
  const sequenceKey = `${EVENT_SEQUENCE_PREFIX}${sessionId}`;
  const stored = await browser.storage.local.get(sequenceKey);
  const sequence = Number.isSafeInteger(stored[sequenceKey])
    ? Number(stored[sequenceKey])
    : 0;
  const batch: EventBatch = {
    schemaVersion: TIMELINE_EVENT_SCHEMA_VERSION,
    privacyVersion: PRIVACY_POLICY_VERSION,
    sessionId,
    sequence,
    events,
  };
  const bytes = await gzip(batch);
  const digest = await checksum(bytes);
  await enqueueUpload({
    sessionId,
    kind: "events",
    sequence,
    checksum: digest,
    path: eventChunkPath(sessionId, sequence),
    headers: {
      "content-type": "application/gzip",
      "x-o11y-schema-version": String(ARTIFACT_CHUNK_SCHEMA_VERSION),
      "x-o11y-active-start-ms": String(events[0]!.activeTimeMs),
      "x-o11y-active-end-ms": String(events[events.length - 1]!.activeTimeMs),
      "x-o11y-checksum": digest,
    },
    body: bytes,
  });
  await browser.storage.local.set({ [sequenceKey]: sequence + 1 });
  void drainUploads().catch(() => undefined);
}

function queueEvents(sessionId: string, events: unknown[]) {
  const queued = (eventUploadQueues.get(sessionId) ?? Promise.resolve()).then(
    () => appendEvents(sessionId, events),
  );
  const tracked = queued.finally(() => {
    if (eventUploadQueues.get(sessionId) === tracked) {
      eventUploadQueues.delete(sessionId);
    }
  });
  eventUploadQueues.set(sessionId, tracked);
  return queued;
}

async function resumeOriginWithMarker(
  state: Extract<RecordingState, { status: "recording" }>,
) {
  const pausedAt = state.clock.pausedAtWallTime;
  if (pausedAt == null) return state;
  const resumed = await coordinator.resumeForOrigin(state.tabId);
  const resumedAt = Date.now();
  if (resumed.status === "recording") {
    await queueEvents(resumed.session.id, [
      {
        schemaVersion: TIMELINE_EVENT_SCHEMA_VERSION,
        id: crypto.randomUUID(),
        sessionId: resumed.session.id,
        activeTimeMs: resumed.session.activeDurationMs,
        wallTime: new Date(resumedAt).toISOString(),
        category: "lifecycle",
        type: "paused-interval",
        data: {
          pausedAt: new Date(pausedAt).toISOString(),
          resumedAt: new Date(resumedAt).toISOString(),
          wallDurationMs: Math.max(0, resumedAt - pausedAt),
        },
      },
    ]);
  }
  return resumed;
}

async function getSession(sessionId: string) {
  const response = await fetch(
    `${LOCAL_API_ORIGIN}${sessionPath(SESSION_ITEM_PATH, sessionId)}`,
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Session lookup failed: ${response.status}`);
  }

  return parseGetSessionResponse(await response.json()).session;
}

async function finalizeSession(request: FinalizeSessionRequest) {
  const response = await fetch(
    `${LOCAL_API_ORIGIN}${sessionPath(SESSION_FINALIZE_PATH, request.sessionId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  if (!response.ok) {
    throw new Error(`Session finalization failed: ${response.status}`);
  }

  return parseFinalizeSessionResponse(await response.json()).session;
}

async function pauseSession(request: PauseSessionRequest) {
  const response = await fetch(
    `${LOCAL_API_ORIGIN}${sessionPath(SESSION_PAUSE_PATH, request.sessionId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!response.ok) throw new Error(`Session pause failed: ${response.status}`);
  return parsePauseSessionResponse(await response.json()).session;
}

async function resumeSession(request: ResumeSessionRequest) {
  const response = await fetch(
    `${LOCAL_API_ORIGIN}${sessionPath(SESSION_RESUME_PATH, request.sessionId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!response.ok)
    throw new Error(`Session resume failed: ${response.status}`);
  return parseResumeSessionResponse(await response.json()).session;
}

async function failSession(request: FailSessionRequest) {
  const response = await fetch(
    `${LOCAL_API_ORIGIN}${sessionPath(SESSION_FAIL_PATH, request.sessionId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!response.ok)
    throw new Error(`Session failure update failed: ${response.status}`);
  return parseFailSessionResponse(await response.json()).session;
}

async function completeVideo(sessionId: string) {
  const response = await fetch(
    `${LOCAL_API_ORIGIN}${sessionPath(SESSION_VIDEO_COMPLETE_PATH, sessionId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId,
      }),
    },
  );
  if (!response.ok)
    throw new Error(`Video assembly failed: ${response.status}`);
  return parseCompleteVideoResponse(await response.json()).session;
}

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("offscreen.html"),
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Record the selected tab while the popup is closed",
  });
}

async function startPageRecorder(
  tabId: number,
  sessionId: string,
  origin: string,
  recordingStartedAt: string,
  activeTimeOffsetMs = 0,
) {
  const tab = await browser.tabs.get(tabId);
  if (tab.url === undefined || new URL(tab.url).origin !== origin) {
    throw new Error("The selected tab has left the recording origin");
  }
  await browser.scripting.executeScript({
    target: { tabId },
    files: ["/page-hooks.js"],
    world: "MAIN",
  });
  await browser.scripting.executeScript({
    target: { tabId },
    files: ["/page-recorder.js"],
    world: "ISOLATED",
  });
  const response: unknown = await browser.tabs.sendMessage(tabId, {
    type: "events:start",
    sessionId,
    origin,
    recordingStartedAt,
    activeTimeOffsetMs,
  } satisfies PageRecorderCommand);
  if (!isCommandResponse(response)) {
    throw new Error("The page recorder did not start");
  }
  if (!response.ok) throw new Error(response.message);
}

async function stopPageRecorder(tabId: number, sessionId: string) {
  try {
    const response: unknown = await browser.tabs.sendMessage(tabId, {
      type: "events:stop",
      sessionId,
    } satisfies PageRecorderCommand);
    if (!isCommandResponse(response)) {
      throw new Error("The page recorder did not stop");
    }
    if (!response.ok) throw new Error(response.message);
  } catch (error) {
    try {
      await browser.tabs.get(tabId);
    } catch {
      return;
    }
    throw error;
  }
  await eventUploadQueues.get(sessionId);
}

async function sendCaptureMessage(message: CaptureCommand) {
  const response: unknown = await browser.runtime.sendMessage(message);
  if (!isCaptureResponse(response)) {
    throw new Error("The offscreen recorder did not respond");
  }
  if (!response.ok) throw new Error(response.message);
  return response;
}

const coordinator = createRecordingCoordinator({
  state: {
    async read() {
      const stored = await browser.storage.local.get(RECORDING_STORAGE_KEY);
      return stored[RECORDING_STORAGE_KEY];
    },
    async write(state: RecordingState) {
      await browser.storage.local.set({ [RECORDING_STORAGE_KEY]: state });
    },
  },
  indicator: {
    async setRecording(isRecording) {
      await browser.action.setBadgeText({ text: isRecording ? "REC" : "" });
      if (isRecording) {
        await browser.action.setBadgeBackgroundColor({ color: "#dc3c4d" });
      }
    },
  },
  sessions: {
    create: createSession,
    finalize: finalizeSession,
    get: getSession,
    completeVideo,
    fail: failSession,
    pause: pauseSession,
    resume: resumeSession,
  },
  capture: {
    async start(tabId, sessionId, startedAtWallTime) {
      await ensureOffscreenDocument();
      const streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tabId,
      });
      const response = await sendCaptureMessage({
        type: "capture:start",
        sessionId,
        streamId,
        startedAtWallTime,
      });
      if (response.metadata === undefined) {
        throw new Error("The offscreen recorder returned no capture metadata");
      }
      return response.metadata;
    },
    async stop(sessionId) {
      const response = await sendCaptureMessage({
        type: "capture:stop",
        sessionId,
      });
      if (response.metadata === undefined) {
        throw new Error("The offscreen recorder returned no capture metadata");
      }
      return response.metadata;
    },
    async isActive(sessionId) {
      if (!(await chrome.offscreen.hasDocument())) return false;
      const response = await sendCaptureMessage({
        type: "capture:status",
        sessionId,
      });
      return response.active || response.metadata !== undefined;
    },
    async pause(sessionId) {
      await sendCaptureMessage({ type: "capture:pause", sessionId });
    },
    async resume(sessionId) {
      await sendCaptureMessage({ type: "capture:resume", sessionId });
    },
  },
  pageRecorder: {
    start: startPageRecorder,
    stop: stopPageRecorder,
  },
  tabs: {
    async exists(tabId) {
      try {
        await browser.tabs.get(tabId);
        return true;
      } catch {
        return false;
      }
    },
  },
  uploads: { flush: flushUploads },
});

let recovery: Promise<RecordingState> | undefined;

function recoverRecording(): Promise<RecordingState> {
  recovery ??= coordinator.recover().finally(() => {
    recovery = undefined;
  });
  return recovery;
}

export default defineBackground(() => {
  void recoverRecording().catch(() => undefined);
  void recoverRecording()
    .then(async (state) => {
      if (
        state.status !== "recording" ||
        state.clock.pausedAtWallTime == null
      ) {
        return;
      }
      const tab = await browser.tabs.get(state.tabId);
      if (
        tab.url !== undefined &&
        new URL(tab.url).origin === state.session.origin
      ) {
        await resumeOriginWithMarker(state);
      }
    })
    .catch(() => undefined);
  void drainUploads().catch(() => undefined);
  void browser.alarms.create("retry-pending-uploads", {
    periodInMinutes: 0.5,
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "retry-pending-uploads") {
      void drainUploads()
        .then(() => recoverRecording())
        .catch(() => undefined);
    }
  });

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (isAppendEventsMessage(message)) {
      return queueEvents(message.sessionId, message.events)
        .then((): CommandResponse => ({ ok: true }))
        .catch((error: unknown): CommandResponse => ({
          ok: false,
          message:
            error instanceof Error ? error.message : "Event upload failed",
        }));
    }
    if (isCaptureEndedMessage(message)) {
      return (async (): Promise<RecordingState> => {
        await recoverRecording();
        if (message.reason === "capture-error") {
          return coordinator.fail(message.reason, message.message);
        }
        try {
          return await coordinator.stop();
        } catch {
          return coordinator.fail(message.reason, message.message);
        }
      })();
    }
    if (!isRecordingCommand(message)) {
      // The offscreen document owns capture messages. Do not claim them.
      return undefined;
    }

    return (async (): Promise<RecordingState> => {
      await recoverRecording();
      return coordinator.handleMessage(message);
    })();
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void coordinator
      .get()
      .then(() => coordinator.closeTab(tabId))
      .catch(() => undefined);
  });

  browser.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0) return;
    void coordinator
      .get()
      .then(async (state) => {
        if (state.status !== "recording" || state.tabId !== details.tabId)
          return;
        if (new URL(details.url).origin === state.session.origin) return;
        await coordinator.pauseForOrigin(details.tabId);
      })
      .catch(() => undefined);
  });

  browser.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId !== 0) return;
    void recoverRecording()
      .then(async (state) => {
        if (state.status !== "recording" || state.tabId !== details.tabId)
          return;
        if (new URL(details.url).origin !== state.session.origin) return;
        if (state.clock.pausedAtWallTime != null) {
          await resumeOriginWithMarker(state);
        } else {
          await startPageRecorder(
            state.tabId,
            state.session.id,
            state.session.origin,
            new Date(state.clock.startedAtWallTime).toISOString(),
          );
        }
      })
      .catch(() => undefined);
  });

  browser.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) return;
    void recoverRecording()
      .then(async (state) => {
        if (state.status !== "recording" || state.tabId !== details.tabId)
          return;
        if (new URL(details.url).origin !== state.session.origin) {
          await coordinator.pauseForOrigin(details.tabId);
        } else if (state.clock.pausedAtWallTime != null) {
          await resumeOriginWithMarker(state);
        }
      })
      .catch(() => undefined);
  });
});
