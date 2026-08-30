import { describe, expect, it } from "vitest";
import {
  isAppendEventsMessage,
  isCaptureCommand,
  isCaptureEndedMessage,
  isCaptureResponse,
  isCommandResponse,
  isPageRecorderCommand,
  isRecordingCommand,
} from "./browser-messages";

describe("browser messages", () => {
  it.each([
    { type: "recording:get" },
    { type: "recording:stop" },
    {
      type: "recording:start",
      tab: { id: 7, title: "Checkout", origin: "https://example.com" },
    },
  ])("accepts recording command $type", (message) => {
    expect(isRecordingCommand(message)).toBe(true);
  });

  it.each([
    { type: "recording:start" },
    { type: "recording:start", tab: { id: "7", title: "Checkout" } },
    { type: "recording:pause" },
  ])("rejects malformed recording command $type", (message) => {
    expect(isRecordingCommand(message)).toBe(false);
  });

  it.each([
    {
      type: "events:start",
      sessionId: "session-1",
      origin: "https://example.com",
      recordingStartedAt: "2026-08-30T10:00:00.000Z",
    },
    { type: "events:stop", sessionId: "session-1" },
  ])("accepts page recorder command $type", (message) => {
    expect(isPageRecorderCommand(message)).toBe(true);
  });

  it("rejects page recorder commands with missing fields", () => {
    expect(
      isPageRecorderCommand({ type: "events:start", sessionId: "x" }),
    ).toBe(false);
    expect(isPageRecorderCommand({ type: "events:stop" })).toBe(false);
  });

  it.each([
    {
      type: "capture:start",
      sessionId: "session-1",
      streamId: "stream-1",
      startedAtWallTime: 1,
    },
    { type: "capture:stop", sessionId: "session-1" },
    { type: "capture:pause", sessionId: "session-1" },
    { type: "capture:resume", sessionId: "session-1" },
    { type: "capture:status", sessionId: "session-1" },
  ])("accepts capture command $type", (message) => {
    expect(isCaptureCommand(message)).toBe(true);
  });

  it("rejects incomplete capture messages", () => {
    expect(isCaptureCommand({ type: "capture:start" })).toBe(false);
    expect(
      isCaptureCommand({
        type: "capture:start",
        sessionId: "session-1",
        streamId: "stream-1",
        startedAtWallTime: Number.NaN,
      }),
    ).toBe(false);
    expect(isCaptureEndedMessage({ type: "capture:ended" })).toBe(false);
  });

  it("validates event and capture notifications", () => {
    expect(
      isAppendEventsMessage({
        type: "events:append",
        sessionId: "session-1",
        events: [],
      }),
    ).toBe(true);
    expect(
      isCaptureEndedMessage({
        type: "capture:ended",
        sessionId: "session-1",
        reason: "stream-ended",
        message: "Capture ended",
      }),
    ).toBe(true);
    expect(
      isCaptureEndedMessage({
        type: "capture:ended",
        sessionId: "session-1",
        reason: "other",
        message: "Capture ended",
      }),
    ).toBe(false);
  });

  it("validates responses before callers read them", () => {
    expect(isCommandResponse({ ok: true })).toBe(true);
    expect(isCommandResponse({ ok: false, message: "No recorder" })).toBe(true);
    expect(isCommandResponse({ ok: false })).toBe(false);
    expect(
      isCaptureResponse({
        ok: true,
        active: true,
        metadata: {
          codec: "vp9",
          viewport: { width: 1280, height: 720, devicePixelRatio: 2 },
        },
      }),
    ).toBe(true);
    expect(isCaptureResponse({ ok: true })).toBe(false);
  });
});
