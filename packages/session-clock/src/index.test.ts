import { describe, expect, it } from 'vitest';
import {
  activeTimeAt,
  formatActiveTime,
  isSessionClockSnapshot,
  startSessionClock,
  pauseSessionClock,
  resumeSessionClock,
} from './index.js';

describe('Session clock', () => {
  it('maps wall time onto active time', () => {
    const clock = startSessionClock(1_000);
    expect(activeTimeAt(clock, 4_250)).toBe(3_250);
  });

  it('never returns a negative active time', () => {
    expect(activeTimeAt(startSessionClock(1_000), 500)).toBe(0);
  });

  it('excludes paused wall time from active time', () => {
    const paused = pauseSessionClock(startSessionClock(1_000), 4_000);
    expect(activeTimeAt(paused, 9_000)).toBe(3_000);
    const resumed = resumeSessionClock(paused, 9_000);
    expect(activeTimeAt(resumed, 11_000)).toBe(5_000);
  });

  it('formats active duration for display', () => {
    expect(formatActiveTime(65_999)).toBe('01:05');
  });

  it('validates persisted clock snapshots', () => {
    expect(isSessionClockSnapshot(startSessionClock(1_000))).toBe(true);
    expect(
      isSessionClockSnapshot({ startedAtWallTime: 'yesterday' }),
    ).toBe(false);
  });
});
