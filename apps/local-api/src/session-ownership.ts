import { randomUUID } from 'node:crypto';
import {
  type CreateSessionRequest,
  type SessionManifest,
} from '@app-o11y/protocol';

export type SessionOwnership = {
  create(request: CreateSessionRequest): SessionManifest;
  list(): SessionManifest[];
};

type SessionOwnershipDependencies = {
  createId?: () => string;
  now?: () => Date;
};

export function createSessionOwnership(
  dependencies: SessionOwnershipDependencies = {},
): SessionOwnership {
  const sessions = new Map<string, SessionManifest>();
  const createId = dependencies.createId ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());

  return {
    create(request) {
      const session: SessionManifest = {
        ...request,
        id: createId(),
        state: 'recording',
        createdAt: now().toISOString(),
      };

      sessions.set(session.id, session);
      return session;
    },

    list() {
      return [...sessions.values()].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      );
    },
  };
}
