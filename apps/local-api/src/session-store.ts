import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  PRIVACY_POLICY_VERSION,
  parseSessionManifest,
  type CreateSessionRequest,
  type FailSessionRequest,
  type FinalizeSessionRequest,
  type PauseSessionRequest,
  type ResumeSessionRequest,
  type SessionManifest,
} from '@app-o11y/protocol';

export type SessionStore = {
  close?(): void;
  create(request: CreateSessionRequest): SessionManifest;
  delete(sessionId: string): void;
  completeVideo(
    sessionId: string,
    videoBytes: number,
    completedAt: string,
  ): SessionManifest;
  fail(request: FailSessionRequest): SessionManifest;
  finalize(request: FinalizeSessionRequest): SessionManifest;
  get(sessionId: string): SessionManifest | undefined;
  list(): SessionManifest[];
  pause(request: PauseSessionRequest): SessionManifest;
  resume(request: ResumeSessionRequest): SessionManifest;
};

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} was not found`);
    this.name = 'SessionNotFoundError';
  }
}

export class InvalidSessionTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSessionTransitionError';
  }
}

type SessionStoreDependencies = {
  createId?: () => string;
  now?: () => Date;
};

type SessionRow = {
  manifest_json: string;
};

type StoredSessionRow = SessionRow & {
  last_operation: string;
  last_transition_at: string;
};

const CREATE_SESSIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    last_transition_at TEXT NOT NULL,
    last_operation TEXT NOT NULL
  ) STRICT
`;

function assertNotBefore(
  timestamp: string,
  earliestTimestamp: string,
  fieldName: string,
) {
  if (Date.parse(timestamp) < Date.parse(earliestTimestamp)) {
    throw new InvalidSessionTransitionError(
      `${fieldName} cannot be before the previous lifecycle transition`,
    );
  }
}

