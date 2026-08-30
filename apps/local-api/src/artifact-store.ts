import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  parseArtifactChunk,
  parseEventBatch,
  parseSessionId,
  type ArtifactChunk,
  type EventBatch,
  type TimelineEvent,
} from '@app-o11y/protocol';

export const MAX_VIDEO_CHUNK_BYTES = 64 * 1024 * 1024;
export const MAX_EVENT_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_SESSION_ARTIFACT_BYTES = 500 * 1024 * 1024;

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

export class ArtifactCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactCapacityError';
  }
}

export type ArtifactStore = {
  completeVideo(sessionId: string): number;
  deleteSession(sessionId: string): void;
  getVideoPath(sessionId: string): string | undefined;
  getEvents(sessionId: string): TimelineEvent[];
  uploadEventChunk(
    chunk: ArtifactChunk,
    bytes: Buffer,
  ): { stored: boolean; batch: EventBatch };
  uploadVideoChunk(chunk: ArtifactChunk, bytes: Buffer): { stored: boolean };
};

function sequenceName(sequence: number) {
  return sequence.toString().padStart(8, '0');
}

export function createArtifactStore(rootDirectory: string): ArtifactStore {
  const root = resolve(rootDirectory);
  mkdirSync(root, { recursive: true });

  function sessionDirectory(sessionId: string) {
    return join(root, parseSessionId(sessionId));
  }

  function chunkDirectory(sessionId: string, kind: ArtifactChunk['kind']) {
    return join(sessionDirectory(sessionId), `${kind}-chunks`);
  }

  function metadataPath(
    sessionId: string,
    kind: ArtifactChunk['kind'],
    sequence: number,
  ) {
    return join(
      chunkDirectory(sessionId, kind),
      `${sequenceName(sequence)}.json`,
    );
  }

  function bytesPath(
    sessionId: string,
    kind: ArtifactChunk['kind'],
    sequence: number,
  ) {
    const extension = kind === 'video' ? 'webm' : 'json.gz';
    return join(
      chunkDirectory(sessionId, kind),
      `${sequenceName(sequence)}.${extension}`,
    );
  }

  function readMetadata(
    sessionId: string,
    kind: ArtifactChunk['kind'],
    sequence: number,
  ) {
    const path = metadataPath(sessionId, kind, sequence);
    if (!existsSync(path)) return undefined;
    return parseArtifactChunk(
      JSON.parse(readFileSync(path, 'utf8')) as unknown,
    );
  }

  const store: ArtifactStore = {
    completeVideo(sessionId) {
      const directory = chunkDirectory(sessionId, 'video');
      if (
        !existsSync(directory) ||
        readMetadata(sessionId, 'video', 0) === undefined
      ) {
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
          const metadata = readMetadata(sessionId, 'video', sequence);
          if (metadata === undefined) break;
          const bytes = readFileSync(bytesPath(sessionId, 'video', sequence));
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
      const storedChunkCount = readdirSync(directory).filter((name) =>
        name.endsWith('.json'),
      ).length;
      if (storedChunkCount !== sequence) {
        rmSync(temporaryPath, { force: true });
        throw new ArtifactConflictError('Video chunks are not contiguous');
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

    getEvents(sessionId) {
      const events: TimelineEvent[] = [];
      let sequence = 0;
      while (true) {
        const metadata = readMetadata(sessionId, 'events', sequence);
        if (metadata === undefined) break;
        const bytes = readFileSync(bytesPath(sessionId, 'events', sequence));
        const checksum = createHash('sha256').update(bytes).digest('hex');
        if (
          bytes.byteLength !== metadata.byteLength ||
          checksum !== metadata.checksum
        ) {
          throw new ArtifactConflictError(
            `Event chunk ${sequence} failed integrity verification`,
          );
        }
        let batch: EventBatch;
        try {
          batch = parseEventBatch(
            JSON.parse(gunzipSync(bytes).toString('utf8')) as unknown,
          );
        } catch {
          throw new ArtifactConflictError(
            `Event chunk ${sequence} is not a valid gzip event batch`,
          );
        }
        if (batch.sequence !== sequence || batch.sessionId !== sessionId) {
          throw new ArtifactConflictError(
            `Event chunk ${sequence} metadata does not match its batch`,
          );
        }
        events.push(...batch.events);
        sequence += 1;
      }
      return events.sort(
        (left, right) =>
          left.activeTimeMs - right.activeTimeMs ||
          Date.parse(left.wallTime) - Date.parse(right.wallTime) ||
          left.id.localeCompare(right.id),
      );
    },

    uploadEventChunk(chunkInput, bytes) {
      const chunk = parseArtifactChunk(chunkInput);
      if (chunk.kind !== 'events') {
        throw new ArtifactConflictError('Expected an event chunk');
      }
      const batch = validateChunk(chunk, bytes, MAX_EVENT_CHUNK_BYTES);
      if (batch === undefined) {
        throw new ArtifactConflictError('Event batch validation failed');
      }
      return { ...storeChunk(chunk, bytes), batch };
    },

    uploadVideoChunk(chunkInput, bytes) {
      const chunk = parseArtifactChunk(chunkInput);
      if (chunk.kind !== 'video') {
        throw new ArtifactConflictError('Expected a video chunk');
      }
      validateChunk(chunk, bytes, MAX_VIDEO_CHUNK_BYTES);
      return storeChunk(chunk, bytes);
    },
  };

  function validateChunk(
    chunk: ArtifactChunk,
    bytes: Buffer,
    maxBytes: number,
  ): EventBatch | undefined {
    if (bytes.byteLength !== chunk.byteLength) {
      throw new ArtifactConflictError(
        'Chunk byteLength does not match the request body',
      );
    }
    if (bytes.byteLength > maxBytes) {
      throw new ArtifactConflictError(
        `${chunk.kind} chunks cannot exceed ${maxBytes} bytes`,
      );
    }
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (checksum !== chunk.checksum) {
      throw new ArtifactConflictError(
        'Chunk checksum does not match the request body',
      );
    }
    if (chunk.kind === 'events') {
      let batch: EventBatch;
      try {
        batch = parseEventBatch(
          JSON.parse(gunzipSync(bytes).toString('utf8')) as unknown,
        );
      } catch {
        throw new ArtifactConflictError(
          'Event chunk must be a valid gzip batch',
        );
      }
      if (
        batch.sessionId !== chunk.sessionId ||
        batch.sequence !== chunk.sequence
      ) {
        throw new ArtifactConflictError(
          'Event chunk metadata does not match its batch',
        );
      }
      const first = batch.events[0]!;
      const last = batch.events[batch.events.length - 1]!;
      if (
        first.activeTimeMs !== chunk.activeTimeStartMs ||
        last.activeTimeMs !== chunk.activeTimeEndMs
      ) {
        throw new ArtifactConflictError(
          'Event chunk active-time range does not match its batch',
        );
      }
      return batch;
    }
    return undefined;
  }

  function storeChunk(chunk: ArtifactChunk, bytes: Buffer) {
    const existing = readMetadata(chunk.sessionId, chunk.kind, chunk.sequence);
    if (existing !== undefined) {
      if (
        existing.checksum === chunk.checksum &&
        existing.byteLength === chunk.byteLength &&
        JSON.stringify(existing) === JSON.stringify(chunk)
      ) {
        return { stored: false };
      }
      throw new ArtifactConflictError(
        `${chunk.kind} chunk ${chunk.sequence} conflicts with stored data`,
      );
    }

    const sessionBytes = (['video', 'events'] as const).reduce(
      (total, kind) => {
        const directory = chunkDirectory(chunk.sessionId, kind);
        if (!existsSync(directory)) return total;
        return (
          total +
          readdirSync(directory)
            .filter((name) => name.endsWith('.json'))
            .reduce((kindTotal, name) => {
              const metadata = parseArtifactChunk(
                JSON.parse(readFileSync(join(directory, name), 'utf8')) as unknown,
              );
              return kindTotal + metadata.byteLength;
            }, 0)
        );
      },
      0,
    );
    if (sessionBytes + bytes.byteLength > MAX_SESSION_ARTIFACT_BYTES) {
      throw new ArtifactCapacityError('Session artifacts cannot exceed 500 MB');
    }

    if (chunk.sequence > 0) {
      const previous = readMetadata(
        chunk.sessionId,
        chunk.kind,
        chunk.sequence - 1,
      );
      if (
        previous !== undefined &&
        chunk.activeTimeStartMs < previous.activeTimeEndMs
      ) {
        throw new ArtifactConflictError(
          `${chunk.kind} chunk active-time ranges are out of order`,
        );
      }
    } else if (chunk.kind === 'video' && chunk.activeTimeStartMs !== 0) {
      throw new ArtifactConflictError(
        `The first ${chunk.kind} chunk must start at active time zero`,
      );
    }
    const next = readMetadata(
      chunk.sessionId,
      chunk.kind,
      chunk.sequence + 1,
    );
    if (next !== undefined && chunk.activeTimeEndMs > next.activeTimeStartMs) {
      throw new ArtifactConflictError(
        `${chunk.kind} chunk active-time ranges are out of order`,
      );
    }

    const directory = chunkDirectory(chunk.sessionId, chunk.kind);
    mkdirSync(directory, { recursive: true });
    const chunkPath = bytesPath(chunk.sessionId, chunk.kind, chunk.sequence);
    const temporaryPath = `${chunkPath}.tmp`;
    writeFileSync(temporaryPath, bytes);
    renameSync(temporaryPath, chunkPath);
    writeFileSync(
      metadataPath(chunk.sessionId, chunk.kind, chunk.sequence),
      JSON.stringify(chunk),
    );
    return { stored: true };
  }

  return store;
}
