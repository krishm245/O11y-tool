import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ensureLocalDataDirectories,
  resolveLocalDataPaths,
} from './config.js';

describe('local data paths', () => {
  it('keeps the database and artifacts under the default data directory', () => {
    const paths = resolveLocalDataPaths({}, '/test-home');

    expect(paths).toEqual({
      dataDirectory: '/test-home/.o11y-replay',
      databaseDirectory: '/test-home/.o11y-replay',
      databasePath: '/test-home/.o11y-replay/sessions.sqlite',
      artifactsDirectory: '/test-home/.o11y-replay/artifacts',
    });
  });

  it('supports independent database and artifact directories', () => {
    const paths = resolveLocalDataPaths({
      O11Y_DATA_DIR: '/data',
      O11Y_DATABASE_DIR: '/metadata',
      O11Y_ARTIFACTS_DIR: '/recordings',
    });

    expect(paths.databasePath).toBe('/metadata/sessions.sqlite');
    expect(paths.artifactsDirectory).toBe('/recordings');
  });

  it('creates configured storage directories', () => {
    const directory = mkdtempSync(join(tmpdir(), 'o11y-config-'));
    const paths = resolveLocalDataPaths({
      O11Y_DATABASE_DIR: join(directory, 'database'),
      O11Y_ARTIFACTS_DIR: join(directory, 'artifacts'),
    });

    try {
      ensureLocalDataDirectories(paths);
      expect(existsSync(paths.databaseDirectory)).toBe(true);
      expect(existsSync(paths.artifactsDirectory)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
