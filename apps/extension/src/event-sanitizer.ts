import { MASKED_VALUE, safeElementLabel, sanitizeUrl } from "@app-o11y/privacy";
import type { JsonValue } from "@app-o11y/protocol";

const URL_ATTRIBUTE_NAMES = new Set([
  "action",
  "formaction",
  "href",
  "poster",
  "src",
  "srcset",
]);

function stripUrlValues(value: string, baseUrl: string): string {
  if (!value.includes("?") && !value.includes("#")) return value;
  try {
    const sanitized = sanitizeUrl(value, baseUrl);
    const keys = sanitized.queryKeys.map(encodeURIComponent).join("&");
    return `${sanitized.originPath}${keys.length === 0 ? "" : `?${keys}`} `.trim();
  } catch {
    return MASKED_VALUE;
  }
}

function stripUrlsInText(value: string, baseUrl: string): string {
  if (!value.includes("?")) return value;
  return value.replace(/(?:https?:\/\/|\/)[^\s"'<>)]*\?[^\s"'<>)]*/gi, (url) =>
    stripUrlValues(url, baseUrl),
  );
}

export function sanitizeRrwebValue(
  value: unknown,
  baseUrl: string,
  key = "",
): JsonValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    return URL_ATTRIBUTE_NAMES.has(key.toLowerCase())
      ? stripUrlValues(value, baseUrl)
      : stripUrlsInText(value, baseUrl);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRrwebValue(item, baseUrl));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([childKey, childValue]) => [
          childKey,
          sanitizeRrwebValue(childValue, baseUrl, childKey),
        ],
      ),
    );
  }
  return null;
}

export type PageNetworkDetail = {
  source: "fetch" | "xhr" | "resource";
  method?: string;
  url: string;
  status?: number;
  durationMs: number;
  resourceType?: string;
  size?: number;
};

export function sanitizeNetworkDetail(
  detail: PageNetworkDetail,
  baseUrl: string,
): JsonValue {
  const url = sanitizeUrl(detail.url, baseUrl);
  return {
    source: detail.source,
    method: (detail.method ?? "GET").toUpperCase().slice(0, 16),
    originPath: url.originPath,
    queryKeys: url.queryKeys,
    status:
      detail.status === undefined || !Number.isFinite(detail.status)
        ? null
        : Math.max(0, Math.trunc(detail.status)),
    durationMs: Math.max(0, Math.round(detail.durationMs)),
    resourceType: (detail.resourceType ?? detail.source).slice(0, 40),
    size:
      detail.size === undefined || !Number.isFinite(detail.size)
        ? null
        : Math.max(0, Math.round(detail.size)),
  };
}

export function interactionData(
  element: Element | null,
  extra: Record<string, JsonValue> = {},
): JsonValue {
  return { target: safeElementLabel(element), ...extra };
}
