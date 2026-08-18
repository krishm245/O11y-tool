import { describe, expect, it } from 'vitest';
import {
  PRIVACY_POLICY_VERSION,
  ProtocolValidationError,
  SESSION_SCHEMA_VERSION,
  SESSION_STATUSES,
  parseCreateSessionRequest,
  parseDeleteSessionRequest,
  parseDeleteSessionResponse,
  parseFinalizeSessionRequest,
  parseFinalizeSessionResponse,
  parseGetSessionRequest,
  parseGetSessionResponse,
  parsePauseSessionRequest,
  parsePauseSessionResponse,
  parseResumeSessionRequest,
  parseResumeSessionResponse,
  parseSessionListResponse,
  parseSessionManifest,
  type SessionManifest,
} from './sessions.js';

const session: SessionManifest = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  privacyVersion: PRIVACY_POLICY_VERSION,
  id: 'session-1',
  origin: 'https://example.com',
  title: 'Checkout',
  state: 'ready',
  timestamps: {
    createdAt: '2026-08-18T12:00:00.000Z',
    recordingStartedAt: '2026-08-18T12:00:01.000Z',
    recordingEndedAt: '2026-08-18T12:01:01.000Z',
    processingStartedAt: '2026-08-18T12:01:02.000Z',
    processingEndedAt: '2026-08-18T12:01:03.000Z',
  },
  activeDurationMs: 60_000,
  viewport: { width: 1280, height: 720, devicePixelRatio: 2 },
  codec: 'vp9',
  artifactSizes: {
    videoBytes: 1_000,
    eventsBytes: 200,
    totalBytes: 1_200,
  },
  failure: null,
};

const target = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  sessionId: session.id,
} as const;

const response = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  session,
} as const;

describe('Session manifest protocol', () => {
  it('accepts a versioned create request with capture metadata', () => {
    expect(
      parseCreateSessionRequest({
        schemaVersion: SESSION_SCHEMA_VERSION,
        privacyVersion: PRIVACY_POLICY_VERSION,
        origin: 'https://example.com',
        title: 'Checkout',
        viewport: { width: 1280, height: 720, devicePixelRatio: 2 },
      }),
    ).toEqual({
      schemaVersion: SESSION_SCHEMA_VERSION,
      privacyVersion: PRIVACY_POLICY_VERSION,
      origin: 'https://example.com',
      title: 'Checkout',
      viewport: { width: 1280, height: 720, devicePixelRatio: 2 },
    });
  });

  it.each([
    [{}, 'schemaVersion'],
    [
      {
        schemaVersion: 2,
        privacyVersion: 1,
        origin: 'https://example.com',
        title: 'Checkout',
      },
      'schemaVersion',
    ],
    [
      {
        schemaVersion: 1,
        privacyVersion: 2,
        origin: 'https://example.com',
        title: 'Checkout',
      },
      'privacyVersion',
    ],
    [
      {
        schemaVersion: 1,
        privacyVersion: 1,
        origin: 'https://example.com/path',
        title: 'Checkout',
      },
      'origin',
    ],
  ])('rejects an incompatible create request %#', (value, message) => {
    expect(() => parseCreateSessionRequest(value)).toThrow(message as string);
  });

  it('parses the complete manifest and a versioned list response', () => {
    expect(parseSessionManifest(session)).toEqual(session);
    expect(
      parseSessionListResponse({
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessions: [session],
      }),
    ).toEqual({ schemaVersion: SESSION_SCHEMA_VERSION, sessions: [session] });
  });

  it.each(SESSION_STATUSES)('supports the %s lifecycle state', (state) => {
    const failure =
      state === 'failed'
        ? {
            code: 'capture_failed',
            message: 'The capture stream ended.',
            occurredAt: '2026-08-18T12:01:03.000Z',
          }
        : null;
    expect(parseSessionManifest({ ...session, state, failure }).state).toBe(
      state,
    );
  });

  it.each([
    [{ ...session, state: 'mystery' }, 'state'],
    [{ ...session, activeDurationMs: -1 }, 'activeDurationMs'],
    [
      {
        ...session,
        artifactSizes: { videoBytes: 1, eventsBytes: 2, totalBytes: 4 },
      },
      'artifactSizes.totalBytes',
    ],
    [
      {
        ...session,
        timestamps: {
          ...session.timestamps,
          recordingStartedAt: '2026-08-18T12:02:00.000Z',
        },
      },
      'out of order',
    ],
    [{ ...session, state: 'failed', failure: null }, 'failure'],
  ])('rejects invalid manifest metadata %#', (value, message) => {
    expect(() => parseSessionManifest(value)).toThrow(message as string);
  });

  it('rejects the legacy Milestone 0 manifest shape', () => {
    expect(() =>
      parseSessionManifest({
        schemaVersion: SESSION_SCHEMA_VERSION,
        id: 'session-1',
        origin: 'https://example.com',
        title: 'Checkout',
        state: 'recording',
        createdAt: '2026-08-18T12:00:00.000Z',
      }),
    ).toThrow(ProtocolValidationError);
  });

  it('ignores unknown fields for forward-compatible readers', () => {
    expect(parseSessionManifest({ ...session, futureField: true })).toEqual(
      session,
    );
  });
});

