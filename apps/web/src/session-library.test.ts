import { describe, expect, it, vi } from "vitest";
import {
  PRIVACY_POLICY_VERSION,
  SESSION_SCHEMA_VERSION,
  type SessionManifest,
} from "@app-o11y/protocol";
import {
  deleteSession,
  formatSessionDuration,
  getSession,
  getSessionVideoUrl,
  getSessions,
} from "./session-library";

const session: SessionManifest = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  privacyVersion: PRIVACY_POLICY_VERSION,
  id: "session-1",
  origin: "https://example.com",
  title: "Checkout",
  state: "ready",
  timestamps: {
    createdAt: "2026-08-18T12:00:00.000Z",
    recordingStartedAt: "2026-08-18T12:00:00.000Z",
    recordingEndedAt: "2026-08-18T12:01:05.000Z",
    processingStartedAt: "2026-08-18T12:01:05.000Z",
    processingEndedAt: "2026-08-18T12:01:05.000Z",
  },
  activeDurationMs: 65_000,
  viewport: null,
  codec: null,
  artifactSizes: { videoBytes: 0, eventsBytes: 0, totalBytes: 0 },
  failure: null,
};

describe("Session library API", () => {
  it("fetches and validates saved Sessions", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessions: [session],
      }),
    );

    await expect(getSessions(undefined, request)).resolves.toEqual([session]);
    expect(request).toHaveBeenCalledWith("http://127.0.0.1:7331/v1/sessions", {
      signal: undefined,
    });
  });

  it("deletes and validates the requested Session", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: "session-1",
        deleted: true,
      }),
    );

    await deleteSession("session-1", request);
    expect(request).toHaveBeenCalledWith(
      "http://127.0.0.1:7331/v1/sessions/session-1",
      { method: "DELETE" },
    );
  });

  it("fetches one Session and constructs its video URL", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({ schemaVersion: SESSION_SCHEMA_VERSION, session }),
    );
    await expect(getSession("session-1", undefined, request)).resolves.toEqual(
      session,
    );
    expect(getSessionVideoUrl("session-1")).toBe(
      "http://127.0.0.1:7331/v1/sessions/session-1/video",
    );
  });
});

describe("formatSessionDuration", () => {
  it.each([
    [0, "0:00"],
    [65_900, "1:05"],
    [3_661_000, "1:01:01"],
  ])("formats %i milliseconds as %s", (duration, formatted) => {
    expect(formatSessionDuration(duration)).toBe(formatted);
  });
});
