import { describe, expect, it } from 'vitest';
import {
  HEALTH_PATH,
  WEB_DEV_ORIGINS,
  type HealthResponse,
} from '@app-o11y/protocol';
import { buildApp } from './app.js';

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