describe('Session lifecycle operation contracts', () => {
  it('validates get request and response payloads', () => {
    expect(parseGetSessionRequest(target)).toEqual(target);
    expect(parseGetSessionResponse(response)).toEqual(response);
  });

  it('validates pause request and response payloads', () => {
    const request = {
      ...target,
      pausedAt: '2026-08-18T12:00:30.000Z',
      activeDurationMs: 29_000,
    };
    expect(parsePauseSessionRequest(request)).toEqual(request);
    expect(parsePauseSessionResponse(response)).toEqual(response);
  });

  it('validates resume request and response payloads', () => {
    const request = {
      ...target,
      resumedAt: '2026-08-18T12:00:40.000Z',
    };
    expect(parseResumeSessionRequest(request)).toEqual(request);
    expect(parseResumeSessionResponse(response)).toEqual(response);
  });

  it('validates finalize request and response payloads', () => {
    const request = {
      ...target,
      recordingEndedAt: '2026-08-18T12:01:01.000Z',
      activeDurationMs: 60_000,
      viewport: { width: 1280, height: 720, devicePixelRatio: 2 },
      codec: 'vp9' as const,
    };
    expect(parseFinalizeSessionRequest(request)).toEqual(request);
    expect(parseFinalizeSessionResponse(response)).toEqual(response);
  });

  it('validates delete request and response payloads', () => {
    const deleteResponse = { ...target, deleted: true as const };
    expect(parseDeleteSessionRequest(target)).toEqual(target);
    expect(parseDeleteSessionResponse(deleteResponse)).toEqual(deleteResponse);
  });

  it('rejects incompatible versions for every operation', () => {
    const incompatibleTarget = { ...target, schemaVersion: 2 };
    const incompatibleResponse = { ...response, schemaVersion: 2 };
    expect(() => parseGetSessionRequest(incompatibleTarget)).toThrow(
      'schemaVersion',
    );
    expect(() => parseGetSessionResponse(incompatibleResponse)).toThrow(
      'schemaVersion',
    );
    expect(() =>
      parsePauseSessionRequest({
        ...incompatibleTarget,
        pausedAt: '2026-08-18T12:00:30.000Z',
        activeDurationMs: 29_000,
      }),
    ).toThrow('schemaVersion');
    expect(() => parsePauseSessionResponse(incompatibleResponse)).toThrow(
      'schemaVersion',
    );
    expect(() =>
      parseResumeSessionRequest({
        ...incompatibleTarget,
        resumedAt: '2026-08-18T12:00:40.000Z',
      }),
    ).toThrow('schemaVersion');
    expect(() => parseResumeSessionResponse(incompatibleResponse)).toThrow(
      'schemaVersion',
    );
    expect(() =>
      parseFinalizeSessionRequest({
        ...incompatibleTarget,
        recordingEndedAt: '2026-08-18T12:01:01.000Z',
        activeDurationMs: 60_000,
        viewport: null,
        codec: null,
      }),
    ).toThrow('schemaVersion');
    expect(() => parseFinalizeSessionResponse(incompatibleResponse)).toThrow(
      'schemaVersion',
    );
    expect(() => parseDeleteSessionRequest(incompatibleTarget)).toThrow(
      'schemaVersion',
    );
    expect(() =>
      parseDeleteSessionResponse({ ...incompatibleTarget, deleted: true }),
    ).toThrow('schemaVersion');
  });

  it('rejects malformed operation fields and responses', () => {
    expect(() =>
      parsePauseSessionRequest({ ...target, pausedAt: 'nope', activeDurationMs: -1 }),
    ).toThrow(ProtocolValidationError);
    expect(() =>
      parseResumeSessionRequest({ ...target, resumedAt: 'nope' }),
    ).toThrow(ProtocolValidationError);
    expect(() =>
      parseFinalizeSessionRequest({
        ...target,
        recordingEndedAt: 'nope',
        activeDurationMs: 0,
        viewport: null,
        codec: null,
      }),
    ).toThrow(ProtocolValidationError);
    expect(() =>
      parseDeleteSessionResponse({ ...target, deleted: false }),
    ).toThrow(ProtocolValidationError);
    expect(() => parseGetSessionResponse({ ...response, schemaVersion: 2 })).toThrow(
      ProtocolValidationError,
    );
  });
});
