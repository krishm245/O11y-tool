import {
  LOCAL_API_ORIGIN,
  SESSION_COLLECTION_PATH,
  parseSessionManifest,
  type CreateSessionRequest,
} from '@app-o11y/protocol';
import {
  RECORDING_STORAGE_KEY,
  createRecordingCoordinator,
  type RecordingMessage,
  type RecordingState,
} from '../recording-coordinator';

async function createSession(request: CreateSessionRequest) {
  const response = await fetch(`${LOCAL_API_ORIGIN}${SESSION_COLLECTION_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Session creation failed: ${response.status}`);
  }

  return parseSessionManifest(await response.json());
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
      await browser.action.setBadgeText({ text: isRecording ? 'REC' : '' });
      if (isRecording) {
        await browser.action.setBadgeBackgroundColor({ color: '#dc3c4d' });
      }
    },
  },
  sessions: { create: createSession },
});

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (message: RecordingMessage): Promise<RecordingState> =>
      coordinator.handleMessage(message),
  );

  browser.tabs.onRemoved.addListener((tabId) => {
    void coordinator.closeTab(tabId);
  });
});
