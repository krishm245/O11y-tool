import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionManifest, TimelineEvent } from "@app-o11y/protocol";
import { formatSessionDuration, getSessionVideoUrl } from "./session-library";
import {
  eventLabel,
  eventMetadata,
  eventResponseData,
  eventSubtitle,
  eventTone,
  keyboardSeekTarget,
  pauseIntervals,
  visibleTimelineEvents,
  wallDurationMs,
  type TimelineFilter,
} from "./replay-model";

const FILTERS: Array<{ value: TimelineFilter; label: string }> = [
  { value: "interaction", label: "Interactions" },
  { value: "navigation", label: "Navigation" },
  { value: "network", label: "Network" },
  { value: "errors", label: "Errors" },
  { value: "pauses", label: "Pauses" },
];

const TONE_CLASS = {
  interaction: "bg-[#276eaf]",
  navigation: "bg-[#7559b5]",
  network: "bg-[#187f58]",
  lifecycle: "bg-[#75817b]",
  error: "bg-[#c2384c]",
  pause: "bg-[#c58a22]",
} as const;

function PauseStrip({
  activeDurationMs,
  events,
}: {
  activeDurationMs: number;
  events: TimelineEvent[];
}) {
  const pauses = useMemo(() => pauseIntervals(events), [events]);
  const wallMs = wallDurationMs(activeDurationMs, pauses);
  let priorPauseMs = 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[10px] font-bold tracking-wide text-[#78847e] uppercase">
        <span>Wall clock</span>
        <span>
          {formatSessionDuration(activeDurationMs)} active ·{" "}
          {formatSessionDuration(wallMs)} wall
        </span>
      </div>
      <div
        className="relative h-2 overflow-hidden rounded-full bg-[#dce7e1]"
        aria-label={`${formatSessionDuration(wallMs)} wall time with ${formatSessionDuration(wallMs - activeDurationMs)} paused`}
      >
        {pauses.map((pause) => {
          const left =
            ((pause.activeTimeMs + priorPauseMs) / Math.max(1, wallMs)) * 100;
          const width = (pause.wallDurationMs / Math.max(1, wallMs)) * 100;
          priorPauseMs += pause.wallDurationMs;
          return (
            <span
              key={`${pause.pausedAt}-${pause.resumedAt}`}
              className="absolute inset-y-0 bg-[#d89a2e]"
              style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
              title={`${formatSessionDuration(pause.wallDurationMs)} paused`}
            />
          );
        })}
      </div>
    </div>
  );
}

export function EventDetails({ event }: { event: TimelineEvent | null }) {
  if (event === null) {
    return (
      <p className="m-0 text-xs leading-5 text-[#78847e]">
        Select an event to inspect its sanitized details.
      </p>
    );
  }
  const responseData = eventResponseData(event);
  return (
    <>
      <h3 className="m-0 text-sm font-bold break-all">{eventLabel(event)}</h3>
      <p className="mt-1 mb-3 text-[10px] text-[#78847e]">
        Active {formatSessionDuration(event.activeTimeMs)} · Wall{" "}
        {new Date(event.wallTime).toLocaleTimeString()}
      </p>
      <pre className="m-0 max-h-48 overflow-auto rounded-lg bg-[#17201d] p-3 text-[10px] leading-4 break-words whitespace-pre-wrap text-[#d8e5de]">
        {JSON.stringify(eventMetadata(event), null, 2)}
      </pre>
      {responseData === undefined ? null : (
        <>
          <h4 className="mt-4 mb-2 text-xs font-bold">Response data</h4>
          <pre className="m-0 max-h-64 overflow-auto rounded-lg bg-[#17201d] p-3 text-[10px] leading-4 break-words whitespace-pre-wrap text-[#d8e5de]">
            {JSON.stringify(responseData, null, 2)}
          </pre>
        </>
      )}
    </>
  );
}

