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
  SESSION_SCHEMA_VERSION,
  SESSION_VIDEO_COMPLETE_PATH,
  parseCompleteVideoResponse,
  parseFailSessionResponse,
  parseFinalizeSessionResponse,
  parseGetSessionResponse,
  parseSessionManifest,
  parseTimelineEvent,
  type CreateSessionRequest,
  type FinalizeSessionRequest,
  type FailSessionRequest,
  type EventBatch,
  type TimelineEvent,
} from "@app-o11y/protocol";
import {
  RECORDING_STORAGE_KEY,
  createRecordingCoordinator,
  type RecordingMessage,
  type RecordingState,
} from "../recording-coordinator";
import {
  isCaptureEndedMessage,
  type CaptureRequest,
  type CaptureResponse,
} from "../capture-messages";
import {
  isAppendEventsMessage,
  type EventRecorderRequest,
  type EventRecorderResponse,
} from "../event-messages";

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

async function appendEvents(sessionId: string, input: TimelineEvent[]) {
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
  const response = await fetch(
    `${LOCAL_API_ORIGIN}${eventChunkPath(sessionId, sequence)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/gzip",
        "x-o11y-schema-version": String(ARTIFACT_CHUNK_SCHEMA_VERSION),
        "x-o11y-active-start-ms": String(events[0]!.activeTimeMs),
        "x-o11y-active-end-ms": String(events[events.length - 1]!.activeTimeMs),
        "x-o11y-checksum": await checksum(bytes),
      },
      body: bytes,
    },
  );
  if (!response.ok) {
    throw new Error(
      `Event chunk ${sequence} upload failed with ${response.status}`,
    );
  }
  await browser.storage.local.set({ [sequenceKey]: sequence + 1 });
}

function queueEvents(sessionId: string, events: TimelineEvent[]) {
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
  const response = (await browser.tabs.sendMessage(tabId, {
    type: "events:start",
    sessionId,
    origin,
    recordingStartedAt,
  } satisfies EventRecorderRequest)) as EventRecorderResponse;
  if (!response?.ok) {
    throw new Error(response?.message ?? "The page recorder did not start");
  }
}

async function stopPageRecorder(tabId: number, sessionId: string) {
  try {
    const response = (await browser.tabs.sendMessage(tabId, {
      type: "events:stop",
      sessionId,
    } satisfies EventRecorderRequest)) as EventRecorderResponse;
    if (!response?.ok) {
      throw new Error(response?.message ?? "The page recorder did not stop");
    }
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

async function sendCaptureMessage(message: CaptureRequest) {
  const response = (await browser.runtime.sendMessage(
    message,
  )) as CaptureResponse;
  if (!response?.ok) {
    throw new Error(
      response?.message ?? "The offscreen recorder did not respond",
    );
  }
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
});

let recovery: Promise<RecordingState> | undefined;

function recoverRecording(): Promise<RecordingState> {
  recovery ??= coordinator.recover().catch((error: unknown) => {
    recovery = undefined;
    throw error;
  });
  return recovery;
}

export default defineBackground(() => {
  void recoverRecording().catch(() => undefined);

  browser.runtime.onMessage.addListener(
    (message: RecordingMessage | unknown) => {
      if (isAppendEventsMessage(message)) {
        return queueEvents(message.sessionId, message.events)
          .then((): EventRecorderResponse => ({ ok: true }))
          .catch((error: unknown): EventRecorderResponse => ({
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
      if (
        typeof message !== "object" ||
        message === null ||
        !("type" in message) ||
        !String(message.type).startsWith("recording:")
      ) {
        // The offscreen document owns capture messages. Do not claim them.
        return undefined;
      }

      return (async (): Promise<RecordingState> => {
        await recoverRecording();
        return coordinator.handleMessage(message as RecordingMessage);
      })();
    },
  );

  browser.tabs.onRemoved.addListener((tabId) => {
    void recoverRecording()
      .then(() => coordinator.closeTab(tabId))
      .catch(() => undefined);
  });

  browser.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId !== 0) return;
    void recoverRecording()
      .then(async (state) => {
        if (state.status !== "recording" || state.tabId !== details.tabId)
          return;
        if (new URL(details.url).origin !== state.session.origin) return;
        await startPageRecorder(
          state.tabId,
          state.session.id,
          state.session.origin,
          new Date(state.clock.startedAtWallTime).toISOString(),
        );
      })
      .catch(() => undefined);
  });
});
