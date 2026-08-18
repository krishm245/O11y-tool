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
    <main className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="O11y Replay home">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          O11y Replay
        </a>
        <span className="prototype-label">Local prototype</span>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Recording library</p>
        <h1 id="page-title">See what happened. Fix what matters.</h1>
        <p className="hero-copy">
          Session recordings will appear here after they are captured by the
          browser extension and stored by the local service.
        </p>
      </section>

      <section className="empty-state" aria-labelledby="empty-title">
        <div className="empty-illustration" aria-hidden="true">
          <span className="play-symbol" />
          <span className="timeline-line" />
          <span className="timeline-dot timeline-dot--one" />
          <span className="timeline-dot timeline-dot--two" />
        </div>
        <p
          className={`status-pill status-pill--${service.status}`}
          role="status"
          aria-live="polite"
        >
          <span /> {statusLabel}
        </p>
        <h2 id="empty-title">No recordings yet</h2>
        {service.status === "connected" ? (
          <p>
            API version {service.health.version} is ready. Sessions created by
            the extension will appear here in the next milestone.
          </p>
        ) : service.status === "unavailable" ? (
          <div className="service-help">
            <p>
              Start the local API, then retry this connection from the browser.
            </p>
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry connection
            </button>
          </div>
        ) : (
          <p>Looking for the API at {LOCAL_API_ORIGIN}…</p>
        )}
      </section>
    </main>
  );
}

export default App;
