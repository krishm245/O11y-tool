import { ProtocolValidationError } from './sessions.js';

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

export function parseHealthResponse(value: unknown): HealthResponse {
  if (!isHealthResponse(value)) {
    throw new ProtocolValidationError('Invalid health response');
  }

  return value;
}
