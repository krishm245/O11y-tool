import { describe, expect, it } from 'vitest';
import {
  PRIVACY_POLICY_VERSION,
  SESSION_SCHEMA_VERSION,
} from '@app-o11y/protocol';
import { createSessionStore } from './session-store.js';

describe('in-memory Session store', () => {
  it('owns Session identity, initial lifecycle, and ordering', () => {
    const timestamps = [
      new Date('2026-08-18T12:00:00.000Z'),
      new Date('2026-08-18T12:01:00.000Z'),
    ];
    const identifiers = ['session-1', 'session-2'];
    const sessions = createSessionStore({
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
  });

  it('keeps storage private to each store', () => {
    const first = createSessionStore({ createId: () => 'session-1' });
    const second = createSessionStore({ createId: () => 'session-2' });

    first.create({
      schemaVersion: SESSION_SCHEMA_VERSION,
      privacyVersion: PRIVACY_POLICY_VERSION,
      origin: 'https://example.com',
      title: 'Only in the first module',
    });

    expect(first.list()).toHaveLength(1);
    expect(second.list()).toEqual([]);
  });
});
