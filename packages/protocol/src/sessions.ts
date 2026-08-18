export const SESSION_SCHEMA_VERSION = 1 as const;
export const SESSION_COLLECTION_PATH = '/v1/sessions';

export const SESSION_STATUSES = [
  'creating',
  'recording',
  'paused',
  'processing',
  'ready',
  'incomplete',
  'failed',
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export type CreateSessionRequest = {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  origin: string;
  title: string;
};

export type SessionManifest = CreateSessionRequest & {
  id: string;
  state: SessionStatus;
  createdAt: string;
};

export type SessionListResponse = {
  sessions: SessionManifest[];
};

export class ProtocolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonEmptyString(
  value: Record<string, unknown>,
  key: string,
): string {
  const field = value[key];
  if (typeof field !== 'string' || field.trim().length === 0) {
    throw new ProtocolValidationError(`${key} must be a non-empty string`);
  }

  return field;
}

function readOrigin(value: Record<string, unknown>): string {
  const origin = readNonEmptyString(value, 'origin');

  try {
    const url = new URL(origin);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.origin !== origin
    ) {
      throw new Error('not an HTTP origin');
    }
  } catch {
    throw new ProtocolValidationError(
      'origin must be an absolute HTTP or HTTPS origin',
    );
  }

  return origin;
}

function readSchemaVersion(
  value: Record<string, unknown>,
): typeof SESSION_SCHEMA_VERSION {
  if (value.schemaVersion !== SESSION_SCHEMA_VERSION) {
    throw new ProtocolValidationError(
      `schemaVersion must be ${SESSION_SCHEMA_VERSION}`,
    );
  }

  return SESSION_SCHEMA_VERSION;
}

export function parseCreateSessionRequest(value: unknown): CreateSessionRequest {
  if (!isRecord(value)) {
    throw new ProtocolValidationError('Session request must be an object');
  }

  return {
    schemaVersion: readSchemaVersion(value),
    origin: readOrigin(value),
    title: readNonEmptyString(value, 'title'),
  };
}

export function parseSessionManifest(value: unknown): SessionManifest {
  if (!isRecord(value)) {
    throw new ProtocolValidationError('Session manifest must be an object');
  }

  const request = parseCreateSessionRequest(value);
  const id = readNonEmptyString(value, 'id');
  const createdAt = readNonEmptyString(value, 'createdAt');

  if (Number.isNaN(Date.parse(createdAt))) {
    throw new ProtocolValidationError('createdAt must be an ISO timestamp');
  }

  if (!SESSION_STATUSES.includes(value.state as SessionStatus)) {
    throw new ProtocolValidationError('state is not a supported Session status');
  }

  return {
    ...request,
    id,
    state: value.state as SessionStatus,
    createdAt,
  };
}

export function isSessionManifest(value: unknown): value is SessionManifest {
  try {
    parseSessionManifest(value);
    return true;
  } catch {
    return false;
  }
}

export function parseSessionListResponse(value: unknown): SessionListResponse {
  if (!isRecord(value) || !Array.isArray(value.sessions)) {
    throw new ProtocolValidationError(
      'Session list response must contain sessions',
    );
  }

  return { sessions: value.sessions.map(parseSessionManifest) };
}
