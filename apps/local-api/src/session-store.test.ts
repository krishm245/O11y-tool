import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRIVACY_POLICY_VERSION,
  SESSION_SCHEMA_VERSION,
} from '@app-o11y/protocol';
import { createSessionStore } from './session-store.js';

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
      first.close?.();

      const reopened = createSessionStore(databasePath);
      expect(reopened.list()).toEqual([created]);
      reopened.close?.();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
