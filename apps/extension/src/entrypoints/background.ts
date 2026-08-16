import {
  SESSION_STORAGE_KEY,
  type ExtensionMessage,
  type SessionState,
} from '../session';

const idleSession: SessionState = { status: 'idle' };

async function getSession(): Promise<SessionState> {
  const stored = await browser.storage.local.get(SESSION_STORAGE_KEY);
  return (stored[SESSION_STORAGE_KEY] as SessionState | undefined) ?? idleSession;
}

async function saveSession(session: SessionState): Promise<SessionState> {
  await browser.storage.local.set({ [SESSION_STORAGE_KEY]: session });

  await browser.action.setBadgeText({
    text: session.status === 'recording' ? 'REC' : '',
  });

  if (session.status === 'recording') {
    await browser.action.setBadgeBackgroundColor({ color: '#dc3c4d' });
  }

  return session;
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (message: ExtensionMessage): Promise<SessionState> | undefined => {
      if (message.type === 'session:get') {
        return getSession();
      }

      if (message.type === 'session:start') {
        const session: SessionState = {
          status: 'recording',
          tabId: message.tab.id,
          title: message.tab.title,
          origin: message.tab.origin,
          startedAt: Date.now(),
        };

        return saveSession(session);
      }

      if (message.type === 'session:stop') {
        return saveSession(idleSession);
      }

      return undefined;
    },
  );

  browser.tabs.onRemoved.addListener(async (tabId) => {
    const session = await getSession();

    if (session.status === 'recording' && session.tabId === tabId) {
      await saveSession(idleSession);
    }
  });
});
