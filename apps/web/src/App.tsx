import { useEffect, useState } from "react";
import {
  LOCAL_API_ORIGIN,
  type SessionManifest,
  type SessionStatus,
} from "@app-o11y/protocol";
import {
  deleteSession,
  formatSessionDate,
  formatSessionDuration,
  getSession,
  getSessionVideoUrl,
  getSessions,
} from "./session-library";

type LibraryState =
  | { status: "loading" }
  | { status: "loaded"; sessions: SessionManifest[] }
  | { status: "unavailable" };

const statePresentation = {
  creating: { label: "Starting", className: "bg-[#edf1ef] text-[#616d68]" },
  recording: { label: "Recording", className: "bg-[#fff0f2] text-[#9f2332]" },
  paused: { label: "Paused", className: "bg-[#fff6df] text-[#805b12]" },
  processing: { label: "Processing", className: "bg-[#edf1ef] text-[#616d68]" },
  ready: { label: "Ready", className: "bg-[#e8f4ee] text-[#296849]" },
  incomplete: { label: "Incomplete", className: "bg-[#fff6df] text-[#805b12]" },
  failed: { label: "Failed", className: "bg-[#fff0f2] text-[#9f2332]" },
} satisfies Record<SessionStatus, { label: string; className: string }>;

function EmptyLibrary() {
  return (
    <div className="grid min-h-80 place-items-center content-center px-6 py-12 text-center">
      <div
        className="relative mb-6 h-22 w-37 rounded-[17px] border border-[#cee0d7] bg-[linear-gradient(145deg,#fff,#edf7f2)]"
        aria-hidden="true"
      >
        <span className="absolute top-[21px] left-15.75 size-0 border-y-12 border-l-18 border-y-transparent border-l-[#187f58]" />
        <span className="absolute inset-x-5 bottom-[18px] h-0.5 bg-[#c9dbd2]" />
        <span className="absolute bottom-3.5 left-[42px] size-2.5 rounded-full border-2 border-white bg-[#187f58] shadow-[0_0_0_1px_#a7c9b9]" />
        <span className="absolute right-[34px] bottom-3.5 size-2.5 rounded-full border-2 border-white bg-[#187f58] shadow-[0_0_0_1px_#a7c9b9]" />
      </div>
      <h2 className="mb-2.5 text-[25px] font-bold tracking-[-0.035em]">
        No recordings yet
      </h2>
      <p className="mb-0 max-w-[490px] text-sm leading-[1.6] text-[#68766f]">
        Start a test session from the browser extension. It will appear here as
        soon as the local service stores it.
      </p>
    </div>
  );
}

function LoadingLibrary() {
  return (
    <div
      className="grid min-h-80 place-content-center justify-items-center gap-3 text-sm text-[#68766f]"
      role="status"
    >
      <span className="size-6 animate-spin rounded-full border-[3px] border-[#d5e2dc] border-t-[#187f58] [animation-duration:700ms] motion-reduce:animate-none" />
      Loading recordings…
    </div>
  );
}

function SessionNotice({ session }: { session: SessionManifest }) {
  if (session.state === "incomplete") {
    return (
      <p className="mt-4 mb-0 rounded-xl bg-[#fff9e9] px-3 py-2.5 text-xs leading-[1.5] text-[#725217]">
        This recording ended unexpectedly and may be missing data.
      </p>
    );
  }

  if (session.state === "failed") {
    return (
      <p className="mt-4 mb-0 rounded-xl bg-[#fff4f5] px-3 py-2.5 text-xs leading-[1.5] text-[#8f2936]">
        {session.failure?.message ??
          "O11y Replay couldn't finish this recording."}
      </p>
    );
  }

  return null;
}

