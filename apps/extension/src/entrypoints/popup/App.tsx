import { useEffect, useMemo, useState } from "react";
import { activeTimeAt, formatActiveTime } from "@app-o11y/session-clock";
import type {
  RecordingMessage,
  RecordingState,
  TabSummary,
} from "../../recording-coordinator";
import "./App.css";

type PopupState =
  | { status: "loading" }
  | { status: "ready"; recording: RecordingState; tab: TabSummary | null }
  | { status: "error"; message: string };

function getTabSummary(tab: Browser.tabs.Tab): TabSummary | null {
  if (tab.id === undefined || !tab.url) return null;

  try {
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    return {
      id: tab.id,
      title: tab.title || "Untitled page",
      origin: url.origin,
    };
  } catch {
    return null;
  }
}

async function sendMessage(message: RecordingMessage): Promise<RecordingState> {
  return browser.runtime.sendMessage(message) as Promise<RecordingState>;
}

function App() {
  const [popup, setPopup] = useState<PopupState>({ status: "loading" });
  const [now, setNow] = useState(Date.now());
  const [isChanging, setIsChanging] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [activeTab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });

        const recording = await sendMessage({ type: "recording:get" });
        setPopup({
          status: "ready",
          recording,
          tab: activeTab ? getTabSummary(activeTab) : null,
        });
      } catch {
        setPopup({
          status: "error",
          message: "The extension could not read the current tab.",
        });
      }
    }

    void load();
  }, []);

  useEffect(() => {
    if (popup.status !== "ready" || popup.recording.status !== "recording")
      return;

    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [popup]);

  const elapsed = useMemo(() => {
    if (popup.status !== "ready" || popup.recording.status !== "recording")
      return "00:00";

    return formatActiveTime(activeTimeAt(popup.recording.clock, now));
  }, [now, popup]);

  async function toggleSession() {
    if (popup.status !== "ready") return;

    setIsChanging(true);
    try {
      const recording =
        popup.recording.status === "recording"
          ? await sendMessage({ type: "recording:stop" })
          : popup.tab
            ? await sendMessage({ type: "recording:start", tab: popup.tab })
            : popup.recording;

      setPopup({ ...popup, recording });
      setNow(Date.now());
    } catch {
      setPopup({
        status: "error",
        message: "The session state could not be updated.",
      });
    } finally {
      setIsChanging(false);
    }
  }

  if (popup.status === "loading") {
    return (
      <main className="popup-shell popup-shell--center">
        <div className="loader" aria-label="Loading" />
      </main>
    );
  }

  if (popup.status === "error") {
    return (
      <main className="popup-shell popup-shell--center">
        <div className="error-icon">!</div>
        <h1>Something went wrong</h1>
        <p className="muted">{popup.message}</p>
      </main>
    );
  }

  const recording = popup.recording;
  const isRecording = recording.status === "recording";
  const displayedTitle =
    recording.status === "recording"
      ? recording.session.title
      : popup.tab?.title;
  const displayedOrigin =
    recording.status === "recording"
      ? recording.session.origin
      : popup.tab?.origin;
  const isSupported = popup.tab !== null;

  return (
    <main className="popup-shell">
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>O11y Replay</span>
        </div>
        <div className={`status ${isRecording ? "status--recording" : ""}`}>
          <span className="status-dot" />
          {isRecording ? "Recording" : "Ready"}
        </div>
      </header>

      <section className={`hero ${isRecording ? "hero--recording" : ""}`}>
        <div className="eyebrow">
          {isRecording ? "Test session in progress" : "Current tab"}
        </div>
        {isSupported || isRecording ? (
          <>
            <h1 title={displayedTitle}>{displayedTitle}</h1>
            <p className="origin" title={displayedOrigin}>
              {displayedOrigin}
            </p>
          </>
        ) : (
          <>
            <h1>This page cannot be recorded</h1>
            <p className="origin">
              Open a regular HTTP or HTTPS page to continue.
            </p>
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
        className={`primary-button ${isRecording ? "primary-button--stop" : ""}`}
        type="button"
        disabled={isChanging || (!isSupported && !isRecording)}
        onClick={() => void toggleSession()}
      >
        <span
          className={isRecording ? "stop-icon" : "record-icon"}
          aria-hidden="true"
        />
        {isChanging
          ? "Updating…"
          : isRecording
            ? "Stop test session"
            : "Start test session"}
      </button>
    </main>
  );
}

export default App;
