import {
  LOCAL_API_HOST,
  LOCAL_API_ORIGIN,
  LOCAL_API_PORT,
} from '@app-o11y/protocol';
import { buildApp } from './app.js';
import { ensureLocalDataDirectories, LOCAL_DATA_PATHS } from './config.js';
import { createSessionStore } from './session-store.js';
import { createArtifactStore } from './artifact-store.js';

ensureLocalDataDirectories(LOCAL_DATA_PATHS);

const app = buildApp({
  logger: true,
  sessions: createSessionStore(LOCAL_DATA_PATHS.databasePath),
  artifacts: createArtifactStore(LOCAL_DATA_PATHS.artifactsDirectory),
});

async function stop(signal: NodeJS.Signals) {
  app.log.info({ signal }, 'Stopping local API');
  await app.close();
  process.exit(0);
}

process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));

try {
  await app.listen({ host: LOCAL_API_HOST, port: LOCAL_API_PORT });
  app.log.info(`Local API ready at ${LOCAL_API_ORIGIN}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
