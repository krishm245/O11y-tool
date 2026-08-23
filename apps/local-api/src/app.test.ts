import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  HEALTH_PATH,
  PRIVACY_POLICY_VERSION,
  SESSION_COLLECTION_PATH,
  SESSION_FINALIZE_PATH,
  SESSION_ITEM_PATH,
  SESSION_PAUSE_PATH,
  SESSION_RESUME_PATH,
  SESSION_SCHEMA_VERSION,
  SESSION_VIDEO_CHUNK_PATH,
  SESSION_VIDEO_COMPLETE_PATH,
  SESSION_VIDEO_PATH,
  type DeleteSessionResponse,
  type FinalizeSessionResponse,
  type GetSessionResponse,
  type HealthResponse,
  type PauseSessionResponse,
  type ResumeSessionResponse,
  type SessionListResponse,
  type SessionManifest,
} from '@app-o11y/protocol';
import { buildApp } from './app.js';
import { WEB_DEV_ORIGINS } from './config.js';
import { createSessionStore } from './session-store.js';

function sessionPath(path: string, sessionId: string) {
  return path.replace(':sessionId', sessionId);
}

describe(`GET ${HEALTH_PATH}`, () => {
  it('reports that the local service is ready', async () => {
    const app = buildApp();

    const response = await app.inject({ method: 'GET', url: HEALTH_PATH });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json<HealthResponse>()).toEqual({
      status: 'ok',
      service: 'o11y-local-api',
      version: 1,
    });
  });

  it.each(WEB_DEV_ORIGINS)('allows the web origin %s', async (origin) => {
    const app = buildApp();

    const response = await app.inject({
      method: 'GET',
      url: HEALTH_PATH,
      headers: { origin },
    });
    await app.close();

    expect(response.headers['access-control-allow-origin']).toBe(origin);
  });

  it('does not allow unrelated web origins', async () => {
    const app = buildApp();

    const response = await app.inject({
      method: 'GET',
      url: HEALTH_PATH,
      headers: { origin: 'https://example.com' },
    });
    await app.close();

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows the web app to preflight Session deletion', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/sessions/session-1',
      headers: {
        origin: WEB_DEV_ORIGINS[0],
        'access-control-request-method': 'DELETE',
      },
    });
    await app.close();

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-methods']).toContain(
      'DELETE',
    );
  });
});

