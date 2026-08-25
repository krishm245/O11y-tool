import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRIVACY_POLICY_VERSION,
  SESSION_SCHEMA_VERSION,
} from '@app-o11y/protocol';
import {
  createSessionStore,
  InvalidSessionTransitionError,
  SessionNotFoundError,
} from './session-store.js';

const target = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  sessionId: 'session-1',
} as const;

describe('SQLite Session store', () => {
  it('owns Session identity, initial lifecycle, and ordering', () => {
    const timestamps = [
      new Date('2026-08-18T12:00:00.000Z'),
      new Date('2026-08-18T12:01:00.000Z'),
    ];
    const identifiers = ['session-1', 'session-2'];
    const sessions = createSessionStore(':memory:', {
      createId: () => identifiers.shift()!,
      now: () => timestamps.shift()!,
    });

    const first = sessions.create({
      schemaVersion: SESSION_SCHEMA_VERSION,
      privacyVersion: PRIVACY_POLICY_VERSION,
      origin: 'https://example.com',
      title: 'First recording',
    });
    const second = sessions.create({
      schemaVersion: SESSION_SCHEMA_VERSION,
      privacyVersion: PRIVACY_POLICY_VERSION,
      origin: 'https://example.com',
      title: 'Second recording',
    });

    expect(first).toMatchObject({ id: 'session-1', state: 'recording' });
    expect(sessions.list()).toEqual([second, first]);
    sessions.close?.();
  });

  it('keeps storage private to each store', () => {
    const first = createSessionStore(':memory:', {
      createId: () => 'session-1',
    });
    const second = createSessionStore(':memory:', {
      createId: () => 'session-2',
    });

    first.create({
      schemaVersion: SESSION_SCHEMA_VERSION,
      privacyVersion: PRIVACY_POLICY_VERSION,
      origin: 'https://example.com',
      title: 'Only in the first module',
    });

    expect(first.list()).toHaveLength(1);
    expect(second.list()).toEqual([]);
    first.close?.();
    second.close?.();
  });

  it('supports validated, idempotent lifecycle transitions', () => {
    const sessions = createSessionStore(':memory:', {
      createId: () => target.sessionId,
      now: () => new Date('2026-08-18T12:00:00.000Z'),
    });
    sessions.create({
      schemaVersion: SESSION_SCHEMA_VERSION,
      privacyVersion: PRIVACY_POLICY_VERSION,
      origin: 'https://example.com',
      title: 'Lifecycle',
    });

    const pauseRequest = {
      ...target,
      pausedAt: '2026-08-18T12:00:10.000Z',
      activeDurationMs: 8_000,
    };
    const paused = sessions.pause(pauseRequest);
    expect(paused).toMatchObject({ state: 'paused', activeDurationMs: 8_000 });
    expect(sessions.pause(pauseRequest)).toEqual(paused);

    const resumeRequest = {
      ...target,
      resumedAt: '2026-08-18T12:00:20.000Z',
    };
    const resumed = sessions.resume(resumeRequest);
    expect(resumed.state).toBe('recording');
    expect(sessions.resume(resumeRequest)).toEqual(resumed);

    const finalizeRequest = {
      ...target,
      recordingEndedAt: '2026-08-18T12:00:30.000Z',
      activeDurationMs: 18_000,
      viewport: { width: 1280, height: 720, devicePixelRatio: 2 },
      codec: 'vp9' as const,
    };
    const processing = sessions.finalize(finalizeRequest);
    expect(processing).toMatchObject({
      state: 'processing',
      activeDurationMs: 18_000,
      viewport: finalizeRequest.viewport,
      codec: 'vp9',
      timestamps: {
        recordingEndedAt: finalizeRequest.recordingEndedAt,
        processingStartedAt: finalizeRequest.recordingEndedAt,
        processingEndedAt: null,
      },
    });
    expect(sessions.finalize(finalizeRequest)).toEqual(processing);
    const finalized = sessions.completeVideo(
      target.sessionId,
      12_345,
      '2026-08-18T12:00:31.000Z',
    );
    expect(finalized).toMatchObject({
      state: 'ready',
      artifactSizes: { videoBytes: 12_345, totalBytes: 12_345 },
      timestamps: { processingEndedAt: '2026-08-18T12:00:31.000Z' },
    });
    expect(sessions.get(target.sessionId)).toEqual(finalized);
    expect(() => sessions.pause(pauseRequest)).toThrow(
      InvalidSessionTransitionError,
    );
    sessions.close?.();
  });

  it('rejects out-of-order lifecycle data and missing Sessions', () => {
    const sessions = createSessionStore(':memory:', {
      createId: () => target.sessionId,
      now: () => new Date('2026-08-18T12:00:00.000Z'),
    });
    sessions.create({
      schemaVersion: SESSION_SCHEMA_VERSION,
      privacyVersion: PRIVACY_POLICY_VERSION,
      origin: 'https://example.com',
      title: 'Validation',
    });

    expect(() =>
      sessions.pause({
        ...target,
        pausedAt: '2026-08-18T11:59:59.000Z',
        activeDurationMs: 0,
      }),
    ).toThrow(InvalidSessionTransitionError);
    expect(() =>
      sessions.pause({
        ...target,
        pausedAt: '2026-08-18T12:00:01.000Z',
        activeDurationMs: 2_000,
      }),
    ).toThrow(InvalidSessionTransitionError);
    expect(() =>
      sessions.resume({
        ...target,
        resumedAt: '2026-08-18T12:00:01.000Z',
      }),
    ).toThrow(InvalidSessionTransitionError);
    expect(() =>
      sessions.resume({
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: 'missing',
        resumedAt: '2026-08-18T12:00:01.000Z',
      }),
    ).toThrow(SessionNotFoundError);
    sessions.close?.();
  });

  it('deletes Sessions idempotently', () => {
    const sessions = createSessionStore(':memory:', {
      createId: () => target.sessionId,
    });
    sessions.create({
      schemaVersion: SESSION_SCHEMA_VERSION,
      privacyVersion: PRIVACY_POLICY_VERSION,
      origin: 'https://example.com',
      title: 'Delete me',
    });

    sessions.delete(target.sessionId);
    sessions.delete(target.sessionId);
    expect(sessions.get(target.sessionId)).toBeUndefined();
    expect(sessions.list()).toEqual([]);
    sessions.close?.();
  });

  it('marks interrupted capture and finalization as incomplete', () => {
    const sessions = createSessionStore(':memory:', {
      createId: () => target.sessionId,
      now: () => new Date('2026-08-18T12:00:00.000Z'),
    });
    sessions.create({
      schemaVersion: SESSION_SCHEMA_VERSION,
      privacyVersion: PRIVACY_POLICY_VERSION,
      origin: 'https://example.com',
      title: 'Interrupted',
    });
    const incomplete = sessions.fail({
      ...target,
      failedAt: '2026-08-18T12:00:10.000Z',
      activeDurationMs: 8_000,
      code: 'capture_interrupted',
      message: 'Chrome restarted',
    });
    expect(incomplete.state).toBe('incomplete');
    sessions.close?.();
  });

  it('recovers Sessions after reopening an on-disk database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'o11y-session-store-'));
    const databasePath = join(directory, 'sessions.sqlite');

    try {
      const first = createSessionStore(databasePath, {
        createId: () => 'persisted-session',
        now: () => new Date('2026-08-18T12:00:00.000Z'),
      });
      const created = first.create({
        schemaVersion: SESSION_SCHEMA_VERSION,
        privacyVersion: PRIVACY_POLICY_VERSION,
        origin: 'https://example.com',
        title: 'Survives restart',
      });
      const paused = first.pause({
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: created.id,
        pausedAt: '2026-08-18T12:00:10.000Z',
        activeDurationMs: 8_000,
      });
      first.close?.();

      const reopened = createSessionStore(databasePath);
      expect(reopened.list()).toEqual([paused]);
      reopened.close?.();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
