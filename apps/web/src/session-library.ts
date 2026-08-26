import {
  LOCAL_API_ORIGIN,
  SESSION_COLLECTION_PATH,
  SESSION_ITEM_PATH,
  SESSION_EVENTS_PATH,
  TIMELINE_EVENT_SCHEMA_VERSION,
  SESSION_VIDEO_PATH,
  parseDeleteSessionResponse,
  parseGetSessionResponse,
  parseTimelineEvent,
  parseSessionListResponse,
  type SessionManifest,
  type TimelineEvent,
} from "@app-o11y/protocol";

type Request = typeof fetch;

export async function getSessions(
  signal?: AbortSignal,
  request: Request = fetch,
): Promise<SessionManifest[]> {
  const response = await request(
    `${LOCAL_API_ORIGIN}${SESSION_COLLECTION_PATH}`,
    {
      signal,
    },
  );
  if (!response.ok)
    throw new Error(`Session list request failed: ${response.status}`);

  return parseSessionListResponse(await response.json()).sessions;
}

export async function deleteSession(
  sessionId: string,
  request: Request = fetch,
): Promise<void> {
  const path = SESSION_ITEM_PATH.replace(
    ":sessionId",
    encodeURIComponent(sessionId),
  );
  const response = await request(`${LOCAL_API_ORIGIN}${path}`, {
    method: "DELETE",
  });
  if (!response.ok)
    throw new Error(`Session deletion failed: ${response.status}`);

  const result = parseDeleteSessionResponse(await response.json());
  if (result.sessionId !== sessionId) {
    throw new Error("Deleted Session ID did not match the request");
  }
}

function sessionPath(path: string, sessionId: string) {
  return path.replace(":sessionId", encodeURIComponent(sessionId));
}

export async function getSession(
  sessionId: string,
  signal?: AbortSignal,
  request: Request = fetch,
): Promise<SessionManifest | null> {
  const response = await request(
    `${LOCAL_API_ORIGIN}${sessionPath(SESSION_ITEM_PATH, sessionId)}`,
    { signal },
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Session request failed: ${response.status}`);
  return parseGetSessionResponse(await response.json()).session;
}

export function getSessionVideoUrl(sessionId: string) {
  return `${LOCAL_API_ORIGIN}${sessionPath(SESSION_VIDEO_PATH, sessionId)}`;
}

export type SessionEventsResult = {
  events: TimelineEvent[];
  skippedEvents: number;
};

export async function getSessionEvents(
  sessionId: string,
  signal?: AbortSignal,
  request: Request = fetch,
): Promise<SessionEventsResult> {
  const response = await request(
    `${LOCAL_API_ORIGIN}${sessionPath(SESSION_EVENTS_PATH, sessionId)}`,
    { signal },
  );
  if (!response.ok) {
    throw new Error(`Session events request failed: ${response.status}`);
  }
  const value: unknown = await response.json();
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== TIMELINE_EVENT_SCHEMA_VERSION ||
    !("events" in value) ||
    !Array.isArray(value.events)
  ) {
    throw new Error("Session events response is invalid");
  }
  const events: TimelineEvent[] = [];
  let skippedEvents = 0;
  for (const event of value.events) {
    try {
      const parsed = parseTimelineEvent(event);
      if (parsed.sessionId === sessionId) events.push(parsed);
      else skippedEvents += 1;
    } catch {
      skippedEvents += 1;
    }
  }
  return { events, skippedEvents };
}

const sessionDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatSessionDate(timestamp: string): string {
  return sessionDateFormatter.format(new Date(timestamp));
}

export function formatSessionDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
