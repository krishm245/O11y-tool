export const LOCAL_API_HOST = '127.0.0.1';
export const LOCAL_API_PORT = 7331;
export const LOCAL_API_ORIGIN = `http://${LOCAL_API_HOST}:${LOCAL_API_PORT}`;
export const WEB_DEV_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
] as const;
export const HEALTH_PATH = '/health';

export type HealthResponse = {
  status: 'ok';
  service: 'o11y-local-api';
  version: 1;
};

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;
  return (
    candidate.status === 'ok' &&
    candidate.service === 'o11y-local-api' &&
    candidate.version === 1
  );
}
