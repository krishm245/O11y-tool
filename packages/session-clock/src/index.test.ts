import { describe, expect, it } from 'vitest';
import {
  activeTimeAt,
  formatActiveTime,
  isSessionClockSnapshot,
  startSessionClock,
} from './index.js';

describe('Session clock', () => {
  it('maps wall time onto active time', () => {
    const clock = startSessionClock(1_000);
    expect(activeTimeAt(clock, 4_250)).toBe(3_250);
  });

  it('never returns a negative active time', () => {
    expect(activeTimeAt(startSessionClock(1_000), 500)).toBe(0);
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
