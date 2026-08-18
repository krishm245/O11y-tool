import { describe, expect, it } from 'vitest';
import {
  activeTimeAt,
  formatActiveTime,
  isSessionClockSnapshot,
  mapProducerTimeToActiveTime,
  pauseSessionClock,
  resumeSessionClock,
  startSessionClock,
  stopSessionClock,
} from './index.js';

describe('Session clock', () => {
  it('maps wall time onto active time', () => {
    const clock = startSessionClock(1_000);
    expect(activeTimeAt(clock, 4_250)).toBe(3_250);
  });

  it('excludes paused intervals', () => {
    const started = startSessionClock(1_000);
    const paused = pauseSessionClock(started, 4_000);

    expect(activeTimeAt(paused, 9_000)).toBe(3_000);

    const resumed = resumeSessionClock(paused, 9_000);
    expect(activeTimeAt(resumed, 11_000)).toBe(5_000);
    expect(resumed.pausedIntervals).toEqual([
      {
        startedAtWallTime: 4_000,
        endedAtWallTime: 9_000,
        activeTimeAtPause: 3_000,
      },
    ]);
  });

  it('freezes active time when stopped', () => {
    const stopped = stopSessionClock(startSessionClock(1_000), 6_000);
    expect(activeTimeAt(stopped, 20_000)).toBe(5_000);
  });

  it('maps a producer clock through its observed anchor', () => {
    const clock = resumeSessionClock(
      pauseSessionClock(startSessionClock(1_000), 4_000),
      6_000,
    );
    const anchor = { producerTime: 50, observedAtWallTime: 7_000 };

    expect(mapProducerTimeToActiveTime(clock, anchor, 1_050)).toBe(5_000);
  });

  it('formats active duration for display', () => {
    expect(formatActiveTime(65_999)).toBe('01:05');
  });

  it('validates persisted clock snapshots', () => {
    expect(isSessionClockSnapshot(startSessionClock(1_000))).toBe(true);
    expect(
      isSessionClockSnapshot({ startedAtWallTime: 'yesterday', pausedIntervals: [] }),
    ).toBe(false);
  });
});
