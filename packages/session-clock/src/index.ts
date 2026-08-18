export type PausedInterval = {
  startedAtWallTime: number;
  endedAtWallTime?: number;
  activeTimeAtPause: number;
};

export type SessionClockSnapshot = {
  startedAtWallTime: number;
  stoppedAtWallTime?: number;
  pausedIntervals: PausedInterval[];
};

export type ProducerClockAnchor = {
  producerTime: number;
  observedAtWallTime: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertTimestamp(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite timestamp`);
  }
}

function completedPauseDuration(
  interval: PausedInterval,
  atWallTime: number,
): number {
  const end = Math.min(interval.endedAtWallTime ?? atWallTime, atWallTime);
  return Math.max(0, end - interval.startedAtWallTime);
}

export function startSessionClock(
  startedAtWallTime: number,
): SessionClockSnapshot {
  assertTimestamp(startedAtWallTime, 'startedAtWallTime');
  return { startedAtWallTime, pausedIntervals: [] };
}

export function isSessionClockSnapshot(
  value: unknown,
): value is SessionClockSnapshot {
  if (!isRecord(value) || !Number.isFinite(value.startedAtWallTime)) {
    return false;
  }
  if (
    value.stoppedAtWallTime !== undefined &&
    !Number.isFinite(value.stoppedAtWallTime)
  ) {
    return false;
  }
  if (!Array.isArray(value.pausedIntervals)) return false;

  return value.pausedIntervals.every(
    (interval) =>
      isRecord(interval) &&
      Number.isFinite(interval.startedAtWallTime) &&
      Number.isFinite(interval.activeTimeAtPause) &&
      (interval.endedAtWallTime === undefined ||
        Number.isFinite(interval.endedAtWallTime)),
  );
}

export function activeTimeAt(
  snapshot: SessionClockSnapshot,
  atWallTime: number,
): number {
  assertTimestamp(atWallTime, 'atWallTime');

  const effectiveTime = Math.min(
    Math.max(atWallTime, snapshot.startedAtWallTime),
    snapshot.stoppedAtWallTime ?? Number.POSITIVE_INFINITY,
  );
  const pausedDuration = snapshot.pausedIntervals.reduce(
    (total, interval) => total + completedPauseDuration(interval, effectiveTime),
    0,
  );

  return Math.max(0, effectiveTime - snapshot.startedAtWallTime - pausedDuration);
}

export function pauseSessionClock(
  snapshot: SessionClockSnapshot,
  atWallTime: number,
): SessionClockSnapshot {
  if (atWallTime < snapshot.startedAtWallTime) {
    throw new Error('Cannot pause before the Session started');
  }
  if (snapshot.stoppedAtWallTime !== undefined) {
    throw new Error('Cannot pause a stopped Session clock');
  }
  if (snapshot.pausedIntervals.some((interval) => interval.endedAtWallTime === undefined)) {
    return snapshot;
  }

  return {
    ...snapshot,
    pausedIntervals: [
      ...snapshot.pausedIntervals,
      {
        startedAtWallTime: atWallTime,
        activeTimeAtPause: activeTimeAt(snapshot, atWallTime),
      },
    ],
  };
}

export function resumeSessionClock(
  snapshot: SessionClockSnapshot,
  atWallTime: number,
): SessionClockSnapshot {
  const openPauseIndex = snapshot.pausedIntervals.findIndex(
    (interval) => interval.endedAtWallTime === undefined,
  );
  if (openPauseIndex === -1) return snapshot;

  const openPause = snapshot.pausedIntervals[openPauseIndex];
  if (openPause === undefined) return snapshot;

  if (atWallTime < openPause.startedAtWallTime) {
    throw new Error('Cannot resume before the Session was paused');
  }

  return {
    ...snapshot,
    pausedIntervals: snapshot.pausedIntervals.map((interval, index) =>
      index === openPauseIndex
        ? { ...interval, endedAtWallTime: atWallTime }
        : interval,
    ),
  };
}

export function stopSessionClock(
  snapshot: SessionClockSnapshot,
  atWallTime: number,
): SessionClockSnapshot {
  if (snapshot.stoppedAtWallTime !== undefined) return snapshot;
  if (atWallTime < snapshot.startedAtWallTime) {
    throw new Error('Cannot stop before the Session started');
  }

  return {
    ...resumeSessionClock(snapshot, atWallTime),
    stoppedAtWallTime: atWallTime,
  };
}

export function mapProducerTimeToActiveTime(
  snapshot: SessionClockSnapshot,
  anchor: ProducerClockAnchor,
  producerTime: number,
): number {
  assertTimestamp(producerTime, 'producerTime');
  assertTimestamp(anchor.producerTime, 'anchor.producerTime');
  assertTimestamp(anchor.observedAtWallTime, 'anchor.observedAtWallTime');

  return activeTimeAt(
    snapshot,
    anchor.observedAtWallTime + producerTime - anchor.producerTime,
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
