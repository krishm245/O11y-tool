import { useEffect, useMemo, useState } from "react";
import { activeTimeAt, formatActiveTime } from "@app-o11y/session-clock";
import {
  isRecordingState,
  type RecordingMessage,
  type RecordingState,
  type TabSummary,
} from "../../recording-coordinator";

const popupShell =
  "min-h-[520px] w-[370px] bg-[radial-gradient(circle_at_100%_0,rgba(174,237,210,0.5),transparent_35%),#f7faf8] p-[22px] leading-[1.4] text-[#17201d] antialiased";

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
  const response: unknown = await browser.runtime.sendMessage(message);
  if (!isRecordingState(response)) {
    throw new Error("The extension returned an invalid recording state");
  }
  return response;
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
          message: "O11y Replay couldn't load this tab or its recording state.",
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
        message:
          popup.recording.status === "recording"
            ? "O11y Replay couldn't stop this session."
            : "O11y Replay couldn't start this session.",
      });
    } finally {
      setIsChanging(false);
    }
  }

  if (popup.status === "loading") {
    return (
      <main
        className={`${popupShell} grid place-content-center justify-items-center text-center`}
      >
        <div
          className="size-6 animate-spin rounded-full border-[3px] border-[#d5e2dc] border-t-[#187f58] [animation-duration:700ms] motion-reduce:animate-none"
          aria-label="Loading"
        />
      </main>
    );
  }

  if (popup.status === "error") {
    return (
      <main
        className={`${popupShell} grid place-content-center justify-items-center text-center`}
      >
        <div className="mb-3.5 grid size-10 place-items-center rounded-full bg-[#fff0f2] font-extrabold text-[#a82032]">
          !
        </div>
        <h1 className="m-0 max-h-[94px] overflow-hidden text-[23px] leading-[1.35] font-[750] tracking-[-0.035em] text-[#17201d]">
          {popup.message}
        </h1>
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
    <main className={popupShell}>
      <header className="mb-7 flex items-center justify-between">
        <div className="flex items-center gap-[9px] text-[15px] font-[750] tracking-[-0.02em]">
          <span
            className="grid size-6 place-items-center rounded-lg bg-[#17201d] shadow-[0_4px_12px_rgba(23,32,29,0.18)]"
            aria-hidden="true"
          >
            <span className="size-2 rounded-full border-2 border-[#9df0c8]" />
          </span>
          <span>O11y Replay</span>
        </div>
        <div
          className={`flex items-center gap-1.5 rounded-full border px-[9px] py-1.5 text-[11px] font-bold ${
            isRecording
              ? "border-[#f2cfd4] bg-[#fff4f5] text-[#a82032]"
              : "border-[#dce6e1] bg-white/72 text-[#53605b]"
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${
              isRecording
                ? "bg-[#dc3c4d] shadow-[0_0_0_3px_rgba(220,60,77,0.12)]"
                : "bg-[#2ca672] shadow-[0_0_0_3px_rgba(44,166,114,0.12)]"
            }`}
          />
          {isRecording ? "Recording" : "Ready"}
        </div>
      </header>

      <section
        className={`min-h-51 rounded-[20px] border p-[25px] shadow-[0_18px_45px_rgba(44,75,62,0.08)] ${
          isRecording
            ? "border-[#efc5ca] bg-[linear-gradient(145deg,#fff,#fff5f6)]"
            : "border-[#dce6e1] bg-white/82"
        }`}
      >
        <div className="mb-3 text-[10px] font-extrabold tracking-[0.12em] text-[#738079] uppercase">
          {isRecording ? "Test session in progress" : "Current tab"}
        </div>
        {isSupported || isRecording ? (
          <>
            <h1
              className="m-0 max-h-[62px] overflow-hidden text-[23px] leading-[1.35] font-[750] tracking-[-0.035em] text-[#17201d]"
              title={displayedTitle}
            >
              {displayedTitle}
            </h1>
            <p
              className="mt-2 mb-0 truncate text-xs text-[#69756f]"
              title={displayedOrigin}
            >
              {displayedOrigin}
            </p>
          </>
        ) : (
          <>
            <h1 className="m-0 max-h-[62px] overflow-hidden text-[23px] leading-[1.35] font-[750] tracking-[-0.035em] text-[#17201d]">
              This page cannot be recorded
            </h1>
            <p className="mt-2 mb-0 truncate text-xs text-[#69756f]">
              Open a regular HTTP or HTTPS page to continue.
            </p>
          </>
        )}

        {isRecording && (
          <div
            className="mt-7 flex items-center justify-center gap-[9px] text-[31px] font-bold tracking-[0.02em] text-[#9f2332] tabular-nums"
            aria-label={`Elapsed time ${elapsed}`}
          >
            <span className="size-2.5 rounded-full bg-[#dc3c4d] shadow-[0_0_0_5px_rgba(220,60,77,0.12)]" />
            {elapsed}
          </div>
        )}
      </section>

      <button
        className={`mt-4 flex w-full cursor-pointer items-center justify-center gap-[9px] rounded-[14px] px-[18px] py-3.5 text-[13px] font-[750] transition-[transform,background,box-shadow] duration-150 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[rgba(24,127,88,0.25)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none motion-reduce:transition-none ${
          isRecording
            ? "border border-[#efc5ca] bg-white text-[#9f2332] shadow-[0_9px_22px_rgba(150,38,52,0.08)] enabled:hover:bg-[#fff4f5]"
            : "bg-[#187f58] text-[#f7fffb] shadow-[0_9px_22px_rgba(24,127,88,0.22)] enabled:hover:-translate-y-px enabled:hover:bg-[#126e4b]"
        }`}
        type="button"
        disabled={isChanging || (!isSupported && !isRecording)}
        onClick={() => void toggleSession()}
      >
        <span
          className={`block size-2.5 bg-current ${isRecording ? "rounded-sm" : "rounded-full"}`}
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
