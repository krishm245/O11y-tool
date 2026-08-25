import cors from '@fastify/cors';
import { createReadStream, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  ARTIFACT_CHUNK_SCHEMA_VERSION,
  TIMELINE_EVENT_SCHEMA_VERSION,
  HEALTH_PATH,
  ProtocolValidationError,
  SESSION_COLLECTION_PATH,
  SESSION_FINALIZE_PATH,
  SESSION_FAIL_PATH,
  SESSION_EVENTS_PATH,
  SESSION_EVENT_CHUNK_PATH,
  SESSION_ITEM_PATH,
  SESSION_PAUSE_PATH,
  SESSION_RESUME_PATH,
  SESSION_VIDEO_CHUNK_PATH,
  SESSION_VIDEO_COMPLETE_PATH,
  SESSION_VIDEO_PATH,
  SESSION_SCHEMA_VERSION,
  parseArtifactChunk,
  parseCompleteVideoRequest,
  parseCreateSessionRequest,
  parseDeleteSessionRequest,
  parseFinalizeSessionRequest,
  parseFailSessionRequest,
  parseGetSessionRequest,
  parsePauseSessionRequest,
  parseResumeSessionRequest,
  type CompleteVideoRequest,
  type CompleteVideoResponse,
  type DeleteSessionResponse,
  type FinalizeSessionRequest,
  type FinalizeSessionResponse,
  type FailSessionRequest,
  type FailSessionResponse,
  type GetSessionResponse,
  type GetEventsResponse,
  type PauseSessionRequest,
  type PauseSessionResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionListResponse,
  type HealthResponse,
  type SessionManifest,
  type UploadArtifactChunkResponse,
} from '@app-o11y/protocol';
import { WEB_DEV_ORIGINS } from './config.js';
import {
  createSessionStore,
  InvalidSessionTransitionError,
  SessionNotFoundError,
  type SessionStore,
} from './session-store.js';
import {
  ArtifactConflictError,
  ArtifactCapacityError,
  ArtifactNotFoundError,
  createArtifactStore,
  MAX_VIDEO_CHUNK_BYTES,
  type ArtifactStore,
} from './artifact-store.js';

type SessionParams = { sessionId: string };
type ChunkParams = SessionParams & { sequence: string };

function parsePathBoundRequest<T extends { sessionId: string }>(
  body: unknown,
  pathSessionId: string,
  parse: (value: unknown) => T,
): T {
  const parsed = parse(body);
  if (parsed.sessionId !== pathSessionId) {
    throw new ProtocolValidationError(
      'sessionId must match the Session ID in the route',
    );
  }
  return parsed;
}

type BuildAppOptions = {
  logger?: FastifyServerOptions['logger'];
  sessions?: SessionStore;
  artifacts?: ArtifactStore;
};

