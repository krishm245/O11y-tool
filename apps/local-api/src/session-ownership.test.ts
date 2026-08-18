import { describe, expect, it } from 'vitest';
import { SESSION_SCHEMA_VERSION } from '@app-o11y/protocol';
import { createSessionOwnership } from './session-ownership.js';

describe('Session ownership', () => {
  it('owns Session identity, initial lifecycle, and ordering', () => {
    const timestamps = [
      new Date('2026-08-18T12:00:00.000Z'),
      new Date('2026-08-18T12:01:00.000Z'),
    ];
    const identifiers = ['session-1', 'session-2'];
    const sessions = createSessionOwnership({
      createId: () => identifiers.shift()!,
      now: () => timestamps.shift()!,
    });

    const first = sessions.create({
      schemaVersion: SESSION_SCHEMA_VERSION,
      origin: 'https://example.com',
      title: 'First recording',
    });
    const second = sessions.create({
      schemaVersion: SESSION_SCHEMA_VERSION,
      origin: 'https://example.com',
      title: 'Second recording',
    });

    expect(first).toMatchObject({ id: 'session-1', state: 'recording' });
    expect(sessions.list()).toEqual([second, first]);
  });

  it('keeps storage private to each ownership module', () => {
    const first = createSessionOwnership({ createId: () => 'session-1' });
    const second = createSessionOwnership({ createId: () => 'session-2' });

    first.create({
      schemaVersion: SESSION_SCHEMA_VERSION,
      origin: 'https://example.com',
      title: 'Only in the first module',
    });

    expect(first.list()).toHaveLength(1);
    expect(second.list()).toEqual([]);
  });
});
