import {
  LOCAL_API_ORIGIN,
  SESSION_COLLECTION_PATH,
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
  type CreateSessionRequest,
  type FinalizeSessionRequest,
  type FailSessionRequest,
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
    async start(tabId, sessionId) {
      await ensureOffscreenDocument();
      const streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tabId,
      });
      const response = await sendCaptureMessage({
        type: "capture:start",
        sessionId,
        streamId,
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
    async (
      message: RecordingMessage | unknown,
    ): Promise<RecordingState | undefined> => {
      if (isCaptureEndedMessage(message)) {
        await recoverRecording();
        if (message.reason === "capture-error") {
          return coordinator.fail(message.reason, message.message);
        }
        try {
          return await coordinator.stop();
        } catch {
          return coordinator.fail(message.reason, message.message);
        }
      }
      if (
        typeof message !== "object" ||
        message === null ||
        !("type" in message) ||
        !String(message.type).startsWith("recording:")
      ) {
        return undefined;
      }
      await recoverRecording();
      return coordinator.handleMessage(message as RecordingMessage);
    },
  );

  browser.tabs.onRemoved.addListener((tabId) => {
    void recoverRecording()
      .then(() => coordinator.closeTab(tabId))
      .catch(() => undefined);
  });
});
