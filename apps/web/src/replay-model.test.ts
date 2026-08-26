import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@app-o11y/protocol";
import {
  eventFilter,
  eventLabel,
  eventSubtitle,
  keyboardSeekTarget,
  pauseIntervals,
  visibleTimelineEvents,
  wallDurationMs,
} from "./replay-model";

function event(
  type: string,
  category: TimelineEvent["category"],
  activeTimeMs: number,
  data: TimelineEvent["data"] = {},
): TimelineEvent {
  return {
    schemaVersion: 1,
    id: `${type}-${activeTimeMs}`,
    sessionId: "session-1",
    activeTimeMs,
    wallTime: new Date(1_000 + activeTimeMs).toISOString(),
    category,
    type,
    data,
  };
}

describe("replay model", () => {
  it("separates active, wall, and paused time", () => {
    const events = [
      event("paused-interval", "lifecycle", 5_000, {
        pausedAt: "2026-08-18T12:00:05.000Z",
        resumedAt: "2026-08-18T12:00:15.000Z",
        wallDurationMs: 10_000,
      }),
    ];
    const pauses = pauseIntervals(events);
    expect(pauses).toHaveLength(1);
    expect(wallDurationMs(20_000, pauses)).toBe(30_000);
    expect(eventFilter(events[0]!)).toBe("pauses");
  });

  it("filters the visible timeline and computes keyboard seeks", () => {
    const events = [
      event("click", "interaction", 1_000),
      event("fetch", "network", 2_000),
      event("resource", "network", 2_500),
      event("error", "lifecycle", 3_000),
    ];
    expect(
      visibleTimelineEvents(events, new Set(["network", "errors"])).map(
        ({ type }) => type,
      ),
    ).toEqual(["fetch", "error"]);
    expect(eventFilter(events[2]!)).toBeNull();
    expect(keyboardSeekTarget("ArrowRight", 2_000, 10_000)).toBe(7_000);
    expect(keyboardSeekTarget("ArrowLeft", 2_000, 10_000)).toBe(0);
    expect(keyboardSeekTarget("End", 2_000, 10_000)).toBe(10_000);
  });

  it("uses the request URL as the network event title", () => {
    const request = event("fetch", "network", 2_000, {
      method: "POST",
      originPath: "https://api.example.com/orders",
      status: 201,
    });
    expect(eventLabel(request)).toBe("https://api.example.com/orders");
    expect(eventSubtitle(request)).toBe("POST · 201");
  });
});
