export type SessionClockSnapshot = {
  startedAtWallTime: number;
  pausedDurationMs?: number;
  pausedAtWallTime?: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertTimestamp(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite timestamp`);
  }
}

export function startSessionClock(
  startedAtWallTime: number,
): SessionClockSnapshot {
  assertTimestamp(startedAtWallTime, 'startedAtWallTime');
  return { startedAtWallTime, pausedDurationMs: 0, pausedAtWallTime: null };
}

export function isSessionClockSnapshot(
  value: unknown,
): value is SessionClockSnapshot {
  return (
    isRecord(value) &&
    typeof value.startedAtWallTime === 'number' &&
    Number.isFinite(value.startedAtWallTime) &&
    value.startedAtWallTime >= 0 &&
    (value.pausedDurationMs === undefined ||
      (typeof value.pausedDurationMs === 'number' &&
        Number.isFinite(value.pausedDurationMs) &&
        value.pausedDurationMs >= 0)) &&
    (value.pausedAtWallTime === undefined ||
      value.pausedAtWallTime === null ||
      (typeof value.pausedAtWallTime === 'number' &&
        Number.isFinite(value.pausedAtWallTime) &&
        value.pausedAtWallTime >= value.startedAtWallTime))
  );
}

export function pauseSessionClock(
  snapshot: SessionClockSnapshot,
  pausedAtWallTime: number,
): SessionClockSnapshot {
  assertTimestamp(pausedAtWallTime, 'pausedAtWallTime');
  if (snapshot.pausedAtWallTime != null) return snapshot;
  return { ...snapshot, pausedAtWallTime };
}

export function resumeSessionClock(
  snapshot: SessionClockSnapshot,
  resumedAtWallTime: number,
): SessionClockSnapshot {
  assertTimestamp(resumedAtWallTime, 'resumedAtWallTime');
  if (snapshot.pausedAtWallTime == null) return snapshot;
  return {
    ...snapshot,
    pausedDurationMs:
      (snapshot.pausedDurationMs ?? 0) +
      Math.max(0, resumedAtWallTime - snapshot.pausedAtWallTime),
    pausedAtWallTime: null,
  };
}

export function activeTimeAt(
  snapshot: SessionClockSnapshot,
  atWallTime: number,
): number {
  assertTimestamp(atWallTime, 'atWallTime');
  const effectiveWallTime = Math.min(
    atWallTime,
    snapshot.pausedAtWallTime ?? atWallTime,
  );
  return Math.max(
    0,
    effectiveWallTime -
      snapshot.startedAtWallTime -
      (snapshot.pausedDurationMs ?? 0),
  );
}

export function formatActiveTime(activeTime: number): string {
  const totalSeconds = Math.max(0, Math.floor(activeTime / 1_000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}
