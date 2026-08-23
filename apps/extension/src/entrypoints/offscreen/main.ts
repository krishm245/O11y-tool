import {
  ARTIFACT_CHUNK_SCHEMA_VERSION,
  LOCAL_API_ORIGIN,
  SESSION_VIDEO_CHUNK_PATH,
} from "@app-o11y/protocol";
import {
  isCaptureRequest,
  type CaptureRequest,
  type CaptureEndedMessage,
  type CaptureResponse,
} from "../../capture-messages";
import type { CaptureMetadata } from "../../recording-coordinator";

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
  startedAt: number;
  uploadQueue: Promise<void>;
  uploadError: Error | null;
  stopPromise: Promise<CaptureMetadata> | null;
  limitTimer: number;
  stopping: boolean;
};

let active: ActiveCapture | null = null;
let lastStopped: { sessionId: string; metadata: CaptureMetadata } | null = null;

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
    Math.round(performance.now() - capture.startedAt),
  );
  const sequence = capture.sequence;
  const response = await fetch(
    `${LOCAL_API_ORIGIN}${videoChunkPath(capture.sessionId, sequence)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-o11y-schema-version": String(ARTIFACT_CHUNK_SCHEMA_VERSION),
        "x-o11y-active-start-ms": String(capture.previousActiveTimeMs),
        "x-o11y-active-end-ms": String(activeTimeEndMs),
        "x-o11y-checksum": await checksum(bytes),
      },
      body: bytes,
    },
  );
  if (!response.ok) {
    throw new Error(
      `Video chunk ${sequence} upload failed with ${response.status}`,
    );
  }
  capture.sequence += 1;
  capture.previousActiveTimeMs = activeTimeEndMs;
}

function notifyEnded(capture: ActiveCapture, message: CaptureEndedMessage) {
  if (capture.stopping) return;
  void browser.runtime.sendMessage(message).catch(() => undefined);
}

async function startCapture(
  sessionId: string,
  streamId: string,
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
    startedAt: performance.now(),
    uploadQueue: Promise.resolve(),
    uploadError: null,
    stopPromise: null,
    limitTimer: 0,
    stopping: false,
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

async function handleCaptureMessage(
  message: CaptureRequest,
): Promise<CaptureResponse> {
  try {
    if (message.type === "capture:start") {
      return {
        ok: true,
        active: true,
        metadata: await startCapture(message.sessionId, message.streamId),
      };
    }
    if (message.type === "capture:stop") {
      return {
        ok: true,
        active: false,
        metadata: await stopCapture(message.sessionId),
      };
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
