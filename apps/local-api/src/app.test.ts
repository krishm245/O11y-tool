import { describe, expect, it } from 'vitest';
import {
  HEALTH_PATH,
  SESSION_COLLECTION_PATH,
  SESSION_SCHEMA_VERSION,
  type HealthResponse,
  type SessionListResponse,
  type SessionManifest,
} from '@app-o11y/protocol';
import { buildApp } from './app.js';
import { WEB_DEV_ORIGINS } from './config.js';

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
});

describe(SESSION_COLLECTION_PATH, () => {
  it('creates and lists a Session through the Fastify adapter', async () => {
    const app = buildApp();
    const created = await app.inject({
      method: 'POST',
      url: SESSION_COLLECTION_PATH,
      payload: {
        schemaVersion: SESSION_SCHEMA_VERSION,
        origin: 'https://example.com',
        title: 'Checkout',
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json<SessionManifest>()).toMatchObject({
      schemaVersion: SESSION_SCHEMA_VERSION,
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
    expect(listed.json<SessionListResponse>().sessions).toEqual([
      created.json<SessionManifest>(),
    ]);
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