function assertActiveDuration(
  activeDurationMs: number,
  session: SessionManifest,
  transitionAt: string,
) {
  if (activeDurationMs < session.activeDurationMs) {
    throw new InvalidSessionTransitionError('activeDurationMs cannot decrease');
  }

  const recordingStartedAt = session.timestamps.recordingStartedAt;
  if (
    recordingStartedAt !== null &&
    activeDurationMs > Date.parse(transitionAt) - Date.parse(recordingStartedAt)
  ) {
    throw new InvalidSessionTransitionError(
      'activeDurationMs cannot exceed the recording wall-clock duration',
    );
  }
}

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

  const columns = database
    .prepare('PRAGMA table_info(sessions)')
    .all() as Array<{
    name: string;
  }>;
  if (!columns.some(({ name }) => name === 'last_transition_at')) {
    database.exec('ALTER TABLE sessions ADD COLUMN last_transition_at TEXT');
    database.exec(`
      UPDATE sessions
      SET last_transition_at = created_at
      WHERE last_transition_at IS NULL
    `);
  }
  if (!columns.some(({ name }) => name === 'last_operation')) {
    database.exec(
      "ALTER TABLE sessions ADD COLUMN last_operation TEXT NOT NULL DEFAULT 'create'",
    );
  }

  const insertSession = database.prepare(`
    INSERT INTO sessions (
      id,
      created_at,
      manifest_json,
      last_transition_at,
      last_operation
    )
    VALUES (?, ?, ?, ?, 'create')
  `);
  const getSession = database.prepare(`
    SELECT manifest_json, last_transition_at, last_operation
    FROM sessions
    WHERE id = ?
  `);
  const listSessions = database.prepare(`
    SELECT manifest_json
    FROM sessions
    ORDER BY created_at DESC, id DESC
  `);
  const updateSession = database.prepare(`
    UPDATE sessions
    SET manifest_json = ?, last_transition_at = ?, last_operation = ?
    WHERE id = ?
  `);
  const deleteSession = database.prepare('DELETE FROM sessions WHERE id = ?');
  const createId = resolvedDependencies.createId ?? randomUUID;
  const now = resolvedDependencies.now ?? (() => new Date());

  function readStored(sessionId: string):
    | {
        session: SessionManifest;
        lastTransitionAt: string;
        lastOperation: string;
      }
    | undefined {
    const row = getSession.get(sessionId) as StoredSessionRow | undefined;
    if (row === undefined) return undefined;
    return {
      session: parseSessionManifest(JSON.parse(row.manifest_json) as unknown),
      lastTransitionAt: row.last_transition_at,
      lastOperation: row.last_operation,
    };
  }

  function requireStored(sessionId: string) {
    const stored = readStored(sessionId);
    if (stored === undefined) throw new SessionNotFoundError(sessionId);
    return stored;
  }

  function persist(
    session: SessionManifest,
    transitionedAt: string,
    operation: 'pause' | 'resume' | 'finalize' | 'complete-video' | 'fail',
  ) {
    const validated = parseSessionManifest(session);
    updateSession.run(
      JSON.stringify(validated),
      transitionedAt,
      operation,
      session.id,
    );
    return validated;
  }

  return {
    close() {
      database.close();
    },

    completeVideo(sessionId, videoBytes, completedAt) {
      const { session, lastTransitionAt, lastOperation } =
        requireStored(sessionId);
      if (session.state === 'ready' && lastOperation === 'complete-video') {
        return session;
      }
      if (session.state !== 'processing') {
        throw new InvalidSessionTransitionError(
          `Cannot complete video for a Session in the ${session.state} state`,
        );
      }
      assertNotBefore(completedAt, lastTransitionAt, 'completedAt');
      return persist(
        {
          ...session,
          state: 'ready',
          timestamps: { ...session.timestamps, processingEndedAt: completedAt },
          artifactSizes: {
            videoBytes,
            eventsBytes: session.artifactSizes.eventsBytes,
            totalBytes: videoBytes + session.artifactSizes.eventsBytes,
          },
        },
        completedAt,
        'complete-video',
      );
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

      insertSession.run(
        session.id,
        createdAt,
        JSON.stringify(session),
        createdAt,
      );
      return session;
    },

    delete(sessionId) {
      deleteSession.run(sessionId);
    },

    fail(request) {
      const { session, lastTransitionAt, lastOperation } = requireStored(
        request.sessionId,
      );
      if (session.state === 'failed' && lastOperation === 'fail')
        return session;
      if (!['recording', 'paused', 'processing'].includes(session.state)) {
        throw new InvalidSessionTransitionError(
          `Cannot fail a Session in the ${session.state} state`,
        );
      }
      assertNotBefore(request.failedAt, lastTransitionAt, 'failedAt');
      assertActiveDuration(request.activeDurationMs, session, request.failedAt);
      return persist(
        {
          ...session,
          state: 'failed',
          activeDurationMs: request.activeDurationMs,
          timestamps: {
            ...session.timestamps,
            recordingEndedAt:
              session.timestamps.recordingEndedAt ?? request.failedAt,
            processingStartedAt:
              session.timestamps.processingStartedAt ?? request.failedAt,
            processingEndedAt: request.failedAt,
          },
          failure: {
            code: request.code,
            message: request.message,
            occurredAt: request.failedAt,
          },
        },
        request.failedAt,
        'fail',
      );
    },

    finalize(request) {
      const { session, lastTransitionAt, lastOperation } = requireStored(
        request.sessionId,
      );
      if (
        (session.state === 'ready' || session.state === 'processing') &&
        lastOperation === 'finalize'
      ) {
        return session;
      }
      if (session.state !== 'recording' && session.state !== 'paused') {
        throw new InvalidSessionTransitionError(
          `Cannot finalize a Session in the ${session.state} state`,
        );
      }

      assertNotBefore(
        request.recordingEndedAt,
        lastTransitionAt,
        'recordingEndedAt',
      );
      assertActiveDuration(
        request.activeDurationMs,
        session,
        request.recordingEndedAt,
      );
      if (
        session.state === 'paused' &&
        request.activeDurationMs !== session.activeDurationMs
      ) {
        throw new InvalidSessionTransitionError(
          'activeDurationMs cannot increase while a Session is paused',
        );
      }

      const hasVideo = request.codec !== null;
      return persist(
        {
          ...session,
          state: hasVideo ? 'processing' : 'ready',
          timestamps: {
            ...session.timestamps,
            recordingEndedAt: request.recordingEndedAt,
            processingStartedAt: request.recordingEndedAt,
            processingEndedAt: hasVideo ? null : request.recordingEndedAt,
          },
          activeDurationMs: request.activeDurationMs,
          viewport: request.viewport,
          codec: request.codec,
        },
        request.recordingEndedAt,
        'finalize',
      );
    },

    get(sessionId) {
      return readStored(sessionId)?.session;
    },

    list() {
      return (listSessions.all() as SessionRow[]).map(({ manifest_json }) =>
        parseSessionManifest(JSON.parse(manifest_json) as unknown),
      );
    },

    pause(request) {
      const { session, lastTransitionAt, lastOperation } = requireStored(
        request.sessionId,
      );
      if (session.state === 'paused' && lastOperation === 'pause')
        return session;
      if (session.state !== 'recording') {
        throw new InvalidSessionTransitionError(
          `Cannot pause a Session in the ${session.state} state`,
        );
      }

      assertNotBefore(request.pausedAt, lastTransitionAt, 'pausedAt');
      assertActiveDuration(request.activeDurationMs, session, request.pausedAt);
      return persist(
        {
          ...session,
          state: 'paused',
          activeDurationMs: request.activeDurationMs,
        },
        request.pausedAt,
        'pause',
      );
    },

    resume(request) {
      const { session, lastTransitionAt, lastOperation } = requireStored(
        request.sessionId,
      );
      if (session.state === 'recording' && lastOperation === 'resume') {
        return session;
      }
      if (session.state !== 'paused') {
        throw new InvalidSessionTransitionError(
          `Cannot resume a Session in the ${session.state} state`,
        );
      }

      assertNotBefore(request.resumedAt, lastTransitionAt, 'resumedAt');
      return persist(
        { ...session, state: 'recording' },
        request.resumedAt,
        'resume',
      );
    },
  };
}
