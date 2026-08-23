export const SESSION_SCHEMA_VERSION = 1 as const;
export const PRIVACY_POLICY_VERSION = 1 as const;
export const SESSION_COLLECTION_PATH = '/v1/sessions';
export const SESSION_ITEM_PATH = `${SESSION_COLLECTION_PATH}/:sessionId`;
export const SESSION_PAUSE_PATH = `${SESSION_ITEM_PATH}/pause`;
export const SESSION_RESUME_PATH = `${SESSION_ITEM_PATH}/resume`;
export const SESSION_FINALIZE_PATH = `${SESSION_ITEM_PATH}/finalize`;
export const SESSION_FAIL_PATH = `${SESSION_ITEM_PATH}/fail`;
export const SESSION_VIDEO_PATH = `${SESSION_ITEM_PATH}/video`;
export const SESSION_VIDEO_CHUNK_PATH = `${SESSION_VIDEO_PATH}/chunks/:sequence`;
export const SESSION_VIDEO_COMPLETE_PATH = `${SESSION_VIDEO_PATH}/complete`;
export const ARTIFACT_CHUNK_SCHEMA_VERSION = 1 as const;
export const ARTIFACT_CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;

export const SESSION_STATUSES = [
  'creating',
  'recording',
  'paused',
  'processing',
  'ready',
  'incomplete',
  'failed',
] as const;

export const SESSION_VIDEO_CODECS = ['vp9', 'vp8'] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type SessionVideoCodec = (typeof SESSION_VIDEO_CODECS)[number];
export type ArtifactKind = 'video';

export type ArtifactChunk = {
  schemaVersion: typeof ARTIFACT_CHUNK_SCHEMA_VERSION;
  sessionId: string;
  kind: ArtifactKind;
  sequence: number;
  activeTimeStartMs: number;
  activeTimeEndMs: number;
  byteLength: number;
  checksum: string;
};

export type SessionViewport = {
  width: number;
  height: number;
  devicePixelRatio: number;
};

export type SessionTimestamps = {
  createdAt: string;
  recordingStartedAt: string | null;
  recordingEndedAt: string | null;
  processingStartedAt: string | null;
  processingEndedAt: string | null;
};

export type SessionArtifactSizes = {
  videoBytes: number;
  eventsBytes: number;
  totalBytes: number;
};

export type SessionFailure = {
  code: string;
  message: string;
  occurredAt: string;
};

export type CreateSessionRequest = {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  privacyVersion: typeof PRIVACY_POLICY_VERSION;
  origin: string;
  title: string;
  viewport?: SessionViewport;
};

export type SessionManifest = {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  privacyVersion: typeof PRIVACY_POLICY_VERSION;
  id: string;
  origin: string;
  title: string;
  state: SessionStatus;
  timestamps: SessionTimestamps;
  activeDurationMs: number;
  viewport: SessionViewport | null;
  codec: SessionVideoCodec | null;
  artifactSizes: SessionArtifactSizes;
  failure: SessionFailure | null;
};

export type SessionListResponse = {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  sessions: SessionManifest[];
};

export type GetSessionRequest = SessionTargetRequest;
export type DeleteSessionRequest = SessionTargetRequest;

export type PauseSessionRequest = SessionTargetRequest & {
  pausedAt: string;
  activeDurationMs: number;
};

export type ResumeSessionRequest = SessionTargetRequest & {
  resumedAt: string;
};

export type FinalizeSessionRequest = SessionTargetRequest & {
  recordingEndedAt: string;
  activeDurationMs: number;
  viewport: SessionViewport | null;
  codec: SessionVideoCodec | null;
};

export type FailSessionRequest = SessionTargetRequest & {
  failedAt: string;
  activeDurationMs: number;
  code: string;
  message: string;
};

export type CompleteVideoRequest = SessionTargetRequest;

export type UploadArtifactChunkResponse = {
  schemaVersion: typeof ARTIFACT_CHUNK_SCHEMA_VERSION;
  chunk: ArtifactChunk;
  stored: boolean;
};

export type GetSessionResponse = SessionResponse;
export type PauseSessionResponse = SessionResponse;
export type ResumeSessionResponse = SessionResponse;
export type FinalizeSessionResponse = SessionResponse;
export type FailSessionResponse = SessionResponse;
export type CompleteVideoResponse = SessionResponse;

export type DeleteSessionResponse = {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  sessionId: string;
  deleted: true;
};

type SessionTargetRequest = {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  sessionId: string;
};

