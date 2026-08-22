import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  PRIVACY_POLICY_VERSION,
  parseSessionManifest,
  type CreateSessionRequest,
  type SessionManifest,
} from '@app-o11y/protocol';

export type SessionStore = {
  close?(): void;
  create(request: CreateSessionRequest): SessionManifest;
  list(): SessionManifest[];
};

type SessionStoreDependencies = {
  createId?: () => string;
  now?: () => Date;
};

type SessionRow = {
  manifest_json: string;
};

const CREATE_SESSIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    manifest_json TEXT NOT NULL
  ) STRICT
`;

export function createSessionStore(
  databasePathOrDependencies: string | SessionStoreDependencies = ':memory:',
  dependencies: SessionStoreDependencies = {},
): SessionStore {
  const databasePath =
    typeof databasePathOrDependencies === 'string'
      ? databasePathOrDependencies
      : ':memory:';
  const resolvedDependencies =
    typeof databasePathOrDependencies === 'string'
      ? dependencies
      : databasePathOrDependencies;

  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA busy_timeout = 5000');
  if (databasePath !== ':memory:') {
    database.exec('PRAGMA journal_mode = WAL');
  }
  database.exec(CREATE_SESSIONS_TABLE);

  const insertSession = database.prepare(`
    INSERT INTO sessions (id, created_at, manifest_json)
    VALUES (?, ?, ?)
  `);
  const listSessions = database.prepare(`
    SELECT manifest_json
    FROM sessions
    ORDER BY created_at DESC, id DESC
  `);
  const createId = resolvedDependencies.createId ?? randomUUID;
  const now = resolvedDependencies.now ?? (() => new Date());

  return {
    close() {
      database.close();
    },

    create(request) {
      const createdAt = now().toISOString();
      const session: SessionManifest = {
        schemaVersion: request.schemaVersion,
        privacyVersion: PRIVACY_POLICY_VERSION,
        id: createId(),
        origin: request.origin,
        title: request.title,
        state: 'recording',
        timestamps: {
          createdAt,
          recordingStartedAt: createdAt,
          recordingEndedAt: null,
          processingStartedAt: null,
          processingEndedAt: null,
        },
        activeDurationMs: 0,
        viewport: request.viewport ?? null,
        codec: null,
        artifactSizes: { videoBytes: 0, eventsBytes: 0, totalBytes: 0 },
        failure: null,
      };

      insertSession.run(session.id, createdAt, JSON.stringify(session));
      return session;
    },

    list() {
      return (listSessions.all() as SessionRow[]).map(({ manifest_json }) =>
        parseSessionManifest(JSON.parse(manifest_json) as unknown),
      );
    },
  };
}
