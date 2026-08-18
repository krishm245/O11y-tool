import cors from '@fastify/cors';
import Fastify from 'fastify';
import {
  HEALTH_PATH,
  ProtocolValidationError,
  SESSION_COLLECTION_PATH,
  SESSION_SCHEMA_VERSION,
  parseCreateSessionRequest,
  type SessionListResponse,
  type HealthResponse,
  type SessionManifest,
} from '@app-o11y/protocol';
import { WEB_DEV_ORIGINS } from './config.js';
import {
  createSessionOwnership,
  type SessionOwnership,
} from './session-ownership.js';

type BuildAppOptions = {
  logger?: boolean;
  sessions?: SessionOwnership;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const sessions = options.sessions ?? createSessionOwnership();

  void app.register(cors, {
    origin: [...WEB_DEV_ORIGINS],
    methods: ['GET', 'POST'],
  });

  app.get<{ Reply: HealthResponse }>(HEALTH_PATH, async () => ({
    status: 'ok',
    service: 'o11y-local-api',
    version: 1,
  }));

  app.post<{ Reply: SessionManifest }>(
    SESSION_COLLECTION_PATH,
    async (request, reply) => {
      try {
        const session = sessions.create(parseCreateSessionRequest(request.body));
        return reply.status(201).send(session);
      } catch (error) {
        if (error instanceof ProtocolValidationError) {
          return reply.status(400).send({
            error: 'invalid_session',
            message: error.message,
          } as never);
        }

        throw error;
      }
    },
  );

  app.get<{ Reply: SessionListResponse }>(
    SESSION_COLLECTION_PATH,
    async () => ({
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessions: sessions.list(),
    }),
  );

  return app;
}
