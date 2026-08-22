import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const WEB_DEV_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
] as const;

export const LOCAL_DATA_DIRECTORY = resolve(
  process.env.O11Y_DATA_DIR ?? join(homedir(), '.o11y-replay'),
);

export const SESSION_DATABASE_PATH = join(
  LOCAL_DATA_DIRECTORY,
  'sessions.sqlite',
);
