import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const WEB_DEV_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
] as const;

type LocalDataEnvironment = Partial<
  Record<
    'O11Y_DATA_DIR' | 'O11Y_DATABASE_DIR' | 'O11Y_ARTIFACTS_DIR',
    string
  >
>;

export function resolveLocalDataPaths(
  environment: LocalDataEnvironment = process.env,
  homeDirectory = homedir(),
) {
  const dataDirectory = resolve(
    environment.O11Y_DATA_DIR ?? join(homeDirectory, '.o11y-replay'),
  );
  const databaseDirectory = resolve(
    environment.O11Y_DATABASE_DIR ?? dataDirectory,
  );
  const artifactsDirectory = resolve(
    environment.O11Y_ARTIFACTS_DIR ?? join(dataDirectory, 'artifacts'),
  );

  return {
    dataDirectory,
    databaseDirectory,
    databasePath: join(databaseDirectory, 'sessions.sqlite'),
    artifactsDirectory,
  };
}

export function ensureLocalDataDirectories(
  paths: ReturnType<typeof resolveLocalDataPaths>,
) {
  mkdirSync(paths.databaseDirectory, { recursive: true });
  mkdirSync(paths.artifactsDirectory, { recursive: true });
}

export const LOCAL_DATA_PATHS = resolveLocalDataPaths();
