import type {
  JsonValue,
  TimelineEvent,
} from "@app-o11y/protocol";

export type TimelineFilter =
  "interaction" | "navigation" | "network" | "errors" | "pauses";

export type PauseInterval = {
  activeTimeMs: number;
  pausedAt: string;
  resumedAt: string;
  wallDurationMs: number;
};

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function eventFilter(event: TimelineEvent): TimelineFilter | null {
  if (event.type === "paused-interval") return "pauses";
  if (event.type === "error" || event.type === "unhandled-rejection") {
    return "errors";
  }
  if (event.category === "network") {
    return event.type === "fetch" || event.type === "xhr" ? "network" : null;
  }
  if (event.category === "interaction" || event.category === "navigation") {
    return event.category;
  }
  return null;
}

export function visibleTimelineEvents(
  events: TimelineEvent[],
  filters: ReadonlySet<TimelineFilter>,
) {
  return events.filter((event) => {
    const filter = eventFilter(event);
    return filter !== null && filters.has(filter);
  });
}

export function pauseIntervals(events: TimelineEvent[]): PauseInterval[] {
  return events.flatMap((event) => {
    if (event.type !== "paused-interval" || !isJsonObject(event.data))
      return [];
    const { pausedAt, resumedAt, wallDurationMs } = event.data;
    if (
      typeof pausedAt !== "string" ||
      typeof resumedAt !== "string" ||
      typeof wallDurationMs !== "number"
    ) {
      return [];
    }
    return [
      {
        activeTimeMs: event.activeTimeMs,
        pausedAt,
        resumedAt,
        wallDurationMs: Math.max(0, wallDurationMs),
      },
    ];
  });
}

export function wallDurationMs(
  activeDurationMs: number,
  pauses: PauseInterval[],
) {
  return (
    activeDurationMs +
    pauses.reduce((total, pause) => total + pause.wallDurationMs, 0)
  );
}

export function eventLabel(event: TimelineEvent) {
  if (event.type === "paused-interval") return "Recording paused";
  if (event.category === "network" && isJsonObject(event.data)) {
    return typeof event.data.originPath === "string"
      ? event.data.originPath
      : "Request";
  }
  return event.type.replaceAll("-", " ");
}

export function eventSubtitle(event: TimelineEvent) {
  if (event.category !== "network" || !isJsonObject(event.data)) return null;
  const method =
    typeof event.data.method === "string" ? event.data.method : "GET";
  const status =
    typeof event.data.status === "number" && event.data.status > 0
      ? String(event.data.status)
      : null;
  return status === null ? method : `${method} · ${status}`;
}

export function eventTone(
  event: TimelineEvent,
): "interaction" | "navigation" | "network" | "lifecycle" | "error" | "pause" {
  const filter = eventFilter(event);
  if (filter === "errors") return "error";
  if (filter === "pauses") return "pause";
  if (
    filter === "interaction" ||
    filter === "navigation" ||
    filter === "network"
  ) {
    return filter;
  }
  return "lifecycle";
}

export function keyboardSeekTarget(
  key: string,
  currentTimeMs: number,
  durationMs: number,
): number | null {
  if (key === "ArrowLeft") return Math.max(0, currentTimeMs - 5_000);
  if (key === "ArrowRight") return Math.min(durationMs, currentTimeMs + 5_000);
  if (key === "Home") return 0;
  if (key === "End") return durationMs;
  return null;
}