describe('video artifact routes', () => {
  it('stores chunks idempotently, assembles video, and serves byte ranges', async () => {
    const sessionId = 'video-session';
    const app = buildApp({
      sessions: createSessionStore(':memory:', {
        createId: () => sessionId,
        now: () => new Date('2026-08-18T12:00:00.000Z'),
      }),
    });
    await app.inject({
      method: 'POST',
      url: SESSION_COLLECTION_PATH,
      payload: {
        schemaVersion: SESSION_SCHEMA_VERSION,
        privacyVersion: PRIVACY_POLICY_VERSION,
        origin: 'https://example.com',
        title: 'Video recording',
      },
    });

    const chunks = [Buffer.from('first-webm-part'), Buffer.from('second-part')];
    for (const [sequence, bytes] of chunks.entries()) {
      const url = sessionPath(SESSION_VIDEO_CHUNK_PATH, sessionId).replace(
        ':sequence',
        String(sequence),
      );
      const headers = {
        'content-type': 'application/octet-stream',
        'x-o11y-schema-version': '1',
        'x-o11y-active-start-ms': String(sequence * 5_000),
        'x-o11y-active-end-ms': String((sequence + 1) * 5_000),
        'x-o11y-checksum': createHash('sha256').update(bytes).digest('hex'),
      };
      const uploaded = await app.inject({
        method: 'POST',
        url,
        headers,
        payload: bytes,
      });
      expect(uploaded.statusCode).toBe(201);
      if (sequence === 0) {
        const duplicate = await app.inject({
          method: 'POST',
          url,
          headers,
          payload: bytes,
        });
        expect(duplicate.statusCode).toBe(200);
        expect(duplicate.json()).toMatchObject({ stored: false });
      }
    }

    await app.inject({
      method: 'POST',
      url: sessionPath(SESSION_FINALIZE_PATH, sessionId),
      payload: {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId,
        recordingEndedAt: '2026-08-18T12:00:10.000Z',
        activeDurationMs: 10_000,
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
        codec: 'vp9',
      },
    });
    const completed = await app.inject({
      method: 'POST',
      url: sessionPath(SESSION_VIDEO_COMPLETE_PATH, sessionId),
      payload: { schemaVersion: SESSION_SCHEMA_VERSION, sessionId },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json<FinalizeSessionResponse>().session).toMatchObject({
      state: 'ready',
      codec: 'vp9',
      artifactSizes: {
        videoBytes: chunks[0]!.length + chunks[1]!.length,
      },
    });

    const videoUrl = sessionPath(SESSION_VIDEO_PATH, sessionId);
    const full = await app.inject({ method: 'GET', url: videoUrl });
    expect(full.statusCode).toBe(200);
    expect(full.rawPayload).toEqual(Buffer.concat(chunks));
    expect(full.headers['accept-ranges']).toBe('bytes');

    const range = await app.inject({
      method: 'GET',
      url: videoUrl,
      headers: { range: 'bytes=2-7' },
    });
    expect(range.statusCode).toBe(206);
    expect(range.headers['content-range']).toBe(
      `bytes 2-7/${Buffer.concat(chunks).length}`,
    );
    expect(range.rawPayload).toEqual(Buffer.concat(chunks).subarray(2, 8));
    await app.close();
  });

  it('rejects a video chunk whose checksum is wrong', async () => {
    const app = buildApp();
    const created = await app.inject({
      method: 'POST',
      url: SESSION_COLLECTION_PATH,
      payload: {
        schemaVersion: SESSION_SCHEMA_VERSION,
        privacyVersion: PRIVACY_POLICY_VERSION,
        origin: 'https://example.com',
        title: 'Bad chunk',
      },
    });
    const sessionId = created.json<SessionManifest>().id;
    const response = await app.inject({
      method: 'POST',
      url: sessionPath(SESSION_VIDEO_CHUNK_PATH, sessionId).replace(
        ':sequence',
        '0',
      ),
      headers: {
        'content-type': 'application/octet-stream',
        'x-o11y-schema-version': '1',
        'x-o11y-active-start-ms': '0',
        'x-o11y-active-end-ms': '1000',
        'x-o11y-checksum': '0'.repeat(64),
      },
      payload: Buffer.from('corrupt'),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'artifact_conflict' });
    await app.close();
  });
});

describe(SESSION_COLLECTION_PATH, () => {
  it('creates and lists a Session through the Fastify adapter', async () => {
    const app = buildApp();
    const created = await app.inject({
      method: 'POST',
      url: SESSION_COLLECTION_PATH,
      payload: {
        schemaVersion: SESSION_SCHEMA_VERSION,
        privacyVersion: PRIVACY_POLICY_VERSION,
        origin: 'https://example.com',
        title: 'Checkout',
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json<SessionManifest>()).toMatchObject({
      schemaVersion: SESSION_SCHEMA_VERSION,
      privacyVersion: PRIVACY_POLICY_VERSION,
      origin: 'https://example.com',
      title: 'Checkout',
      state: 'recording',
    });

    const listed = await app.inject({
      method: 'GET',
      url: SESSION_COLLECTION_PATH,
    });
    await app.close();

    expect(listed.statusCode).toBe(200);
    expect(listed.json<SessionListResponse>()).toEqual({
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessions: [created.json<SessionManifest>()],
    });
  });

  it('rejects invalid Session input at the HTTP seam', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'POST',
      url: SESSION_COLLECTION_PATH,
      payload: {
        schemaVersion: 99,
        origin: 'https://example.com/path',
        title: '',
      },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_session' });
  });
});

describe('Session lifecycle routes', () => {
  it('gets, pauses, resumes, finalizes, and deletes a Session idempotently', async () => {
    const sessionId = 'route-session';
    const app = buildApp({
      sessions: createSessionStore(':memory:', {
        createId: () => sessionId,
        now: () => new Date('2026-08-18T12:00:00.000Z'),
      }),
    });
    const createdResponse = await app.inject({
      method: 'POST',
      url: SESSION_COLLECTION_PATH,
      payload: {
        schemaVersion: SESSION_SCHEMA_VERSION,
        privacyVersion: PRIVACY_POLICY_VERSION,
        origin: 'https://example.com',
        title: 'Route lifecycle',
      },
    });
    const created = createdResponse.json<SessionManifest>();

    const getResponse = await app.inject({
      method: 'GET',
      url: sessionPath(SESSION_ITEM_PATH, sessionId),
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json<GetSessionResponse>().session).toEqual(created);

    const pausePayload = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId,
      pausedAt: '2026-08-18T12:00:10.000Z',
      activeDurationMs: 8_000,
    };
    const pauseResponse = await app.inject({
      method: 'POST',
      url: sessionPath(SESSION_PAUSE_PATH, sessionId),
      payload: pausePayload,
    });
    const paused = pauseResponse.json<PauseSessionResponse>().session;
    expect(paused).toMatchObject({ state: 'paused', activeDurationMs: 8_000 });
    const repeatedPause = await app.inject({
      method: 'POST',
      url: sessionPath(SESSION_PAUSE_PATH, sessionId),
      payload: pausePayload,
    });
    expect(repeatedPause.json<PauseSessionResponse>().session).toEqual(paused);

    const resumePayload = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId,
      resumedAt: '2026-08-18T12:00:20.000Z',
    };
    const resumeResponse = await app.inject({
      method: 'POST',
      url: sessionPath(SESSION_RESUME_PATH, sessionId),
      payload: resumePayload,
    });
    const resumed = resumeResponse.json<ResumeSessionResponse>().session;
    expect(resumed.state).toBe('recording');
    const repeatedResume = await app.inject({
      method: 'POST',
      url: sessionPath(SESSION_RESUME_PATH, sessionId),
      payload: resumePayload,
    });
    expect(repeatedResume.json<ResumeSessionResponse>().session).toEqual(
      resumed,
    );

    const finalizePayload = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId,
      recordingEndedAt: '2026-08-18T12:00:30.000Z',
      activeDurationMs: 18_000,
      viewport: { width: 1280, height: 720, devicePixelRatio: 2 },
      codec: null,
    };
    const finalizeResponse = await app.inject({
      method: 'POST',
      url: sessionPath(SESSION_FINALIZE_PATH, sessionId),
      payload: finalizePayload,
    });
    const finalized = finalizeResponse.json<FinalizeSessionResponse>().session;
    expect(finalized).toMatchObject({
      state: 'ready',
      activeDurationMs: 18_000,
    });
    const repeatedFinalize = await app.inject({
      method: 'POST',
      url: sessionPath(SESSION_FINALIZE_PATH, sessionId),
      payload: finalizePayload,
    });
    expect(repeatedFinalize.json<FinalizeSessionResponse>().session).toEqual(
      finalized,
    );

    const deleteUrl = sessionPath(SESSION_ITEM_PATH, sessionId);
    const deleted = await app.inject({ method: 'DELETE', url: deleteUrl });
    expect(deleted.json<DeleteSessionResponse>()).toEqual({
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId,
      deleted: true,
    });
    const deletedAgain = await app.inject({ method: 'DELETE', url: deleteUrl });
    expect(deletedAgain.statusCode).toBe(200);

    const missing = await app.inject({ method: 'GET', url: deleteUrl });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: 'session_not_found' });
    await app.close();
  });

  it('rejects mismatched IDs and invalid lifecycle transitions', async () => {
    const sessionId = 'validation-session';
    const app = buildApp({
      sessions: createSessionStore(':memory:', {
        createId: () => sessionId,
        now: () => new Date('2026-08-18T12:00:00.000Z'),
      }),
    });
    await app.inject({
      method: 'POST',
      url: SESSION_COLLECTION_PATH,
      payload: {
        schemaVersion: SESSION_SCHEMA_VERSION,
        privacyVersion: PRIVACY_POLICY_VERSION,
        origin: 'https://example.com',
        title: 'Validate routes',
      },
    });

    const mismatch = await app.inject({
      method: 'POST',
      url: sessionPath(SESSION_PAUSE_PATH, sessionId),
      payload: {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: 'another-session',
        pausedAt: '2026-08-18T12:00:10.000Z',
        activeDurationMs: 8_000,
      },
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({ error: 'invalid_session' });

    const invalidDuration = await app.inject({
      method: 'POST',
      url: sessionPath(SESSION_PAUSE_PATH, sessionId),
      payload: {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId,
        pausedAt: '2026-08-18T12:00:01.000Z',
        activeDurationMs: 2_000,
      },
    });
    expect(invalidDuration.statusCode).toBe(409);
    expect(invalidDuration.json()).toMatchObject({
      error: 'invalid_session_transition',
    });

    const missing = await app.inject({
      method: 'POST',
      url: sessionPath(SESSION_RESUME_PATH, 'missing'),
      payload: {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: 'missing',
        resumedAt: '2026-08-18T12:00:10.000Z',
      },
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