export function SessionPlayer({
  events,
  eventsUnavailable,
  session,
  skippedEvents,
}: {
  events: TimelineEvent[];
  eventsUnavailable: boolean;
  session: SessionManifest;
  skippedEvents: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playheadRef = useRef(0);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [videoCorrupt, setVideoCorrupt] = useState(false);
  const [filters, setFilters] = useState<Set<TimelineFilter>>(
    () => new Set(FILTERS.map(({ value }) => value)),
  );
  const durationMs = Math.max(
    session.activeDurationMs,
    events.at(-1)?.activeTimeMs ?? 0,
    1,
  );
  const hasVideo =
    session.codec !== null &&
    session.artifactSizes.videoBytes > 0 &&
    !videoCorrupt;
  const timelineEvents = useMemo(
    () => visibleTimelineEvents(events, filters),
    [events, filters],
  );
  const selectedEvent = events.find((event) => event.id === selectedId) ?? null;

  const seek = useCallback(
    (targetMs: number) => {
      const next = Math.max(0, Math.min(durationMs, targetMs));
      playheadRef.current = next;
      setPlayheadMs(next);
      if (videoRef.current !== null)
        videoRef.current.currentTime = next / 1_000;
    },
    [durationMs],
  );

  useEffect(() => {
    if (!isPlaying || hasVideo) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const elapsed = now - previous;
      previous = now;
      const next = Math.min(durationMs, playheadRef.current + elapsed);
      playheadRef.current = next;
      setPlayheadMs(next);
      if (next >= durationMs) setIsPlaying(false);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [durationMs, hasVideo, isPlaying]);

  async function togglePlayback() {
    if (isPlaying) {
      videoRef.current?.pause();
      setIsPlaying(false);
      return;
    }
    if (playheadMs >= durationMs) seek(0);
    if (hasVideo && videoRef.current !== null) {
      try {
        await videoRef.current.play();
      } catch {
        setIsPlaying(false);
      }
    } else {
      setIsPlaying(true);
    }
  }

  function selectEvent(event: TimelineEvent) {
    setSelectedId(event.id);
    seek(event.activeTimeMs);
  }

  function toggleFilter(filter: TimelineFilter) {
    setFilters((current) => {
      const next = new Set(current);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
  }

  return (
    <section
      className="overflow-hidden rounded-3xl border border-[#dce6e1] bg-white/80 shadow-[0_24px_70px_rgba(42,72,60,0.07)] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[rgba(24,127,88,0.3)]"
      aria-label="Synchronized session player"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement) return;
        if (event.key === " ") {
          event.preventDefault();
          void togglePlayback();
          return;
        }
        const target = keyboardSeekTarget(event.key, playheadMs, durationMs);
        if (target !== null) {
          event.preventDefault();
          seek(target);
        }
      }}
    >
      {session.state === "incomplete" ||
      skippedEvents > 0 ||
      eventsUnavailable ? (
        <p
          className="m-4 rounded-xl bg-[#fff8e5] px-4 py-3 text-sm text-[#745416]"
          role="status"
        >
          Some replay data is missing. Available video and events can still be
          inspected.
        </p>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)_360px] max-lg:grid-cols-1">
        <div className="min-w-0 border-r border-[#e0e8e4] max-lg:border-r-0 max-lg:border-b">
          <div className="bg-[#101613]">
            {hasVideo ? (
              <video
                ref={videoRef}
                className="aspect-video w-full bg-black"
                preload="metadata"
                src={getSessionVideoUrl(session.id)}
                aria-label="Recorded tab video"
                onTimeUpdate={(event) => {
                  const next = event.currentTarget.currentTime * 1_000;
                  playheadRef.current = next;
                  setPlayheadMs(next);
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                onError={() => setVideoCorrupt(true)}
              />
            ) : (
              <div className="grid aspect-video place-items-center px-6 text-center text-sm text-[#b8c4be]">
                No playable video is available.
              </div>
            )}
          </div>

          <div className="space-y-4 p-5">
            <div className="flex items-center gap-4">
              <button
                className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full bg-[#187f58] text-sm font-bold text-white hover:bg-[#126e4b] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[rgba(24,127,88,0.3)]"
                type="button"
                onClick={() => void togglePlayback()}
                aria-label={isPlaying ? "Pause replay" : "Play replay"}
              >
                {isPlaying ? "Ⅱ" : "▶"}
              </button>
              <span className="w-11 text-xs font-bold text-[#43514b] tabular-nums">
                {formatSessionDuration(playheadMs)}
              </span>
              <input
                className="min-w-0 flex-1 accent-[#187f58]"
                type="range"
                min={0}
                max={durationMs}
                step={100}
                value={Math.min(playheadMs, durationMs)}
                aria-label="Replay position"
                onChange={(event) => seek(Number(event.currentTarget.value))}
              />
              <span className="w-11 text-right text-xs font-semibold text-[#77837d] tabular-nums">
                {formatSessionDuration(durationMs)}
              </span>
            </div>
            <PauseStrip activeDurationMs={durationMs} events={events} />
          </div>
        </div>

        <aside className="flex min-h-145 flex-col" aria-label="Event timeline">
          <div className="border-b border-[#e0e8e4] p-4">
            <h2 className="m-0 text-base font-bold tracking-tight">Timeline</h2>
            <div
              className="mt-3 flex flex-wrap gap-1.5"
              aria-label="Timeline filters"
            >
              {FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  className={`cursor-pointer rounded-full border px-2.5 py-1.5 text-[10px] font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[rgba(24,127,88,0.25)] ${
                    filters.has(filter.value)
                      ? "border-[#b8d7c8] bg-[#e9f5ef] text-[#296849]"
                      : "border-[#dde5e1] bg-white text-[#7a8781]"
                  }`}
                  type="button"
                  aria-pressed={filters.has(filter.value)}
                  onClick={() => toggleFilter(filter.value)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          {eventsUnavailable ? (
            <p className="m-4 text-sm leading-6 text-[#8f2936]">
              The event artifact could not be read.
            </p>
          ) : (
            <ol className="m-0 max-h-96 flex-1 list-none overflow-y-auto p-2 [content-visibility:auto]">
              {timelineEvents.map((event) => {
                const subtitle = eventSubtitle(event);
                return (
                  <li key={event.id}>
                    <button
                      className={`grid w-full cursor-pointer grid-cols-[8px_46px_minmax(0,1fr)] items-start gap-2 rounded-xl px-2 py-2.5 text-left hover:bg-[#f0f6f3] focus-visible:outline-3 focus-visible:outline-offset-[-2px] focus-visible:outline-[rgba(24,127,88,0.25)] ${selectedId === event.id ? "bg-[#eaf4ef]" : "bg-transparent"}`}
                      type="button"
                      onClick={() => selectEvent(event)}
                      aria-label={`${formatSessionDuration(event.activeTimeMs)}, ${eventLabel(event)}`}
                    >
                      <span
                        className={`mt-1 size-2 rounded-full ${TONE_CLASS[eventTone(event)]}`}
                        aria-hidden="true"
                      />
                      <span className="text-[10px] font-bold text-[#78847e] tabular-nums">
                        {formatSessionDuration(event.activeTimeMs)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-[#33413b]">
                          {eventLabel(event)}
                        </span>
                        {subtitle === null ? null : (
                          <span className="mt-0.5 block text-[10px] font-semibold text-[#78847e]">
                            {subtitle}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          <div
            className="min-h-42 border-t border-[#e0e8e4] bg-[#f8faf9] p-4"
            aria-live="polite"
          >
            <EventDetails event={selectedEvent} />
          </div>
        </aside>
      </div>
    </section>
  );
}
