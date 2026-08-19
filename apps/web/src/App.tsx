import { useEffect, useState } from "react";
import {
  HEALTH_PATH,
  LOCAL_API_ORIGIN,
  isHealthResponse,
  type HealthResponse,
} from "@app-o11y/protocol";

type ServiceState =
  | { status: "checking" }
  | { status: "connected"; health: HealthResponse }
  | { status: "unavailable" };

const statusStyles = {
  checking: {
    pill: "bg-[#edf1ef] text-[#616d68]",
    dot: "motion-safe:animate-pulse bg-[#8b9691] shadow-[0_0_0_3px_rgba(139,150,145,0.12)]",
  },
  connected: {
    pill: "bg-[#e8f4ee] text-[#296849]",
    dot: "bg-[#2da871] shadow-[0_0_0_3px_rgba(45,168,113,0.12)]",
  },
  unavailable: {
    pill: "bg-[#fff0f2] text-[#9f2332]",
    dot: "bg-[#dc3c4d] shadow-[0_0_0_3px_rgba(220,60,77,0.12)]",
  },
} satisfies Record<ServiceState["status"], { pill: string; dot: string }>;

async function getHealth(signal: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${LOCAL_API_ORIGIN}${HEALTH_PATH}`, { signal });
  if (!response.ok)
    throw new Error(`Health request failed: ${response.status}`);

  const body: unknown = await response.json();
  if (!isHealthResponse(body)) throw new Error("Invalid health response");

  return body;
}

function App() {
  const [service, setService] = useState<ServiceState>({ status: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function checkService() {
      setService({ status: "checking" });

      try {
        const health = await getHealth(controller.signal);
        setService({ status: "connected", health });
      } catch {
        if (!controller.signal.aborted) setService({ status: "unavailable" });
      }
    }

    void checkService();
    return () => controller.abort();
  }, [attempt]);

  const statusLabel =
    service.status === "checking"
      ? "Checking local service"
      : service.status === "connected"
        ? "Local service connected"
        : "Local service unavailable";

  return (
    <main className="mx-auto w-[min(1120px,calc(100%-48px))] pb-[72px] max-sm:w-[min(1120px,calc(100%-28px))]">
      <header className="flex min-h-[76px] items-center justify-between border-b border-[rgba(190,205,198,0.72)]">
        <a
          className="inline-flex items-center gap-2.5 text-[15px] font-[780] tracking-[-0.025em] text-[#17201d] no-underline"
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
        <span className="text-[11px] font-[750] tracking-[0.1em] text-[#7b8882] uppercase">
          Local prototype
        </span>
      </header>

      <section
        className="max-w-[760px] pt-[92px] pb-[58px] max-sm:pt-16 max-sm:pb-[42px]"
        aria-labelledby="page-title"
      >
        <p className="mb-4 text-[11px] font-extrabold tracking-[0.14em] text-[#187f58] uppercase">
          Recording library
        </p>
        <h1
          id="page-title"
          className="mb-[22px] text-[clamp(3rem,7vw,5.6rem)] leading-[0.98] font-[760] tracking-[-0.065em] max-sm:text-[clamp(2.8rem,15vw,4.4rem)]"
        >
          See what happened. Fix what matters.
        </h1>
        <p className="mb-0 max-w-[620px] text-lg leading-[1.65] text-[#51605a]">
          Session recordings will appear here after they are captured by the
          browser extension and stored by the local service.
        </p>
      </section>

      <section
        className="grid min-h-[340px] content-center place-items-center rounded-3xl border border-[#dce6e1] bg-white/[0.78] px-6 py-12 text-center shadow-[0_24px_70px_rgba(42,72,60,0.07)] max-sm:min-h-[310px]"
        aria-labelledby="empty-title"
      >
        <div
          className="relative mb-6 h-[88px] w-[148px] rounded-[17px] border border-[#cee0d7] bg-[linear-gradient(145deg,#fff,#edf7f2)]"
          aria-hidden="true"
        >
          <span className="absolute top-[21px] left-[63px] size-0 border-y-[12px] border-y-transparent border-l-[18px] border-l-[#187f58]" />
          <span className="absolute right-5 bottom-[18px] left-5 h-0.5 bg-[#c9dbd2]" />
          <span className="absolute bottom-3.5 left-[42px] size-2.5 rounded-full border-2 border-white bg-[#187f58] shadow-[0_0_0_1px_#a7c9b9]" />
          <span className="absolute right-[34px] bottom-3.5 size-2.5 rounded-full border-2 border-white bg-[#187f58] shadow-[0_0_0_1px_#a7c9b9]" />
        </div>
        <p
          className={`mb-3.5 inline-flex items-center gap-[7px] rounded-full px-2.5 py-1.5 text-[11px] font-[750] ${statusStyles[service.status].pill}`}
          role="status"
          aria-live="polite"
        >
          <span
            className={`size-1.5 rounded-full ${statusStyles[service.status].dot}`}
          />{" "}
          {statusLabel}
        </p>
        <h2
          id="empty-title"
          className="mb-2.5 text-[25px] font-bold tracking-[-0.035em]"
        >
          No recordings yet
        </h2>
        {service.status === "connected" ? (
          <p className="mb-0 max-w-[490px] text-sm leading-[1.6] text-[#68766f]">
            API version {service.health.version} is ready. Sessions created by
            the extension will appear here in the next milestone.
          </p>
        ) : service.status === "unavailable" ? (
          <div className="grid justify-items-center">
            <p className="mb-0 max-w-[490px] text-sm leading-[1.6] text-[#68766f]">
              Start the local API, then retry this connection from the browser.
            </p>
            <button
              className="mt-[18px] cursor-pointer rounded-[10px] bg-[#187f58] px-[15px] py-2.5 text-[13px] font-[750] text-[#f7fffb] hover:bg-[#126e4b] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[rgba(24,127,88,0.25)]"
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry connection
            </button>
          </div>
        ) : (
          <p className="mb-0 max-w-[490px] text-sm leading-[1.6] text-[#68766f]">
            Looking for the API at {LOCAL_API_ORIGIN}…
          </p>
        )}
      </section>
    </main>
  );
}

export default App;
