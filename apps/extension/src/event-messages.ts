import type { TimelineEvent } from "@app-o11y/protocol";

export type EventRecorderRequest =
  | {
      type: "events:start";
      sessionId: string;
      origin: string;
      recordingStartedAt: string;
    }
  | { type: "events:stop"; sessionId: string };

export type AppendEventsMessage = {
  type: "events:append";
  sessionId: string;
  events: TimelineEvent[];
};

export type EventRecorderResponse =
  { ok: true } | { ok: false; message: string };

export function isAppendEventsMessage(
  value: unknown,
): value is AppendEventsMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "events:append" &&
    "sessionId" in value &&
    typeof value.sessionId === "string" &&
    "events" in value &&
    Array.isArray(value.events)
  );
}
