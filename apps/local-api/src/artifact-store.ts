import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArtifactChunk, type ArtifactChunk } from '@app-o11y/protocol';

export const MAX_VIDEO_CHUNK_BYTES = 64 * 1024 * 1024;

export class ArtifactConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactConflictError';
  }
}

export class ArtifactNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactNotFoundError';
  }
}

export type ArtifactStore = {
  completeVideo(sessionId: string): number;
  deleteSession(sessionId: string): void;
  getVideoPath(sessionId: string): string | undefined;
  uploadVideoChunk(chunk: ArtifactChunk, bytes: Buffer): { stored: boolean };
};

function sequenceName(sequence: number) {
  return sequence.toString().padStart(8, '0');
}

export function createArtifactStore(rootDirectory: string): ArtifactStore {
  const root = resolve(rootDirectory);
  mkdirSync(root, { recursive: true });

  function sessionDirectory(sessionId: string) {
    parseArtifactChunk({
      schemaVersion: 1,
      sessionId,
      kind: 'video',
      sequence: 0,
      activeTimeStartMs: 0,
      activeTimeEndMs: 0,
      byteLength: 1,
      checksum: '0'.repeat(64),
    });
    return join(root, sessionId);
  }

  function chunkDirectory(sessionId: string) {
    return join(sessionDirectory(sessionId), 'video-chunks');
  }

  function metadataPath(sessionId: string, sequence: number) {
    return join(chunkDirectory(sessionId), `${sequenceName(sequence)}.json`);
  }

  function bytesPath(sessionId: string, sequence: number) {
    return join(chunkDirectory(sessionId), `${sequenceName(sequence)}.webm`);
  }

  function readMetadata(sessionId: string, sequence: number) {
    const path = metadataPath(sessionId, sequence);
    if (!existsSync(path)) return undefined;
    return parseArtifactChunk(
      JSON.parse(readFileSync(path, 'utf8')) as unknown,
    );
  }

  return {
    completeVideo(sessionId) {
      const directory = chunkDirectory(sessionId);
      if (!existsSync(directory) || readMetadata(sessionId, 0) === undefined) {
        throw new ArtifactNotFoundError('No video chunks were uploaded');
      }

      const targetDirectory = sessionDirectory(sessionId);
      mkdirSync(targetDirectory, { recursive: true });
      const temporaryPath = join(targetDirectory, 'video.webm.tmp');
      const finalPath = join(targetDirectory, 'video.webm');
      const descriptor = openSync(temporaryPath, 'w');
      let offset = 0;
      let sequence = 0;
      try {
        while (true) {
          const metadata = readMetadata(sessionId, sequence);
          if (metadata === undefined) break;
          const bytes = readFileSync(bytesPath(sessionId, sequence));
          if (bytes.byteLength !== metadata.byteLength) {
            throw new ArtifactConflictError(
              `Video chunk ${sequence} has changed size`,
            );
          }
          const checksum = createHash('sha256').update(bytes).digest('hex');
          if (checksum !== metadata.checksum) {
            throw new ArtifactConflictError(
              `Video chunk ${sequence} failed checksum verification`,
            );
          }
          writeSync(descriptor, bytes, 0, bytes.byteLength, offset);
          offset += bytes.byteLength;
          sequence += 1;
        }
      } finally {
        closeSync(descriptor);
      }
      renameSync(temporaryPath, finalPath);
      return offset;
    },

    deleteSession(sessionId) {
      rmSync(sessionDirectory(sessionId), { recursive: true, force: true });
    },

    getVideoPath(sessionId) {
      const path = join(sessionDirectory(sessionId), 'video.webm');
      return existsSync(path) && statSync(path).isFile() ? path : undefined;
    },

    uploadVideoChunk(chunkInput, bytes) {
      const chunk = parseArtifactChunk(chunkInput);
      if (bytes.byteLength !== chunk.byteLength) {
        throw new ArtifactConflictError(
          'Chunk byteLength does not match the request body',
        );
      }
      if (bytes.byteLength > MAX_VIDEO_CHUNK_BYTES) {
        throw new ArtifactConflictError(
          `Video chunks cannot exceed ${MAX_VIDEO_CHUNK_BYTES} bytes`,
        );
      }
      const checksum = createHash('sha256').update(bytes).digest('hex');
      if (checksum !== chunk.checksum) {
        throw new ArtifactConflictError(
          'Chunk checksum does not match the request body',
        );
      }

      const existing = readMetadata(chunk.sessionId, chunk.sequence);
      if (existing !== undefined) {
        if (
          existing.checksum === chunk.checksum &&
          existing.byteLength === chunk.byteLength &&
          JSON.stringify(existing) === JSON.stringify(chunk)
        ) {
          return { stored: false };
        }
        throw new ArtifactConflictError(
          `Video chunk ${chunk.sequence} conflicts with stored data`,
        );
      }

      if (chunk.sequence > 0) {
        const previous = readMetadata(chunk.sessionId, chunk.sequence - 1);
        if (previous === undefined) {
          throw new ArtifactConflictError(
            'Video chunks must be uploaded in sequence',
          );
        }
        if (chunk.activeTimeStartMs < previous.activeTimeStartMs) {
          throw new ArtifactConflictError(
            'Video chunk active-time ranges are out of order',
          );
        }
      } else if (chunk.activeTimeStartMs !== 0) {
        throw new ArtifactConflictError(
          'The first video chunk must start at active time zero',
        );
      }

      const directory = chunkDirectory(chunk.sessionId);
      mkdirSync(directory, { recursive: true });
      const chunkPath = bytesPath(chunk.sessionId, chunk.sequence);
      const temporaryPath = `${chunkPath}.tmp`;
      writeFileSync(temporaryPath, bytes);
      renameSync(temporaryPath, chunkPath);
      writeFileSync(
        metadataPath(chunk.sessionId, chunk.sequence),
        JSON.stringify(chunk),
      );
      return { stored: true };
    },
  };
}
