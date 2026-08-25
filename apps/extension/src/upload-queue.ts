import { LOCAL_API_ORIGIN, type ArtifactKind } from "@app-o11y/protocol";

export const MAX_PENDING_UPLOAD_BYTES = 256 * 1024 * 1024;
export const MAX_SESSION_UPLOAD_BYTES = 500 * 1024 * 1024;
const DATABASE_NAME = "o11y-upload-queue";
const DATABASE_VERSION = 1;
const UPLOAD_STORE = "uploads";
const SESSION_STORE = "sessions";
const MAX_RETRY_DELAY_MS = 30_000;

type PendingUpload = {
  key: string;
  sessionId: string;
  kind: ArtifactKind;
  sequence: number;
  checksum: string;
  path: string;
  headers: Record<string, string>;
  body: ArrayBuffer;
  byteLength: number;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
};

type SessionUploadUsage = {
  sessionId: string;
  pendingBytes: number;
  totalBytes: number;
};

export class UploadQueueCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadQueueCapacityError";
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore(UPLOAD_STORE, { keyPath: "key" });
      database.createObjectStore(SESSION_STORE, { keyPath: "sessionId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function uploadKey(
  sessionId: string,
  kind: ArtifactKind,
  sequence: number,
  checksum: string,
) {
  return `${sessionId}:${kind}:${sequence}:${checksum}`;
}

export async function enqueueUpload(input: {
  sessionId: string;
  kind: ArtifactKind;
  sequence: number;
  checksum: string;
  path: string;
  headers: Record<string, string>;
  body: ArrayBuffer;
}): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(
    [UPLOAD_STORE, SESSION_STORE],
    "readwrite",
  );
  const uploads = transaction.objectStore(UPLOAD_STORE);
  const sessions = transaction.objectStore(SESSION_STORE);
  const key = uploadKey(
    input.sessionId,
    input.kind,
    input.sequence,
    input.checksum,
  );
  const existing = await requestResult(
    uploads.get(key) as IDBRequest<PendingUpload | undefined>,
  );
  if (existing !== undefined) {
    transaction.abort();
    database.close();
    return;
  }
  const usage =
    (await requestResult(
      sessions.get(input.sessionId) as IDBRequest<
        SessionUploadUsage | undefined
      >,
    )) ?? {
      sessionId: input.sessionId,
      pendingBytes: 0,
      totalBytes: 0,
    };
  if (usage.pendingBytes + input.body.byteLength > MAX_PENDING_UPLOAD_BYTES) {
    transaction.abort();
    database.close();
    throw new UploadQueueCapacityError("The pending upload queue exceeds 256 MB");
  }
  if (usage.totalBytes + input.body.byteLength > MAX_SESSION_UPLOAD_BYTES) {
    transaction.abort();
    database.close();
    throw new UploadQueueCapacityError("The Session exceeds the 500 MB limit");
  }
  uploads.put({
    ...input,
    key,
    byteLength: input.body.byteLength,
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
  } satisfies PendingUpload);
  sessions.put({
    ...usage,
    pendingBytes: usage.pendingBytes + input.body.byteLength,
    totalBytes: usage.totalBytes + input.body.byteLength,
  } satisfies SessionUploadUsage);
  await transactionDone(transaction);
  database.close();
}

let drainInFlight: Promise<void> | null = null;

export function drainUploads(): Promise<void> {
  drainInFlight ??= drainOnce().finally(() => {
    drainInFlight = null;
  });
  return drainInFlight;
}

export async function flushUploads(sessionId: string): Promise<void> {
  await drainUploads();
  const database = await openDatabase();
  const transaction = database.transaction(UPLOAD_STORE, "readonly");
  const pending = await requestResult(
    transaction.objectStore(UPLOAD_STORE).getAll() as IDBRequest<PendingUpload[]>,
  );
  await transactionDone(transaction);
  database.close();
  if (pending.some((upload) => upload.sessionId === sessionId)) {
    throw new Error("Session uploads are still pending");
  }
}

async function drainOnce() {
  const database = await openDatabase();
  const transaction = database.transaction(UPLOAD_STORE, "readonly");
  const pending = await requestResult(
    transaction.objectStore(UPLOAD_STORE).getAll() as IDBRequest<PendingUpload[]>,
  );
  await transactionDone(transaction);
  database.close();
  pending.sort(
    (left, right) =>
      left.createdAt - right.createdAt ||
      left.kind.localeCompare(right.kind) ||
      left.sequence - right.sequence,
  );
  for (const upload of pending) {
    if (upload.nextAttemptAt > Date.now()) continue;
    try {
      const response = await fetch(`${LOCAL_API_ORIGIN}${upload.path}`, {
        method: "POST",
        headers: upload.headers,
        body: upload.body,
      });
      if (!response.ok) throw new Error(`Upload failed with ${response.status}`);
      await acknowledge(upload);
    } catch {
      await defer(upload);
    }
  }
}

async function acknowledge(upload: PendingUpload) {
  const database = await openDatabase();
  const transaction = database.transaction(
    [UPLOAD_STORE, SESSION_STORE],
    "readwrite",
  );
  transaction.objectStore(UPLOAD_STORE).delete(upload.key);
  const sessions = transaction.objectStore(SESSION_STORE);
  const usage = await requestResult(
    sessions.get(upload.sessionId) as IDBRequest<SessionUploadUsage | undefined>,
  );
  if (usage !== undefined) {
    sessions.put({
      ...usage,
      pendingBytes: Math.max(0, usage.pendingBytes - upload.byteLength),
    } satisfies SessionUploadUsage);
  }
  await transactionDone(transaction);
  database.close();
}

async function defer(upload: PendingUpload) {
  const attempts = upload.attempts + 1;
  const delay = Math.min(MAX_RETRY_DELAY_MS, 500 * 2 ** Math.min(attempts, 6));
  const database = await openDatabase();
  const transaction = database.transaction(UPLOAD_STORE, "readwrite");
  transaction.objectStore(UPLOAD_STORE).put({
    ...upload,
    attempts,
    nextAttemptAt: Date.now() + delay,
  } satisfies PendingUpload);
  await transactionDone(transaction);
  database.close();
}
