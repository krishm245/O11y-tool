import type { CaptureMetadata } from "./recording-coordinator";

export type CaptureRequest =
  | { type: "capture:start"; sessionId: string; streamId: string }
  | { type: "capture:stop"; sessionId: string }
  | { type: "capture:status"; sessionId: string };

export type CaptureResponse =
  | { ok: true; active: boolean; metadata?: CaptureMetadata }
  | { ok: false; message: string };

export type CaptureEndedMessage = {
  type: "capture:ended";
  sessionId: string;
  reason: "stream-ended" | "capture-error" | "time-limit";
  message: string;
};

export function isCaptureRequest(value: unknown): value is CaptureRequest {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  return ["capture:start", "capture:stop", "capture:status"].includes(
    String(value.type),
  );
}

export function isCaptureEndedMessage(
  value: unknown,
): value is CaptureEndedMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "capture:ended"
  );
}