export function recoverInterruptedFinalizations(
  sessions: SessionStore,
  artifacts: ArtifactStore,
  now = () => new Date(),
) {
  for (const session of sessions.list()) {
    if (session.state !== 'processing') continue;
    const recoveredAt = now().toISOString();
    try {
      const videoBytes = artifacts.completeVideo(session.id);
      sessions.completeVideo(session.id, videoBytes, recoveredAt);
    } catch (error) {
      sessions.fail({
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: session.id,
        failedAt: recoveredAt,
        activeDurationMs: session.activeDurationMs,
        code: 'finalization_interrupted',
        message:
          error instanceof Error
            ? error.message
            : 'Video finalization was interrupted.',
      });
    }
  }
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: MAX_VIDEO_CHUNK_BYTES + 1024,
  });
  const sessions = options.sessions ?? createSessionStore();
  const temporaryArtifacts =
    options.artifacts === undefined
      ? mkdtempSync(join(tmpdir(), 'o11y-artifacts-'))
      : undefined;
  const artifacts =
    options.artifacts ?? createArtifactStore(temporaryArtifacts!);

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );
  app.addContentTypeParser(
    'application/gzip',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  app.addHook('onClose', async () => {
    sessions.close?.();
    if (temporaryArtifacts !== undefined) {
      rmSync(temporaryArtifacts, { recursive: true, force: true });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ProtocolValidationError) {
      return reply.status(400).send({
        error: 'invalid_session',
        message: error.message,
      });
    }
    if (error instanceof SessionNotFoundError) {
      return reply.status(404).send({
        error: 'session_not_found',
        message: error.message,
      });
    }
    if (error instanceof InvalidSessionTransitionError) {
      return reply.status(409).send({
        error: 'invalid_session_transition',
        message: error.message,
      });
    }
    if (error instanceof ArtifactNotFoundError) {
      return reply.status(404).send({
        error: 'artifact_not_found',
        message: error.message,
      });
    }
    if (error instanceof ArtifactConflictError) {
      return reply.status(409).send({
        error: 'artifact_conflict',
        message: error.message,
      });
    }
    if (error instanceof ArtifactCapacityError) {
      return reply.status(413).send({
        error: 'session_artifact_limit',
        message: error.message,
      });
    }
    return reply.send(error);
  });

  void app.register(cors, {
    origin: [...WEB_DEV_ORIGINS],
    methods: ['GET', 'POST', 'DELETE'],
  });

  app.get<{ Reply: HealthResponse }>(HEALTH_PATH, async () => ({
    status: 'ok',
    service: 'o11y-local-api',
    version: 1,
  }));

  app.post<{ Reply: SessionManifest }>(
    SESSION_COLLECTION_PATH,
    async (request, reply) =>
      reply
        .status(201)
        .send(sessions.create(parseCreateSessionRequest(request.body))),
  );

  app.get<{ Reply: SessionListResponse }>(
    SESSION_COLLECTION_PATH,
    async () => ({
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessions: sessions.list(),
    }),
  );

  app.get<{ Params: SessionParams; Reply: GetSessionResponse }>(
    SESSION_ITEM_PATH,
    async (request) => {
      const target = parseGetSessionRequest({
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: request.params.sessionId,
      });
      const session = sessions.get(target.sessionId);
      if (session === undefined)
        throw new SessionNotFoundError(target.sessionId);
      return { schemaVersion: SESSION_SCHEMA_VERSION, session };
    },
  );

  app.post<{
    Params: SessionParams;
    Body: PauseSessionRequest;
    Reply: PauseSessionResponse;
  }>(SESSION_PAUSE_PATH, async (request) => ({
    schemaVersion: SESSION_SCHEMA_VERSION,
    session: sessions.pause(
      parsePathBoundRequest(
        request.body,
        request.params.sessionId,
        parsePauseSessionRequest,
      ),
    ),
  }));

  app.post<{
    Params: SessionParams;
    Body: ResumeSessionRequest;
    Reply: ResumeSessionResponse;
  }>(SESSION_RESUME_PATH, async (request) => ({
    schemaVersion: SESSION_SCHEMA_VERSION,
    session: sessions.resume(
      parsePathBoundRequest(
        request.body,
        request.params.sessionId,
        parseResumeSessionRequest,
      ),
    ),
  }));

  app.post<{
    Params: SessionParams;
    Body: FinalizeSessionRequest;
    Reply: FinalizeSessionResponse;
  }>(SESSION_FINALIZE_PATH, async (request) => ({
    schemaVersion: SESSION_SCHEMA_VERSION,
    session: sessions.finalize(
      parsePathBoundRequest(
        request.body,
        request.params.sessionId,
        parseFinalizeSessionRequest,
      ),
    ),
  }));

  app.post<{
    Params: SessionParams;
    Body: FailSessionRequest;
    Reply: FailSessionResponse;
  }>(SESSION_FAIL_PATH, async (request) => ({
    schemaVersion: SESSION_SCHEMA_VERSION,
    session: sessions.fail(
      parsePathBoundRequest(
        request.body,
        request.params.sessionId,
        parseFailSessionRequest,
      ),
    ),
  }));

  app.post<{
    Params: ChunkParams;
    Body: Buffer;
    Reply: UploadArtifactChunkResponse;
  }>(SESSION_VIDEO_CHUNK_PATH, async (request, reply) => {
    const session = sessions.get(request.params.sessionId);
    if (session === undefined)
      throw new SessionNotFoundError(request.params.sessionId);
    if (session.state !== 'recording' && session.state !== 'paused') {
      throw new InvalidSessionTransitionError(
        `Cannot upload video for a Session in the ${session.state} state`,
      );
    }
    const chunk = parseArtifactChunk({
      schemaVersion: Number(request.headers['x-o11y-schema-version']),
      sessionId: request.params.sessionId,
      kind: 'video',
      sequence: Number(request.params.sequence),
      activeTimeStartMs: Number(request.headers['x-o11y-active-start-ms']),
      activeTimeEndMs: Number(request.headers['x-o11y-active-end-ms']),
      byteLength: Number(request.headers['content-length']),
      checksum: request.headers['x-o11y-checksum'],
    });
    if (!Buffer.isBuffer(request.body)) {
      throw new ProtocolValidationError('Video chunk body must be binary');
    }
    const { stored } = artifacts.uploadVideoChunk(chunk, request.body);
    return reply.status(stored ? 201 : 200).send({
      schemaVersion: ARTIFACT_CHUNK_SCHEMA_VERSION,
      chunk,
      stored,
    });
  });

  app.post<{
    Params: ChunkParams;
    Body: Buffer;
    Reply: UploadArtifactChunkResponse;
  }>(SESSION_EVENT_CHUNK_PATH, async (request, reply) => {
    const session = sessions.get(request.params.sessionId);
    if (session === undefined) {
      throw new SessionNotFoundError(request.params.sessionId);
    }
    if (session.state !== 'recording' && session.state !== 'paused') {
      throw new InvalidSessionTransitionError(
        `Cannot upload events for a Session in the ${session.state} state`,
      );
    }
    if (!Buffer.isBuffer(request.body)) {
      throw new ProtocolValidationError('Event chunk body must be gzip data');
    }
    const chunk = parseArtifactChunk({
      schemaVersion: Number(request.headers['x-o11y-schema-version']),
      sessionId: request.params.sessionId,
      kind: 'events',
      sequence: Number(request.params.sequence),
      activeTimeStartMs: Number(request.headers['x-o11y-active-start-ms']),
      activeTimeEndMs: Number(request.headers['x-o11y-active-end-ms']),
      byteLength: request.body.byteLength,
      checksum: request.headers['x-o11y-checksum'],
    });
    const { stored } = artifacts.uploadEventChunk(chunk, request.body);
    if (stored) {
      sessions.updateEventsBytes(
        session.id,
        session.artifactSizes.eventsBytes + chunk.byteLength,
      );
    }
    return reply.status(stored ? 201 : 200).send({
      schemaVersion: ARTIFACT_CHUNK_SCHEMA_VERSION,
      chunk,
      stored,
    });
  });

  app.get<{ Params: SessionParams; Reply: GetEventsResponse }>(
    SESSION_EVENTS_PATH,
    async (request) => {
      if (sessions.get(request.params.sessionId) === undefined) {
        throw new SessionNotFoundError(request.params.sessionId);
      }
      return {
        schemaVersion: TIMELINE_EVENT_SCHEMA_VERSION,
        events: artifacts.getEvents(request.params.sessionId),
      };
    },
  );

  app.post<{
    Params: SessionParams;
    Body: CompleteVideoRequest;
    Reply: CompleteVideoResponse;
  }>(SESSION_VIDEO_COMPLETE_PATH, async (request) => {
    const target = parsePathBoundRequest(
      request.body,
      request.params.sessionId,
      parseCompleteVideoRequest,
    );
    let videoBytes: number;
    try {
      videoBytes = artifacts.completeVideo(target.sessionId);
    } catch (error) {
      const session = sessions.get(target.sessionId);
      if (session?.state === 'processing') {
        sessions.fail({
          schemaVersion: SESSION_SCHEMA_VERSION,
          sessionId: target.sessionId,
          failedAt: new Date().toISOString(),
          activeDurationMs: session.activeDurationMs,
          code: 'video_assembly_failed',
          message:
            error instanceof Error
              ? error.message
              : 'The video could not be assembled.',
        });
      }
      throw error;
    }
    return {
      schemaVersion: SESSION_SCHEMA_VERSION,
      session: sessions.completeVideo(
        target.sessionId,
        videoBytes,
        new Date().toISOString(),
      ),
    };
  });

  app.get<{ Params: SessionParams }>(
    SESSION_VIDEO_PATH,
    async (request, reply) => {
      if (sessions.get(request.params.sessionId) === undefined) {
        throw new SessionNotFoundError(request.params.sessionId);
      }
      const videoPath = artifacts.getVideoPath(request.params.sessionId);
      if (videoPath === undefined) {
        throw new ArtifactNotFoundError('This Session has no completed video');
      }
      const size = statSync(videoPath).size;
      const range = request.headers.range;
      reply
        .header('accept-ranges', 'bytes')
        .header('content-type', 'video/webm');
      if (range === undefined) {
        return reply
          .header('content-length', size)
          .send(createReadStream(videoPath));
      }

      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match === null) {
        return reply
          .status(416)
          .header('content-range', `bytes */${size}`)
          .send();
      }
      const requestedStart = match[1] === '' ? undefined : Number(match[1]);
      const requestedEnd = match[2] === '' ? undefined : Number(match[2]);
      const start =
        requestedStart === undefined
          ? Math.max(0, size - (requestedEnd ?? 0))
          : requestedStart;
      const end = Math.min(
        size - 1,
        requestedStart === undefined ? size - 1 : (requestedEnd ?? size - 1),
      );
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= size
      ) {
        return reply
          .status(416)
          .header('content-range', `bytes */${size}`)
          .send();
      }
      return reply
        .status(206)
        .header('content-range', `bytes ${start}-${end}/${size}`)
        .header('content-length', end - start + 1)
        .send(createReadStream(videoPath, { start, end }));
    },
  );

  app.delete<{ Params: SessionParams; Reply: DeleteSessionResponse }>(
    SESSION_ITEM_PATH,
    async (request) => {
      const target = parseDeleteSessionRequest({
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: request.params.sessionId,
      });
      sessions.delete(target.sessionId);
      artifacts.deleteSession(target.sessionId);
      return {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: target.sessionId,
        deleted: true,
      };
    },
  );

  return app;
}
