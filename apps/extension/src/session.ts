export const SESSION_STORAGE_KEY = 'current-session';

export type TabSummary = {
  id: number;
  title: string;
  origin: string;
};

export type SessionState =
  | { status: 'idle' }
  | {
      status: 'recording';
      tabId: number;
      title: string;
      origin: string;
      startedAt: number;
    };

export type ExtensionMessage =
  | { type: 'session:get' }
  | { type: 'session:start'; tab: TabSummary }
  | { type: 'session:stop' };
