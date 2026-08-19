import { randomUUID } from 'node:crypto';
import {
  PRIVACY_POLICY_VERSION,
  type CreateSessionRequest,
  type SessionManifest,
} from '@app-o11y/protocol';

export type SessionStore = {
  create(request: CreateSessionRequest): SessionManifest;
  list(): SessionManifest[];
};

type SessionStoreDependencies = {
  createId?: () => string;
  now?: () => Date;
};

export function createSessionStore(
  dependencies: SessionStoreDependencies = {},
): SessionStore {
  const sessions = new Map<string, SessionManifest>();
  const createId = dependencies.createId ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());

  return {
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

      sessions.set(session.id, session);
      return session;
    },

    list() {
      return [...sessions.values()].sort((left, right) =>
        right.timestamps.createdAt.localeCompare(left.timestamps.createdAt),
      );
    },
  };
}
