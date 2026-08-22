import cors from '@fastify/cors';
import Fastify from 'fastify';
import {
  HEALTH_PATH,
  ProtocolValidationError,
  SESSION_COLLECTION_PATH,
  SESSION_FINALIZE_PATH,
  SESSION_ITEM_PATH,
  SESSION_PAUSE_PATH,
  SESSION_RESUME_PATH,
  SESSION_SCHEMA_VERSION,
  parseCreateSessionRequest,
  parseDeleteSessionRequest,
  parseFinalizeSessionRequest,
  parseGetSessionRequest,
  parsePauseSessionRequest,
  parseResumeSessionRequest,
  type DeleteSessionResponse,
  type FinalizeSessionRequest,
  type FinalizeSessionResponse,
  type GetSessionResponse,
  type PauseSessionRequest,
  type PauseSessionResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionListResponse,
  type HealthResponse,
  type SessionManifest,
} from '@app-o11y/protocol';
import { WEB_DEV_ORIGINS } from './config.js';
import {
  createSessionStore,
  InvalidSessionTransitionError,
  SessionNotFoundError,
  type SessionStore,
} from './session-store.js';

type SessionParams = { sessionId: string };

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
  logger?: boolean;
  sessions?: SessionStore;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const sessions = options.sessions ?? createSessionStore();

  app.addHook('onClose', async () => {
    sessions.close?.();
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
      if (session === undefined) throw new SessionNotFoundError(target.sessionId);
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

  app.delete<{ Params: SessionParams; Reply: DeleteSessionResponse }>(
    SESSION_ITEM_PATH,
    async (request) => {
      const target = parseDeleteSessionRequest({
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: request.params.sessionId,
      });
      sessions.delete(target.sessionId);
      return {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: target.sessionId,
        deleted: true,
      };
    },
  );

  return app;
}
