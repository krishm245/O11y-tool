export type SessionClockSnapshot = {
  startedAtWallTime: number;
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
  return { startedAtWallTime };
}

export function isSessionClockSnapshot(
  value: unknown,
): value is SessionClockSnapshot {
  return (
    isRecord(value) &&
    typeof value.startedAtWallTime === 'number' &&
    Number.isFinite(value.startedAtWallTime) &&
    value.startedAtWallTime >= 0
  );
}

export function activeTimeAt(
  snapshot: SessionClockSnapshot,
  atWallTime: number,
): number {
  assertTimestamp(atWallTime, 'atWallTime');
  return Math.max(0, atWallTime - snapshot.startedAtWallTime);
}

export function formatActiveTime(activeTime: number): string {
  const totalSeconds = Math.max(0, Math.floor(activeTime / 1_000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}
