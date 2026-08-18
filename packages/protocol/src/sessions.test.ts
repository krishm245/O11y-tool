import { describe, expect, it } from 'vitest';
import {
  ProtocolValidationError,
  SESSION_SCHEMA_VERSION,
  parseCreateSessionRequest,
  parseSessionListResponse,
  parseSessionManifest,
} from './sessions.js';

const session = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  id: 'session-1',
  origin: 'https://example.com',
  title: 'Checkout',
  state: 'recording',
  createdAt: '2026-08-18T12:00:00.000Z',
} as const;

describe('Session protocol', () => {
  it('accepts a versioned Session request', () => {
    expect(
      parseCreateSessionRequest({
        schemaVersion: SESSION_SCHEMA_VERSION,
        origin: 'https://example.com',
        title: 'Checkout',
      }),
    ).toEqual({
      schemaVersion: SESSION_SCHEMA_VERSION,
      origin: 'https://example.com',
      title: 'Checkout',
    });
  });

  it.each([
    [{}, 'schemaVersion'],
    [
      { schemaVersion: 2, origin: 'https://example.com', title: 'Checkout' },
      'schemaVersion',
    ],
    [
      { schemaVersion: 1, origin: 'https://example.com/path', title: 'Checkout' },
      'origin',
    ],
    [{ schemaVersion: 1, origin: 'https://example.com', title: '' }, 'title'],
  ])('rejects an invalid request %#', (value, message) => {
    expect(() => parseCreateSessionRequest(value)).toThrow(message as string);
  });

  it('parses Session manifests and lists', () => {
    expect(parseSessionManifest(session)).toEqual(session);
    expect(parseSessionListResponse({ sessions: [session] })).toEqual({
      sessions: [session],
    });
  });

  it('rejects unknown Session states', () => {
    expect(() =>
      parseSessionManifest({ ...session, state: 'mystery' }),
    ).toThrow(ProtocolValidationError);
  });
});
