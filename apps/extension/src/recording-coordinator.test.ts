import { describe, expect, it, vi } from 'vitest';
import {
  PRIVACY_POLICY_VERSION,
  SESSION_SCHEMA_VERSION,
  type SessionManifest,
} from '@app-o11y/protocol';
import {
  createRecordingCoordinator,
  type RecordingCoordinatorAdapters,
  type RecordingState,
} from './recording-coordinator';

function buildHarness(initial: unknown = { status: 'idle' }) {
  let stored: unknown = initial;
  const session: SessionManifest = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    privacyVersion: PRIVACY_POLICY_VERSION,
    id: 'session-1',
    origin: 'https://example.com',
    title: 'Checkout',
    state: 'recording',
    timestamps: {
      createdAt: '2026-08-18T12:00:00.000Z',
      recordingStartedAt: '2026-08-18T12:00:00.000Z',
      recordingEndedAt: null,
      processingStartedAt: null,
      processingEndedAt: null,
    },
    activeDurationMs: 0,
    viewport: null,
    codec: null,
    artifactSizes: { videoBytes: 0, eventsBytes: 0, totalBytes: 0 },
    failure: null,
  };
  const indicator = vi.fn<(isRecording: boolean) => Promise<void>>(
    async () => undefined,
  );
  const adapters: RecordingCoordinatorAdapters = {
    state: {
      read: async () => stored,
      write: async (state: RecordingState) => {
        stored = state;
      },
    },
    indicator: { setRecording: indicator },
    sessions: { create: vi.fn(async () => session) },
    now: () => 1_000,
  };

  return {
    adapters,
    coordinator: createRecordingCoordinator(adapters),
    indicator,
  };
}

describe('recording coordination', () => {
  it('creates and persists one recording Session', async () => {
    const { adapters, coordinator, indicator } = buildHarness();
    const state = await coordinator.start({
      id: 7,
      title: 'Checkout',
      origin: 'https://example.com',
    });

    expect(adapters.sessions.create).toHaveBeenCalledWith({
      schemaVersion: SESSION_SCHEMA_VERSION,
      privacyVersion: PRIVACY_POLICY_VERSION,
      title: 'Checkout',
      origin: 'https://example.com',
    });
    expect(state).toMatchObject({
      status: 'recording',
      tabId: 7,
      session: { id: 'session-1' },
      clock: { startedAtWallTime: 1_000 },
    });
    expect(indicator).toHaveBeenCalledWith(true);
  });

  it('makes repeated starts idempotent', async () => {
    const { adapters, coordinator } = buildHarness();
    const tab = { id: 7, title: 'Checkout', origin: 'https://example.com' };

    await coordinator.start(tab);
    await coordinator.start(tab);

    expect(adapters.sessions.create).toHaveBeenCalledTimes(1);
  });

  it('stops when the owned tab closes', async () => {
    const { coordinator, indicator } = buildHarness();
    await coordinator.start({
      id: 7,
      title: 'Checkout',
      origin: 'https://example.com',
    });

    await coordinator.closeTab(7);

    await expect(coordinator.get()).resolves.toEqual({ status: 'idle' });
    expect(indicator).toHaveBeenLastCalledWith(false);
  });

  it('recovers invalid persisted state as idle', async () => {
    const { coordinator } = buildHarness({ status: 'recording', tabId: 'bad' });
    await expect(coordinator.get()).resolves.toEqual({ status: 'idle' });
  });
});
