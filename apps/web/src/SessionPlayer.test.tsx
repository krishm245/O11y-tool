import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SessionManifest, TimelineEvent } from "@app-o11y/protocol";
import { SessionPlayer } from "./SessionPlayer";

const session: SessionManifest = {
  schemaVersion: 1,
  privacyVersion: 1,
  id: "session-1",
  origin: "https://example.com",
  title: "Checkout failure",
  state: "incomplete",
  timestamps: {
    createdAt: "2026-08-18T12:00:00.000Z",
    recordingStartedAt: "2026-08-18T12:00:00.000Z",
    recordingEndedAt: "2026-08-18T12:00:20.000Z",
    processingStartedAt: "2026-08-18T12:00:20.000Z",
    processingEndedAt: "2026-08-18T12:00:20.000Z",
  },
  activeDurationMs: 20_000,
  viewport: null,
  codec: null,
  artifactSizes: { videoBytes: 0, eventsBytes: 100, totalBytes: 100 },
  failure: null,
};

const click: TimelineEvent = {
  schemaVersion: 1,
  id: "click-1",
  sessionId: session.id,
  activeTimeMs: 5_000,
  wallTime: "2026-08-18T12:00:05.000Z",
  category: "interaction",
  type: "click",
  data: { target: "Submit button" },
};

const request: TimelineEvent = {
  schemaVersion: 1,
  id: "fetch-1",
  sessionId: session.id,
  activeTimeMs: 7_000,
  wallTime: "2026-08-18T12:00:07.000Z",
  category: "network",
  type: "fetch",
  data: {
    source: "fetch",
    method: "POST",
    originPath: "https://api.example.com/orders",
    queryKeys: [],
    status: 201,
  },
};

describe("SessionPlayer accessibility", () => {
  it("labels playback, seeking, filters, and incomplete data", () => {
    const html = renderToStaticMarkup(
      <SessionPlayer
        session={session}
        events={[click, request]}
        eventsUnavailable={false}
        skippedEvents={1}
      />,
    );

    expect(html).toContain('aria-label="Synchronized session player"');
    expect(html).toContain('aria-label="Play replay"');
    expect(html).toContain('aria-label="Replay position"');
    expect(html).toContain('aria-label="Timeline filters"');
    expect(html).toContain("Some replay data is missing");
    expect(html).toContain("https://api.example.com/orders");
    expect(html).toContain("POST · 201");
    expect(html).not.toContain("DOM replay");
  });
});
