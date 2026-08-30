export type TabSummary = {
  id: number;
  title: string;
  origin: string;
};

export type CaptureMetadata = {
  codec: "vp9" | "vp8";
  viewport: { width: number; height: number; devicePixelRatio: number };
};

export type RecordingCommand =
  | { type: "recording:get" }
  | { type: "recording:start"; tab: TabSummary }
  | { type: "recording:stop" };

export type PageRecorderCommand =
  | {
      type: "events:start";
      sessionId: string;
      origin: string;
      recordingStartedAt: string;
      activeTimeOffsetMs?: number;
    }
  | { type: "events:stop"; sessionId: string };

export type AppendEventsMessage = {
  type: "events:append";
  sessionId: string;
  events: unknown[];
};

export type CaptureCommand =
  | {
      type: "capture:start";
      sessionId: string;
      streamId: string;
      startedAtWallTime: number;
    }
  | { type: "capture:stop"; sessionId: string }
  | { type: "capture:pause"; sessionId: string }
  | { type: "capture:resume"; sessionId: string }
  | { type: "capture:status"; sessionId: string };

const CAPTURE_END_REASONS = [
  "stream-ended",
  "capture-error",
  "time-limit",
  "queue_limit",
  "storage_unavailable",
] as const;

type CaptureEndReason = (typeof CAPTURE_END_REASONS)[number];

export type CaptureEndedMessage = {
  type: "capture:ended";
  sessionId: string;
  reason: CaptureEndReason;
  message: string;
};

export type CommandResponse = { ok: true } | { ok: false; message: string };

export type CaptureResponse =
  | { ok: true; active: boolean; metadata?: CaptureMetadata }
  | { ok: false; message: string };

type Message = Record<string, unknown>;

function isMessage(value: unknown): value is Message {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(message: Message, key: string): boolean {
  return typeof message[key] === "string" && message[key].length > 0;
}

function hasFiniteNumber(message: Message, key: string): boolean {
  return typeof message[key] === "number" && Number.isFinite(message[key]);
}

function hasSessionId(message: Message): boolean {
  return hasText(message, "sessionId");
}

function isTabSummary(value: unknown): value is TabSummary {
  return (
    isMessage(value) &&
    Number.isSafeInteger(value.id) &&
    hasText(value, "title") &&
    hasText(value, "origin")
  );
}

function isCaptureMetadata(value: unknown): value is CaptureMetadata {
  if (!isMessage(value) || (value.codec !== "vp9" && value.codec !== "vp8")) {
    return false;
  }
  const viewport = value.viewport;
  return (
    isMessage(viewport) &&
    hasFiniteNumber(viewport, "width") &&
    hasFiniteNumber(viewport, "height") &&
    hasFiniteNumber(viewport, "devicePixelRatio")
  );
}

export function isRecordingCommand(value: unknown): value is RecordingCommand {
  if (!isMessage(value)) return false;
  switch (value.type) {
    case "recording:get":
    case "recording:stop":
      return true;
    case "recording:start":
      return isTabSummary(value.tab);
    default:
      return false;
  }
}

export function isPageRecorderCommand(
  value: unknown,
): value is PageRecorderCommand {
  if (!isMessage(value) || !hasSessionId(value)) return false;
  if (value.type === "events:stop") return true;
  return (
    value.type === "events:start" &&
    hasText(value, "origin") &&
    hasText(value, "recordingStartedAt") &&
    (value.activeTimeOffsetMs === undefined ||
      hasFiniteNumber(value, "activeTimeOffsetMs"))
  );
}

export function isAppendEventsMessage(
  value: unknown,
): value is AppendEventsMessage {
  return (
    isMessage(value) &&
    value.type === "events:append" &&
    hasSessionId(value) &&
    Array.isArray(value.events)
  );
}

export function isCaptureCommand(value: unknown): value is CaptureCommand {
  if (!isMessage(value) || !hasSessionId(value)) return false;
  switch (value.type) {
    case "capture:stop":
    case "capture:pause":
    case "capture:resume":
    case "capture:status":
      return true;
    case "capture:start":
      return (
        hasText(value, "streamId") &&
        hasFiniteNumber(value, "startedAtWallTime")
      );
    default:
      return false;
  }
}

export function isCaptureEndedMessage(
  value: unknown,
): value is CaptureEndedMessage {
  return (
    isMessage(value) &&
    value.type === "capture:ended" &&
    hasSessionId(value) &&
    hasText(value, "message") &&
    CAPTURE_END_REASONS.some((reason) => reason === value.reason)
  );
}

export function isCommandResponse(value: unknown): value is CommandResponse {
  return (
    isMessage(value) &&
    (value.ok === true || (value.ok === false && hasText(value, "message")))
  );
}

export function isCaptureResponse(value: unknown): value is CaptureResponse {
  if (!isMessage(value)) return false;
  if (value.ok === false) return hasText(value, "message");
  return (
    value.ok === true &&
    typeof value.active === "boolean" &&
    (value.metadata === undefined || isCaptureMetadata(value.metadata))
  );
}