function SessionCard({
  deleting,
  onDelete,
  session,
}: {
  deleting: boolean;
  onDelete: (session: SessionManifest) => void;
  session: SessionManifest;
}) {
  const presentation = statePresentation[session.state];

  return (
    <li className="rounded-[20px] border border-[#dce6e1] bg-white/88 p-5 shadow-[0_14px_40px_rgba(42,72,60,0.055)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2
            className="m-0 truncate text-lg font-[740] tracking-[-0.025em] text-[#17201d]"
            title={session.title}
          >
            {session.title}
          </h2>
          <p
            className="mt-1.5 mb-0 truncate text-xs text-[#6b7872]"
            title={session.origin}
          >
            {session.origin}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1.5 text-[10px] font-extrabold tracking-[0.04em] uppercase ${presentation.className}`}
        >
          {presentation.label}
        </span>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-[#e5ece8] pt-4">
        <div>
          <dt className="text-[10px] font-extrabold tracking-[0.1em] text-[#8a9690] uppercase">
            Recorded
          </dt>
          <dd className="mt-1 text-xs font-semibold text-[#43514b]">
            {formatSessionDate(session.timestamps.createdAt)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-extrabold tracking-[0.1em] text-[#8a9690] uppercase">
            Duration
          </dt>
          <dd className="mt-1 text-xs font-semibold text-[#43514b] tabular-nums">
            {formatSessionDuration(session.activeDurationMs)}
          </dd>
        </div>
      </dl>

      <SessionNotice session={session} />

      <div className="mt-5 flex justify-end">
        <a
          className="mr-auto rounded-lg bg-[#187f58] px-3 py-2 text-xs font-bold text-white no-underline hover:bg-[#126e4b] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[rgba(24,127,88,0.25)]"
          href={`/sessions/${encodeURIComponent(session.id)}`}
        >
          Open recording
        </a>
        <button
          className="cursor-pointer rounded-lg border border-[#e1e8e4] bg-white px-3 py-2 text-xs font-bold text-[#80505a] hover:border-[#efc5ca] hover:bg-[#fff4f5] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[rgba(159,35,50,0.2)] disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={deleting}
          onClick={() => onDelete(session)}
          aria-label={`Delete ${session.title}`}
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </li>
  );
}

function LibraryPage() {
  const [library, setLibrary] = useState<LibraryState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadSessions() {
      setLibrary({ status: "loading" });
      try {
        const sessions = await getSessions(controller.signal);
        setLibrary({ status: "loaded", sessions });
      } catch {
        if (!controller.signal.aborted) setLibrary({ status: "unavailable" });
      }
    }

    void loadSessions();
    return () => controller.abort();
  }, [attempt]);

  async function handleDelete(session: SessionManifest) {
    if (!window.confirm(`Delete "${session.title}"? This cannot be undone.`))
      return;

    setDeletingId(session.id);
    setDeleteError(null);
    try {
      await deleteSession(session.id);
      setLibrary((current) =>
        current.status === "loaded"
          ? {
              ...current,
              sessions: current.sessions.filter(({ id }) => id !== session.id),
            }
          : current,
      );
    } catch {
      setDeleteError("O11y Replay couldn't delete this recording. Try again.");
    } finally {
      setDeletingId(null);
    }
  }

  const sessionCount =
    library.status === "loaded" ? library.sessions.length : 0;

  return (
    <main className="mx-auto w-[min(1120px,calc(100%-48px))] pb-18 max-sm:w-[min(1120px,calc(100%-28px))]">
      <header className="flex min-h-19 items-center justify-between border-b border-[rgba(190,205,198,0.72)]">
        <a
          className="inline-flex items-center gap-2.5 text-[15px] font-[780] tracking-tight text-[#17201d] no-underline"
          href="/"
          aria-label="O11y Replay home"
        >
          <span
            className="grid size-[27px] place-items-center rounded-lg bg-[#17201d] shadow-[0_5px_14px_rgba(23,32,29,0.16)]"
            aria-hidden="true"
          >
            <span className="size-[9px] rounded-full border-2 border-[#9df0c8]" />
          </span>
          O11y Replay
        </a>
        <span className="text-[11px] font-[750] tracking-widest text-[#7b8882] uppercase">
          Local prototype
        </span>
      </header>

      <section
        className="flex items-end justify-between gap-8 pt-20 pb-10 max-sm:block max-sm:pt-14"
        aria-labelledby="page-title"
      >
        <div className="max-w-190">
          <p className="mb-4 text-[11px] font-extrabold tracking-[0.14em] text-[#187f58] uppercase">
            Recording library
          </p>
          <h1
            id="page-title"
            className="mb-[18px] text-[clamp(2.8rem,6vw,5rem)] leading-[0.98] font-[760] tracking-[-0.06em] max-sm:text-[clamp(2.7rem,14vw,4.2rem)]"
          >
            Review local recordings.
          </h1>
          <p className="mb-0 max-w-155 text-base leading-[1.65] text-[#51605a]">
            The browser extension saves each session to the local service on
            this computer.
          </p>
        </div>
        {library.status === "loaded" ? (
          <p
            className="mb-1 shrink-0 text-sm font-semibold text-[#68766f] max-sm:mt-5"
            aria-live="polite"
          >
            {sessionCount} {sessionCount === 1 ? "recording" : "recordings"}
          </p>
        ) : null}
      </section>

      <section
        className="overflow-hidden rounded-3xl border border-[#dce6e1] bg-white/62 shadow-[0_24px_70px_rgba(42,72,60,0.07)]"
        aria-label="Saved recordings"
      >
        {library.status === "loading" ? (
          <LoadingLibrary />
        ) : library.status === "unavailable" ? (
          <div className="grid min-h-80 place-content-center justify-items-center px-6 py-12 text-center">
            <span
              className="mb-4 grid size-11 place-items-center rounded-full bg-[#fff0f2] text-lg font-extrabold text-[#9f2332]"
              aria-hidden="true"
            >
              !
            </span>
            <h2 className="mb-2.5 text-[25px] font-bold tracking-[-0.035em]">
              Local service unavailable
            </h2>
            <p className="mb-0 max-w-[500px] text-sm leading-[1.6] text-[#68766f]">
              Start the API at {LOCAL_API_ORIGIN}, then retry the connection.
            </p>
            <button
              className="mt-[18px] cursor-pointer rounded-[10px] bg-[#187f58] px-[15px] py-2.5 text-[13px] font-[750] text-[#f7fffb] hover:bg-[#126e4b] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[rgba(24,127,88,0.25)]"
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry connection
            </button>
          </div>
        ) : library.sessions.length === 0 ? (
          <EmptyLibrary />
        ) : (
          <div className="p-4 sm:p-5">
            {deleteError === null ? null : (
              <p
                className="mt-0 mb-4 rounded-xl bg-[#fff0f2] px-4 py-3 text-sm text-[#9f2332]"
                role="alert"
              >
                {deleteError}
              </p>
            )}
            <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 max-md:grid-cols-1">
              {library.sessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  deleting={deletingId === session.id}
                  onDelete={(target) => void handleDelete(target)}
                />
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}

type DetailsState =
  | { status: "loading" }
  | { status: "loaded"; session: SessionManifest | null }
  | { status: "unavailable" };

function DetailsMessage({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "error";
}) {
  return (
    <div
      className={`grid min-h-80 place-content-center px-8 text-center text-sm leading-6 ${
        tone === "error" ? "text-[#8f2936]" : "text-[#68766f]"
      }`}
      role="status"
    >
      {children}
    </div>
  );
}

function VideoPlayer({ session }: { session: SessionManifest }) {
  const [corrupt, setCorrupt] = useState(false);

  if (session.state === "processing") {
    return (
      <DetailsMessage>
        The video is still being assembled. Reload this page in a moment.
      </DetailsMessage>
    );
  }
  if (session.state === "failed") {
    return (
      <DetailsMessage tone="error">
        {session.failure?.message ?? "Chrome could not finish this recording."}
      </DetailsMessage>
    );
  }
  if (
    session.state !== "ready" ||
    session.codec === null ||
    session.artifactSizes.videoBytes === 0
  ) {
    return (
      <DetailsMessage>
        This session does not have a playable video artifact.
      </DetailsMessage>
    );
  }
  if (corrupt) {
    return (
      <DetailsMessage tone="error">
        Chrome could not decode this WebM. The stored video may be incomplete or
        corrupt.
      </DetailsMessage>
    );
  }

  return (
    <div className="bg-[#101613] p-4 sm:p-6">
      <video
        className="aspect-video w-full rounded-xl bg-black"
        controls
        preload="metadata"
        src={getSessionVideoUrl(session.id)}
        onError={() => setCorrupt(true)}
      >
        Your browser does not support WebM video playback.
      </video>
    </div>
  );
}

function SessionDetailsPage({ sessionId }: { sessionId: string }) {
  const [details, setDetails] = useState<DetailsState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void getSession(sessionId, controller.signal)
      .then((session) => setDetails({ status: "loaded", session }))
      .catch(() => {
        if (!controller.signal.aborted) setDetails({ status: "unavailable" });
      });
    return () => controller.abort();
  }, [sessionId]);

  const session = details.status === "loaded" ? details.session : null;
  return (
    <main className="mx-auto w-[min(1120px,calc(100%-48px))] pb-18 max-sm:w-[min(1120px,calc(100%-28px))]">
      <header className="flex min-h-19 items-center justify-between border-b border-[rgba(190,205,198,0.72)]">
        <a className="text-sm font-bold text-[#187f58] no-underline" href="/">
          ← Recording library
        </a>
        <span className="text-[11px] font-[750] tracking-widest text-[#7b8882] uppercase">
          Local prototype
        </span>
      </header>

      <section className="pt-14 pb-8" aria-labelledby="session-title">
        <p className="mb-3 text-[11px] font-extrabold tracking-[0.14em] text-[#187f58] uppercase">
          Session replay
        </p>
        <h1
          id="session-title"
          className="mb-3 text-[clamp(2rem,5vw,3.8rem)] leading-tight font-[760] tracking-[-0.05em]"
        >
          {session?.title ?? "Recording"}
        </h1>
        {session === null ? null : (
          <p className="m-0 text-sm text-[#68766f]">
            {session.origin} · {formatSessionDate(session.timestamps.createdAt)}{" "}
            · {formatSessionDuration(session.activeDurationMs)}
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-3xl border border-[#dce6e1] bg-white/70 shadow-[0_24px_70px_rgba(42,72,60,0.07)]">
        {details.status === "loading" ? (
          <LoadingLibrary />
        ) : details.status === "unavailable" ? (
          <DetailsMessage tone="error">
            The local service is unavailable. Start it at {LOCAL_API_ORIGIN},
            then reload.
          </DetailsMessage>
        ) : details.session === null ? (
          <DetailsMessage>This recording no longer exists.</DetailsMessage>
        ) : (
          <VideoPlayer session={details.session} />
        )}
      </section>
    </main>
  );
}

function App() {
  const match = /^\/sessions\/([^/]+)\/?$/.exec(window.location.pathname);
  if (match === null) return <LibraryPage />;
  try {
    return <SessionDetailsPage sessionId={decodeURIComponent(match[1]!)} />;
  } catch {
    return <SessionDetailsPage sessionId="invalid" />;
  }
}

export default App;
