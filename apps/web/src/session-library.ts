import {
  LOCAL_API_ORIGIN,
  SESSION_COLLECTION_PATH,
  SESSION_ITEM_PATH,
  parseDeleteSessionResponse,
  parseSessionListResponse,
  type SessionManifest,
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
