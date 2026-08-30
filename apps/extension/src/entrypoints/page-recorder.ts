import { sanitizeUrl } from "@app-o11y/privacy";
import {
  TIMELINE_EVENT_SCHEMA_VERSION,
  type JsonValue,
  type TimelineEvent,
  type TimelineEventCategory,
} from "@app-o11y/protocol";
import {
  isCommandResponse,
  isPageRecorderCommand,
  type CommandResponse,
  type PageRecorderCommand,
} from "../browser-messages";
import {
  interactionData,
  sanitizeNetworkDetail,
  type PageNetworkDetail,
} from "../event-sanitizer";

const NETWORK_EVENT = "o11y:network";
const NAVIGATION_EVENT = "o11y:navigation";
const FLUSH_INTERVAL_MS = 2_000;
const MAX_BATCH_EVENTS = 100;

type ActiveRecorder = {
  sessionId: string;
  origin: string;
  recordingStartedAtMs: number;
  activeTimeOffsetMs: number;
  events: TimelineEvent[];
  uploadQueue: Promise<void>;
  flushTimer: number;
  cleanup: Array<() => void>;
};

export default defineUnlistedScript(() => {
  const marker = "__o11yPageRecorderV1__";
  const page = globalThis as typeof globalThis & Record<string, unknown>;
  if (page[marker] === true) return;
  page[marker] = true;
  let active: ActiveRecorder | null = null;

  function addWindowListener<K extends keyof WindowEventMap>(
    capture: ActiveRecorder,
    type: K,
    listener: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean,
  ) {
    window.addEventListener(type, listener as EventListener, options);
    capture.cleanup.push(() =>
      window.removeEventListener(type, listener as EventListener, options),
    );
  }

  function append(
    capture: ActiveRecorder,
    category: TimelineEventCategory,
    type: string,
    data: JsonValue,
    wallTimeMs = Date.now(),
  ) {
    capture.events.push({
      schemaVersion: TIMELINE_EVENT_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      sessionId: capture.sessionId,
      activeTimeMs: Math.max(
        0,
        capture.activeTimeOffsetMs + wallTimeMs - capture.recordingStartedAtMs,
      ),
      wallTime: new Date(wallTimeMs).toISOString(),
      category,
      type,
      data,
    });
    if (capture.events.length >= MAX_BATCH_EVENTS) flush(capture);
  }

  function flush(capture: ActiveRecorder) {
    if (capture.events.length === 0) return;
    const events = capture.events
      .splice(0)
      .sort(
        (left, right) =>
          left.activeTimeMs - right.activeTimeMs ||
          Date.parse(left.wallTime) - Date.parse(right.wallTime) ||
          left.id.localeCompare(right.id),
      );
    capture.uploadQueue = capture.uploadQueue.then(async () => {
      const response: unknown = await browser.runtime.sendMessage({
        type: "events:append",
        sessionId: capture.sessionId,
        events,
      });
      if (!isCommandResponse(response)) throw new Error("Event upload failed");
      if (!response.ok) throw new Error(response.message);
    });
  }

  function start(
    request: Extract<PageRecorderCommand, { type: "events:start" }>,
  ) {
    if (active?.sessionId === request.sessionId) return;
    if (active !== null) throw new Error("Another page recorder is active");
    if (location.origin !== request.origin) {
      throw new Error("The page origin does not match the recording origin");
    }
    const recordingStartedAtMs = Date.parse(request.recordingStartedAt);
    if (!Number.isFinite(recordingStartedAtMs)) {
      throw new Error("The recording start time is invalid");
    }
    const capture: ActiveRecorder = {
      sessionId: request.sessionId,
      origin: request.origin,
      recordingStartedAtMs,
      activeTimeOffsetMs: request.activeTimeOffsetMs ?? 0,
      events: [],
      uploadQueue: Promise.resolve(),
      flushTimer: 0,
      cleanup: [],
    };
    active = capture;

    append(capture, "navigation", "document-load", {
      ...sanitizeUrl(location.href),
      title: document.title.slice(0, 200),
    });
    append(capture, "lifecycle", "visibility", {
      state: document.visibilityState,
    });

    addWindowListener(
      capture,
      "click",
      (event) => {
        append(
          capture,
          "interaction",
          "click",
          interactionData(
            event.target instanceof Element ? event.target : null,
            {
              button: event.button,
            },
          ),
        );
      },
      true,
    );
    addWindowListener(
      capture,
      "input",
      (event) => {
        const input = event as InputEvent;
        append(
          capture,
          "interaction",
          "input-change",
          interactionData(
            event.target instanceof Element ? event.target : null,
            {
              inputType: input.inputType || "unknown",
            },
          ),
        );
      },
      true,
    );
    addWindowListener(
      capture,
      "focusin",
      (event) => {
        append(
          capture,
          "interaction",
          "focus",
          interactionData(
            event.target instanceof Element ? event.target : null,
          ),
        );
      },
      true,
    );
    let lastScrollAt = 0;
    addWindowListener(
      capture,
      "scroll",
      (event) => {
        if (performance.now() - lastScrollAt < 150) return;
        lastScrollAt = performance.now();
        const element = event.target instanceof Element ? event.target : null;
        append(
          capture,
          "interaction",
          "scroll",
          interactionData(element, {
            x: element?.scrollLeft ?? window.scrollX,
            y: element?.scrollTop ?? window.scrollY,
          }),
        );
      },
      true,
    );
    addWindowListener(capture, "resize", () => {
      append(capture, "lifecycle", "viewport", {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      });
    });
    addWindowListener(capture, "error", (event) => {
      let source: JsonValue = null;
      if (event.filename) {
        try {
          source = sanitizeUrl(event.filename, location.href);
        } catch {
          source = null;
        }
      }
      append(capture, "lifecycle", "error", {
        name: event.error instanceof Error ? event.error.name : "Error",
        source,
        line: Math.max(0, event.lineno),
        column: Math.max(0, event.colno),
      });
    });
    addWindowListener(capture, "unhandledrejection", (event) => {
      append(capture, "lifecycle", "unhandled-rejection", {
        name: event.reason instanceof Error ? event.reason.name : "Unknown",
      });
    });
    const visibilityListener = () => {
      append(capture, "lifecycle", "visibility", {
        state: document.visibilityState,
      });
    };
    document.addEventListener("visibilitychange", visibilityListener);
    capture.cleanup.push(() =>
      document.removeEventListener("visibilitychange", visibilityListener),
    );
    addWindowListener(capture, "pageshow", (event) => {
      append(capture, "lifecycle", "pageshow", { persisted: event.persisted });
    });
    addWindowListener(capture, "pagehide", (event) => {
      append(capture, "lifecycle", "pagehide", { persisted: event.persisted });
      flush(capture);
    });
    addWindowListener(
      capture,
      NETWORK_EVENT as keyof WindowEventMap,
      (event) => {
        const detail = (event as CustomEvent<unknown>).detail;
        if (
          typeof detail !== "object" ||
          detail === null ||
          !("url" in detail)
        ) {
          return;
        }
        try {
          append(
            capture,
            "network",
            String((detail as { source?: unknown }).source ?? "network"),
            sanitizeNetworkDetail(detail as PageNetworkDetail, location.href),
          );
        } catch {
          // Ignore malformed events dispatched by the page.
        }
      },
    );
    addWindowListener(
      capture,
      NAVIGATION_EVENT as keyof WindowEventMap,
      (event) => {
        const detail = (event as CustomEvent<unknown>).detail;
        if (
          typeof detail !== "object" ||
          detail === null ||
          !("url" in detail)
        ) {
          return;
        }
        try {
          const navigationUrl = new URL(
            String((detail as { url: unknown }).url),
            location.href,
          );
          if (navigationUrl.origin !== capture.origin) {
            void stop(capture.sessionId);
            return;
          }
          append(capture, "navigation", "spa", {
            kind: String(
              (detail as { kind?: unknown }).kind ?? "unknown",
            ).slice(0, 40),
            ...sanitizeUrl(
              String((detail as { url: unknown }).url),
              location.href,
            ),
          });
        } catch {
          // Ignore malformed events dispatched by the page.
        }
      },
    );

    capture.flushTimer = window.setInterval(
      () => flush(capture),
      FLUSH_INTERVAL_MS,
    );
  }

  async function stop(sessionId: string) {
    if (active === null || active.sessionId !== sessionId) return;
    const capture = active;
    window.clearInterval(capture.flushTimer);
    capture.cleanup.forEach((cleanup) => cleanup());
    append(capture, "lifecycle", "recording-stop", {});
    flush(capture);
    await capture.uploadQueue;
    active = null;
  }

  browser.runtime.onMessage.addListener(
    (message: unknown): Promise<CommandResponse> | undefined => {
      if (!isPageRecorderCommand(message)) return undefined;
      return (async () => {
        try {
          if (message.type === "events:start") start(message);
          else await stop(message.sessionId);
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            message:
              error instanceof Error ? error.message : "Page recording failed",
          };
        }
      })();
    },
  );
});
