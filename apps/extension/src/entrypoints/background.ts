import {
  LOCAL_API_ORIGIN,
  SESSION_COLLECTION_PATH,
  SESSION_FINALIZE_PATH,
  SESSION_ITEM_PATH,
  parseFinalizeSessionResponse,
  parseGetSessionResponse,
  parseSessionManifest,
  type CreateSessionRequest,
  type FinalizeSessionRequest,
} from "@app-o11y/protocol";
import {
  RECORDING_STORAGE_KEY,
  createRecordingCoordinator,
  type RecordingMessage,
  type RecordingState,
} from "../recording-coordinator";

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
    async (message: RecordingMessage): Promise<RecordingState> => {
      await recoverRecording();
      return coordinator.handleMessage(message);
    },
  );

  browser.tabs.onRemoved.addListener((tabId) => {
    void recoverRecording()
      .then(() => coordinator.closeTab(tabId))
      .catch(() => undefined);
  });
});
