import { describe, expect, it } from 'vitest';
import {
  PRIVACY_POLICY_VERSION,
  TIMELINE_EVENT_SCHEMA_VERSION,
  parseArtifactChunk,
  parseEventBatch,
} from './index.js';

const event = {
  schemaVersion: TIMELINE_EVENT_SCHEMA_VERSION,
  id: 'session-1:0',
  sessionId: 'session-1',
  activeTimeMs: 12,
  wallTime: '2026-08-24T10:00:00.012Z',
  category: 'network',
  type: 'fetch',
  data: {
    method: 'GET',
    originPath: 'https://example.com/items',
    queryKeys: ['page'],
    status: 200,
  },
} as const;

describe('event protocol', () => {
  it('validates an ordered versioned batch', () => {
    expect(
      parseEventBatch({
        schemaVersion: TIMELINE_EVENT_SCHEMA_VERSION,
        privacyVersion: PRIVACY_POLICY_VERSION,
        sessionId: 'session-1',
        sequence: 0,
        events: [event],
      }),
    ).toMatchObject({ sessionId: 'session-1', events: [event] });
  });

  it('rejects mismatched sessions and reversed event time', () => {
    expect(() =>
      parseEventBatch({
        schemaVersion: 1,
        privacyVersion: 1,
        sessionId: 'session-1',
        sequence: 0,
        events: [{ ...event, sessionId: 'session-2' }],
      }),
    ).toThrow(/sessionId/);
    expect(() =>
      parseEventBatch({
        schemaVersion: 1,
        privacyVersion: 1,
        sessionId: 'session-1',
        sequence: 0,
        events: [event, { ...event, id: 'session-1:1', activeTimeMs: 1 }],
      }),
    ).toThrow(/ordered/);
  });

  it('rejects network bodies, headers, and unsanitized URLs', () => {
    for (const data of [
      { ...event.data, body: 'secret' },
      { ...event.data, headers: { authorization: 'secret' } },
      { ...event.data, originPath: 'https://example.com/items?token=secret' },
    ]) {
      expect(() =>
        parseEventBatch({
          schemaVersion: 1,
          privacyVersion: 1,
          sessionId: 'session-1',
          sequence: 0,
          events: [{ ...event, data }],
        }),
      ).toThrow();
    }
  });

  it('accepts sanitized response data', () => {
    expect(
      parseEventBatch({
        schemaVersion: 1,
        privacyVersion: 1,
        sessionId: 'session-1',
        sequence: 0,
        events: [
          {
            ...event,
            data: { ...event.data, responseData: { id: 42 } },
          },
        ],
      }).events[0]?.data,
    ).toMatchObject({ responseData: { id: 42 } });
  });

  it('accepts event artifact metadata', () => {
    expect(
      parseArtifactChunk({
        schemaVersion: 1,
        sessionId: 'session-1',
        kind: 'events',
        sequence: 0,
        activeTimeStartMs: 0,
        activeTimeEndMs: 12,
        byteLength: 42,
        checksum: 'a'.repeat(64),
      }).kind,
    ).toBe('events');
  });
});
