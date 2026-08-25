import {
  ARTIFACT_CHUNK_SCHEMA_VERSION,
  SESSION_VIDEO_CHUNK_PATH,
} from "@app-o11y/protocol";
import {
  isCaptureRequest,
  type CaptureRequest,
  type CaptureEndedMessage,
  type CaptureResponse,
} from "../../capture-messages";
import type { CaptureMetadata } from "../../recording-coordinator";
import {
  drainUploads,
  enqueueUpload,
  UploadQueueCapacityError,
} from "../../upload-queue";

const CHUNK_INTERVAL_MS = 5_000;
const RECORDING_LIMIT_MS = 30 * 60 * 1_000;
const MIME_TYPES = [
  { mimeType: "video/webm;codecs=vp9", codec: "vp9" as const },
  { mimeType: "video/webm;codecs=vp8", codec: "vp8" as const },
];

type ActiveCapture = {
  sessionId: string;
  recorder: MediaRecorder;
  stream: MediaStream;
  metadata: CaptureMetadata;
  sequence: number;
  previousActiveTimeMs: number;
  startedAtWallTime: number;
  uploadQueue: Promise<void>;
  uploadError: Error | null;
  stopPromise: Promise<CaptureMetadata> | null;
  limitTimer: number;
  stopping: boolean;
  pausedAtWallTime: number | null;
  pausedDurationMs: number;
};

let active: ActiveCapture | null = null;
let lastStopped: { sessionId: string; metadata: CaptureMetadata } | null = null;

void drainUploads().catch(() => undefined);

function videoChunkPath(sessionId: string, sequence: number) {
  return SESSION_VIDEO_CHUNK_PATH.replace(
    ":sessionId",
    encodeURIComponent(sessionId),
  ).replace(":sequence", String(sequence));
}

async function checksum(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function uploadChunk(capture: ActiveCapture, blob: Blob) {
  if (blob.size === 0) return;
  const bytes = await blob.arrayBuffer();
  const activeTimeEndMs = Math.max(
    capture.previousActiveTimeMs,
    Math.round(
      (capture.pausedAtWallTime ?? Date.now()) -
        capture.startedAtWallTime -
        capture.pausedDurationMs,
    ),
  );
  const sequence = capture.sequence;
  const digest = await checksum(bytes);
  await enqueueUpload({
    sessionId: capture.sessionId,
    kind: "video",
    sequence,
    checksum: digest,
    path: videoChunkPath(capture.sessionId, sequence),
    headers: {
        "content-type": "application/octet-stream",
        "x-o11y-schema-version": String(ARTIFACT_CHUNK_SCHEMA_VERSION),
        "x-o11y-active-start-ms": String(capture.previousActiveTimeMs),
        "x-o11y-active-end-ms": String(activeTimeEndMs),
        "x-o11y-checksum": digest,
    },
    body: bytes,
  });
  capture.sequence += 1;
  capture.previousActiveTimeMs = activeTimeEndMs;
  void drainUploads().catch(() => undefined);
}

function notifyEnded(capture: ActiveCapture, message: CaptureEndedMessage) {
  if (capture.stopping) return;
  void browser.runtime.sendMessage(message).catch(() => undefined);
}

async function startCapture(
  sessionId: string,
  streamId: string,
  startedAtWallTime: number,
): Promise<CaptureMetadata> {
  if (active?.sessionId === sessionId) return active.metadata;
  if (active !== null) throw new Error("Another tab capture is already active");

  const supported = MIME_TYPES.find(({ mimeType }) =>
    MediaRecorder.isTypeSupported(mimeType),
  );
  if (supported === undefined) {
    throw new Error("Chrome does not support WebM VP9 or VP8 recording");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      // Chrome's tab-capture constraints are not part of lib.dom's media types.
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
        maxWidth: 1280,
        maxHeight: 720,
        maxFrameRate: 15,
      },
    } as MediaTrackConstraints,
  });
  const settings = stream.getVideoTracks()[0]?.getSettings();
  const metadata: CaptureMetadata = {
    codec: supported.codec,
    viewport: {
      width: settings?.width ?? 1280,
      height: settings?.height ?? 720,
      devicePixelRatio: 1,
    },
  };
  const recorder = new MediaRecorder(stream, {
    mimeType: supported.mimeType,
    videoBitsPerSecond: 2_500_000,
  });
  const capture: ActiveCapture = {
    sessionId,
    recorder,
    stream,
    metadata,
    sequence: 0,
    previousActiveTimeMs: 0,
    startedAtWallTime,
    uploadQueue: Promise.resolve(),
    uploadError: null,
    stopPromise: null,
    limitTimer: 0,
    stopping: false,
    pausedAtWallTime: null,
    pausedDurationMs: 0,
  };
  active = capture;
  lastStopped = null;

  recorder.addEventListener("dataavailable", (event) => {
    capture.uploadQueue = capture.uploadQueue
      .then(() => uploadChunk(capture, event.data))
      .catch((error: unknown) => {
        capture.uploadError =
          error instanceof Error
            ? error
            : new Error("Video chunk upload failed");
        const storageUnavailable =
          error instanceof DOMException &&
          ["InvalidStateError", "QuotaExceededError", "UnknownError"].includes(
            error.name,
          );
        if (error instanceof UploadQueueCapacityError || storageUnavailable) {
          notifyEnded(capture, {
            type: "capture:ended",
            sessionId,
            reason:
              error instanceof UploadQueueCapacityError
                ? "queue_limit"
                : "storage_unavailable",
            message: capture.uploadError.message,
          });
        }
      });
  });
  recorder.addEventListener("error", () => {
    notifyEnded(capture, {
      type: "capture:ended",
      sessionId,
      reason: "capture-error",
      message: "Chrome reported a tab capture error.",
    });
  });
  stream.getVideoTracks()[0]?.addEventListener("ended", () => {
    notifyEnded(capture, {
      type: "capture:ended",
      sessionId,
      reason: "stream-ended",
      message: "Chrome stopped the tab capture stream.",
    });
  });
  recorder.start(CHUNK_INTERVAL_MS);
  capture.limitTimer = window.setTimeout(() => {
    notifyEnded(capture, {
      type: "capture:ended",
      sessionId,
      reason: "time-limit",
      message: "The 30-minute recording limit was reached.",
    });
  }, RECORDING_LIMIT_MS);
  return metadata;
}

