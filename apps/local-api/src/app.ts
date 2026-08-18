import cors from '@fastify/cors';
import Fastify from 'fastify';
import {
  HEALTH_PATH,
  WEB_DEV_ORIGINS,
  type HealthResponse,
} from '@app-o11y/protocol';

type BuildAppOptions = {
  logger?: boolean;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });

  void app.register(cors, {
    origin: [...WEB_DEV_ORIGINS],
    methods: ['GET'],
  });

  app.get<{ Reply: HealthResponse }>(HEALTH_PATH, async () => ({
    status: 'ok',
    service: 'o11y-local-api',
    version: 1,
  }));

  return app;
}
