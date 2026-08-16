import { useEffect, useMemo, useState } from 'react';
import type { ExtensionMessage, SessionState, TabSummary } from '../../session';
import './App.css';

type PopupState =
  | { status: 'loading' }
  | { status: 'ready'; session: SessionState; tab: TabSummary | null }
  | { status: 'error'; message: string };

function getTabSummary(tab: Browser.tabs.Tab): TabSummary | null {
  if (tab.id === undefined || !tab.url) return null;

  try {
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    return {
      id: tab.id,
      title: tab.title || 'Untitled page',
      origin: url.origin,
    };
  } catch {
    return null;
  }
}

async function sendMessage(message: ExtensionMessage): Promise<SessionState> {
  return browser.runtime.sendMessage(message) as Promise<SessionState>;
}

function App() {
  const [popup, setPopup] = useState<PopupState>({ status: 'loading' });
  const [now, setNow] = useState(Date.now());
  const [isChanging, setIsChanging] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [activeTab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        const session = await sendMessage({ type: 'session:get' });
        setPopup({
          status: 'ready',
          session,
          tab: activeTab ? getTabSummary(activeTab) : null,
        });
      } catch {
        setPopup({
          status: 'error',
          message: 'The extension could not read the current tab.',
        });
      }
    }

    void load();
  }, []);

  useEffect(() => {
    if (popup.status !== 'ready' || popup.session.status !== 'recording') return;

    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [popup]);

  const elapsed = useMemo(() => {
    if (popup.status !== 'ready' || popup.session.status !== 'recording') return '00:00';

    const totalSeconds = Math.max(0, Math.floor((now - popup.session.startedAt) / 1_000));
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }, [now, popup]);

  async function toggleSession() {
    if (popup.status !== 'ready') return;

    setIsChanging(true);
    try {
      const session = popup.session.status === 'recording'
        ? await sendMessage({ type: 'session:stop' })
        : popup.tab
          ? await sendMessage({ type: 'session:start', tab: popup.tab })
          : popup.session;

      setPopup({ ...popup, session });
      setNow(Date.now());
    } catch {
      setPopup({ status: 'error', message: 'The session state could not be updated.' });
    } finally {
      setIsChanging(false);
    }
  }

  if (popup.status === 'loading') {
    return <main className="popup-shell popup-shell--center"><div className="loader" aria-label="Loading" /></main>;
  }

  if (popup.status === 'error') {
    return (
      <main className="popup-shell popup-shell--center">
        <div className="error-icon">!</div>
        <h1>Something went wrong</h1>
        <p className="muted">{popup.message}</p>
      </main>
    );
  }

  const session = popup.session;
  const isRecording = session.status === 'recording';
  const displayedTitle = session.status === 'recording' ? session.title : popup.tab?.title;
  const displayedOrigin = session.status === 'recording' ? session.origin : popup.tab?.origin;
  const isSupported = popup.tab !== null;

  return (
    <main className="popup-shell">
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>O11y Replay</span>
        </div>
        <div className={`status ${isRecording ? 'status--recording' : ''}`}>
          <span className="status-dot" />
          {isRecording ? 'Recording' : 'Ready'}
        </div>
      </header>

      <section className={`hero ${isRecording ? 'hero--recording' : ''}`}>
        <div className="eyebrow">{isRecording ? 'Test session in progress' : 'Current tab'}</div>
        {isSupported || isRecording ? (
          <>
            <h1 title={displayedTitle}>{displayedTitle}</h1>
            <p className="origin" title={displayedOrigin}>{displayedOrigin}</p>
          </>
        ) : (
          <>
            <h1>This page cannot be recorded</h1>
            <p className="origin">Open a regular HTTP or HTTPS page to continue.</p>
          </>
        )}

        {isRecording && (
          <div className="timer" aria-label={`Elapsed time ${elapsed}`}>
            <span className="record-pulse" />
            {elapsed}
          </div>
        )}
      </section>

      <button
        className={`primary-button ${isRecording ? 'primary-button--stop' : ''}`}
        type="button"
        disabled={isChanging || (!isSupported && !isRecording)}
        onClick={() => void toggleSession()}
      >
        <span className={isRecording ? 'stop-icon' : 'record-icon'} aria-hidden="true" />
        {isChanging ? 'Updating…' : isRecording ? 'Stop test session' : 'Start test session'}
      </button>

      <div className="privacy-note">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 5 6v5c0 4.7 2.9 8.7 7 10 4.1-1.3 7-5.3 7-10V6l-7-3Z" />
          <path d="m9.5 12 1.7 1.7 3.6-4" />
        </svg>
        <div>
          <strong>Safe test mode</strong>
          <span>No screen or interaction data is captured yet.</span>
        </div>
      </div>

      <footer>Local prototype · Milestone 1</footer>
    </main>
  );
}

export default App;