type SessionResponse = {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  session: SessionManifest;
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

function readRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ProtocolValidationError(`${name} must be an object`);
  }
  return value;
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

function readNonNegativeInteger(
  value: Record<string, unknown>,
  key: string,
): number {
  const field = value[key];
  if (!Number.isSafeInteger(field) || (field as number) < 0) {
    throw new ProtocolValidationError(
      `${key} must be a non-negative safe integer`,
    );
  }
  return field as number;
}

function readSessionId(value: Record<string, unknown>): string {
  const sessionId = readNonEmptyString(value, 'sessionId');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionId)) {
    throw new ProtocolValidationError(
      'sessionId contains unsupported characters',
    );
  }
  return sessionId;
}

function readTimestamp(value: Record<string, unknown>, key: string): string {
  const timestamp = readNonEmptyString(value, key);
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new ProtocolValidationError(`${key} must be an ISO timestamp`);
  }
  return timestamp;
}

function readNullableTimestamp(
  value: Record<string, unknown>,
  key: string,
): string | null {
  return value[key] === null ? null : readTimestamp(value, key);
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

function readPrivacyVersion(
  value: Record<string, unknown>,
): typeof PRIVACY_POLICY_VERSION {
  if (value.privacyVersion !== PRIVACY_POLICY_VERSION) {
    throw new ProtocolValidationError(
      `privacyVersion must be ${PRIVACY_POLICY_VERSION}`,
    );
  }
  return PRIVACY_POLICY_VERSION;
}

function parseSessionViewport(value: unknown): SessionViewport {
  const viewport = readRecord(value, 'viewport');
  const width = readNonNegativeInteger(viewport, 'width');
  const height = readNonNegativeInteger(viewport, 'height');
  const devicePixelRatio = viewport.devicePixelRatio;

  if (width === 0 || height === 0) {
    throw new ProtocolValidationError('viewport dimensions must be positive');
  }
  if (
    typeof devicePixelRatio !== 'number' ||
    !Number.isFinite(devicePixelRatio) ||
    devicePixelRatio <= 0
  ) {
    throw new ProtocolValidationError(
      'devicePixelRatio must be a positive finite number',
    );
  }

  return { width, height, devicePixelRatio };
}

function parseSessionTimestamps(value: unknown): SessionTimestamps {
  const timestamps = readRecord(value, 'timestamps');
  const parsed: SessionTimestamps = {
    createdAt: readTimestamp(timestamps, 'createdAt'),
    recordingStartedAt: readNullableTimestamp(timestamps, 'recordingStartedAt'),
    recordingEndedAt: readNullableTimestamp(timestamps, 'recordingEndedAt'),
    processingStartedAt: readNullableTimestamp(
      timestamps,
      'processingStartedAt',
    ),
    processingEndedAt: readNullableTimestamp(timestamps, 'processingEndedAt'),
  };

  const ordered = [
    parsed.createdAt,
    parsed.recordingStartedAt,
    parsed.recordingEndedAt,
    parsed.processingStartedAt,
    parsed.processingEndedAt,
  ].filter((timestamp): timestamp is string => timestamp !== null);

  for (let index = 1; index < ordered.length; index += 1) {
    if (Date.parse(ordered[index]!) < Date.parse(ordered[index - 1]!)) {
      throw new ProtocolValidationError('Session timestamps are out of order');
    }
  }

  if (parsed.recordingEndedAt !== null && parsed.recordingStartedAt === null) {
    throw new ProtocolValidationError(
      'recordingStartedAt is required before recordingEndedAt',
    );
  }
  if (
    parsed.processingEndedAt !== null &&
    parsed.processingStartedAt === null
  ) {
    throw new ProtocolValidationError(
      'processingStartedAt is required before processingEndedAt',
    );
  }

  return parsed;
}

function parseArtifactSizes(value: unknown): SessionArtifactSizes {
  const sizes = readRecord(value, 'artifactSizes');
  const parsed = {
    videoBytes: readNonNegativeInteger(sizes, 'videoBytes'),
    eventsBytes: readNonNegativeInteger(sizes, 'eventsBytes'),
    totalBytes: readNonNegativeInteger(sizes, 'totalBytes'),
  };
  if (parsed.totalBytes !== parsed.videoBytes + parsed.eventsBytes) {
    throw new ProtocolValidationError(
      'artifactSizes.totalBytes must equal videoBytes plus eventsBytes',
    );
  }
  return parsed;
}

function parseFailure(value: unknown): SessionFailure | null {
  if (value === null) return null;
  const failure = readRecord(value, 'failure');
  return {
    code: readNonEmptyString(failure, 'code'),
    message: readNonEmptyString(failure, 'message'),
    occurredAt: readTimestamp(failure, 'occurredAt'),
  };
}

function readCodec(value: unknown): SessionVideoCodec | null {
  if (value === null) return null;
  if (!SESSION_VIDEO_CODECS.includes(value as SessionVideoCodec)) {
    throw new ProtocolValidationError('codec is not supported');
  }
  return value as SessionVideoCodec;
}

function parseSessionTarget(
  value: unknown,
  name: string,
): SessionTargetRequest {
  const request = readRecord(value, name);
  return {
    schemaVersion: readSchemaVersion(request),
    sessionId: readSessionId(request),
  };
}

export function parseArtifactChunk(value: unknown): ArtifactChunk {
  const chunk = readRecord(value, 'Artifact chunk');
  if (chunk.schemaVersion !== ARTIFACT_CHUNK_SCHEMA_VERSION) {
    throw new ProtocolValidationError(
      `schemaVersion must be ${ARTIFACT_CHUNK_SCHEMA_VERSION}`,
    );
  }
  if (chunk.kind !== 'video') {
    throw new ProtocolValidationError('kind must be video');
  }

  const activeTimeStartMs = readNonNegativeInteger(chunk, 'activeTimeStartMs');
  const activeTimeEndMs = readNonNegativeInteger(chunk, 'activeTimeEndMs');
  if (activeTimeEndMs < activeTimeStartMs) {
    throw new ProtocolValidationError(
      'activeTimeEndMs cannot be before activeTimeStartMs',
    );
  }
  const byteLength = readNonNegativeInteger(chunk, 'byteLength');
  if (byteLength === 0) {
    throw new ProtocolValidationError('byteLength must be positive');
  }
  const checksum = readNonEmptyString(chunk, 'checksum').toLowerCase();
  if (!ARTIFACT_CHECKSUM_PATTERN.test(checksum)) {
    throw new ProtocolValidationError('checksum must be a SHA-256 hex digest');
  }

  return {
    schemaVersion: ARTIFACT_CHUNK_SCHEMA_VERSION,
    sessionId: readSessionId(chunk),
    kind: 'video',
    sequence: readNonNegativeInteger(chunk, 'sequence'),
    activeTimeStartMs,
    activeTimeEndMs,
    byteLength,
    checksum,
  };
}

export function parseUploadArtifactChunkResponse(
  value: unknown,
): UploadArtifactChunkResponse {
  const response = readRecord(value, 'Upload artifact chunk response');
  if (response.schemaVersion !== ARTIFACT_CHUNK_SCHEMA_VERSION) {
    throw new ProtocolValidationError(
      `schemaVersion must be ${ARTIFACT_CHUNK_SCHEMA_VERSION}`,
    );
  }
  if (response.stored !== true && response.stored !== false) {
    throw new ProtocolValidationError('stored must be a boolean');
  }
  return {
    schemaVersion: ARTIFACT_CHUNK_SCHEMA_VERSION,
    chunk: parseArtifactChunk(response.chunk),
    stored: response.stored,
  };
}

function parseSessionResponse(value: unknown, name: string): SessionResponse {
  const response = readRecord(value, name);
  return {
    schemaVersion: readSchemaVersion(response),
    session: parseSessionManifest(response.session),
  };
}

export function parseCreateSessionRequest(
  value: unknown,
): CreateSessionRequest {
  const request = readRecord(value, 'Session request');
  const viewport = request.viewport;
  return {
    schemaVersion: readSchemaVersion(request),
    privacyVersion: readPrivacyVersion(request),
    origin: readOrigin(request),
    title: readNonEmptyString(request, 'title'),
    ...(viewport === undefined
      ? {}
      : { viewport: parseSessionViewport(viewport) }),
  };
}

export function parseSessionManifest(value: unknown): SessionManifest {
  const manifest = readRecord(value, 'Session manifest');
  const state = manifest.state;
  if (!SESSION_STATUSES.includes(state as SessionStatus)) {
    throw new ProtocolValidationError(
      'state is not a supported Session status',
    );
  }

  const timestamps = parseSessionTimestamps(manifest.timestamps);
  const failure = parseFailure(manifest.failure);
  if (state === 'failed' && failure === null) {
    throw new ProtocolValidationError(
      'failed Sessions require failure information',
    );
  }

  return {
    schemaVersion: readSchemaVersion(manifest),
    privacyVersion: readPrivacyVersion(manifest),
    id: readNonEmptyString(manifest, 'id'),
    origin: readOrigin(manifest),
    title: readNonEmptyString(manifest, 'title'),
    state: state as SessionStatus,
    timestamps,
    activeDurationMs: readNonNegativeInteger(manifest, 'activeDurationMs'),
    viewport:
      manifest.viewport === null
        ? null
        : parseSessionViewport(manifest.viewport),
    codec: readCodec(manifest.codec),
    artifactSizes: parseArtifactSizes(manifest.artifactSizes),
    failure,
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
  const response = readRecord(value, 'Session list response');
  if (!Array.isArray(response.sessions)) {
    throw new ProtocolValidationError(
      'Session list response must contain sessions',
    );
  }
  return {
    schemaVersion: readSchemaVersion(response),
    sessions: response.sessions.map(parseSessionManifest),
  };
}

export function parseGetSessionRequest(value: unknown): GetSessionRequest {
  return parseSessionTarget(value, 'Get Session request');
}

export function parseGetSessionResponse(value: unknown): GetSessionResponse {
  return parseSessionResponse(value, 'Get Session response');
}

export function parsePauseSessionRequest(value: unknown): PauseSessionRequest {
  const request = readRecord(value, 'Pause Session request');
  return {
    ...parseSessionTarget(request, 'Pause Session request'),
    pausedAt: readTimestamp(request, 'pausedAt'),
    activeDurationMs: readNonNegativeInteger(request, 'activeDurationMs'),
  };
}

export function parsePauseSessionResponse(
  value: unknown,
): PauseSessionResponse {
  return parseSessionResponse(value, 'Pause Session response');
}

export function parseResumeSessionRequest(
  value: unknown,
): ResumeSessionRequest {
  const request = readRecord(value, 'Resume Session request');
  return {
    ...parseSessionTarget(request, 'Resume Session request'),
    resumedAt: readTimestamp(request, 'resumedAt'),
  };
}

export function parseResumeSessionResponse(
  value: unknown,
): ResumeSessionResponse {
  return parseSessionResponse(value, 'Resume Session response');
}

export function parseFinalizeSessionRequest(
  value: unknown,
): FinalizeSessionRequest {
  const request = readRecord(value, 'Finalize Session request');
  return {
    ...parseSessionTarget(request, 'Finalize Session request'),
    recordingEndedAt: readTimestamp(request, 'recordingEndedAt'),
    activeDurationMs: readNonNegativeInteger(request, 'activeDurationMs'),
    viewport:
      request.viewport === null ? null : parseSessionViewport(request.viewport),
    codec: readCodec(request.codec),
  };
}

export function parseFinalizeSessionResponse(
  value: unknown,
): FinalizeSessionResponse {
  return parseSessionResponse(value, 'Finalize Session response');
}

export function parseFailSessionRequest(value: unknown): FailSessionRequest {
  const request = readRecord(value, 'Fail Session request');
  return {
    ...parseSessionTarget(request, 'Fail Session request'),
    failedAt: readTimestamp(request, 'failedAt'),
    activeDurationMs: readNonNegativeInteger(request, 'activeDurationMs'),
    code: readNonEmptyString(request, 'code'),
    message: readNonEmptyString(request, 'message'),
  };
}

export function parseFailSessionResponse(value: unknown): FailSessionResponse {
  return parseSessionResponse(value, 'Fail Session response');
}

export function parseCompleteVideoRequest(
  value: unknown,
): CompleteVideoRequest {
  return parseSessionTarget(value, 'Complete video request');
}

export function parseCompleteVideoResponse(
  value: unknown,
): CompleteVideoResponse {
  return parseSessionResponse(value, 'Complete video response');
}

export function parseDeleteSessionRequest(
  value: unknown,
): DeleteSessionRequest {
  return parseSessionTarget(value, 'Delete Session request');
}

export function parseDeleteSessionResponse(
  value: unknown,
): DeleteSessionResponse {
  const response = readRecord(value, 'Delete Session response');
  if (response.deleted !== true) {
    throw new ProtocolValidationError('deleted must be true');
  }
  return {
    schemaVersion: readSchemaVersion(response),
    sessionId: readNonEmptyString(response, 'sessionId'),
    deleted: true,
  };
}