function stopCapture(sessionId: string): Promise<CaptureMetadata> {
  if (active === null || active.sessionId !== sessionId) {
    if (lastStopped?.sessionId === sessionId) {
      return Promise.resolve(lastStopped.metadata);
    }
    throw new Error("The tab capture is no longer active");
  }
  if (active.stopPromise !== null) return active.stopPromise;
  const capture = active;
  capture.stopping = true;
  window.clearTimeout(capture.limitTimer);
  capture.stopPromise = new Promise<CaptureMetadata>((resolve, reject) => {
    capture.recorder.addEventListener(
      "stop",
      () => {
        void capture.uploadQueue.then(() => {
          capture.stream.getTracks().forEach((track) => track.stop());
          lastStopped = { sessionId, metadata: capture.metadata };
          active = null;
          if (capture.uploadError !== null) reject(capture.uploadError);
          else resolve(capture.metadata);
        });
      },
      { once: true },
    );
    if (capture.recorder.state === "inactive") {
      void capture.uploadQueue.then(() => {
        lastStopped = { sessionId, metadata: capture.metadata };
        active = null;
        if (capture.uploadError !== null) reject(capture.uploadError);
        else resolve(capture.metadata);
      });
    } else {
      capture.recorder.stop();
    }
  });
  return capture.stopPromise;
}

function pauseCapture(sessionId: string) {
  if (active?.sessionId !== sessionId) return;
  if (active.recorder.state !== "recording") return;
  active.pausedAtWallTime = Date.now();
  active.recorder.requestData();
  active.recorder.pause();
}

function resumeCapture(sessionId: string) {
  if (active?.sessionId !== sessionId) return;
  if (active.recorder.state !== "paused") return;
  const resumedAt = Date.now();
  active.pausedDurationMs += Math.max(
    0,
    resumedAt - (active.pausedAtWallTime ?? resumedAt),
  );
  active.pausedAtWallTime = null;
  active.recorder.resume();
}

async function handleCaptureMessage(
  message: CaptureRequest,
): Promise<CaptureResponse> {
  try {
    if (message.type === "capture:start") {
      return {
        ok: true,
        active: true,
        metadata: await startCapture(
          message.sessionId,
          message.streamId,
          message.startedAtWallTime,
        ),
      };
    }
    if (message.type === "capture:stop") {
      return {
        ok: true,
        active: false,
        metadata: await stopCapture(message.sessionId),
      };
    }
    if (message.type === "capture:pause") {
      pauseCapture(message.sessionId);
      return { ok: true, active: true };
    }
    if (message.type === "capture:resume") {
      resumeCapture(message.sessionId);
      return { ok: true, active: true };
    }
    return {
      ok: true,
      active: active?.sessionId === message.sessionId,
      ...(active?.sessionId === message.sessionId
        ? { metadata: active.metadata }
        : lastStopped?.sessionId === message.sessionId
          ? { metadata: lastStopped.metadata }
          : {}),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Tab capture failed",
    };
  }
}

browser.runtime.onMessage.addListener((message: unknown) => {
  // Returning a Promise claims the response. Ignore unrelated messages
  // synchronously so the background listener can answer them.
  if (!isCaptureRequest(message)) return undefined;
  return handleCaptureMessage(message);
});
