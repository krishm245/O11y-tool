import {
  MASKED_VALUE,
  isSensitiveField,
  safeElementLabel,
  sanitizeUrl,
} from "@app-o11y/privacy";
import type { JsonValue } from "@app-o11y/protocol";

const MAX_RESPONSE_DEPTH = 6;
const MAX_RESPONSE_ITEMS = 50;
const MAX_RESPONSE_NODES = 500;
const MAX_RESPONSE_STRING_LENGTH = 1_000;
const TRUNCATED_VALUE = "[TRUNCATED]";

function sanitizeResponseValue(
  value: unknown,
  key: string,
  depth: number,
  state: { nodes: number },
): JsonValue {
  state.nodes += 1;
  if (state.nodes > MAX_RESPONSE_NODES) return TRUNCATED_VALUE;
  if (key !== "" && isSensitiveField({ name: key })) return MASKED_VALUE;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    return value.length <= MAX_RESPONSE_STRING_LENGTH
      ? value
      : `${value.slice(0, MAX_RESPONSE_STRING_LENGTH)}${TRUNCATED_VALUE}`;
  }
  if (depth >= MAX_RESPONSE_DEPTH) return TRUNCATED_VALUE;
  if (Array.isArray(value)) {
    const items: JsonValue[] = [];
    for (const item of value.slice(0, MAX_RESPONSE_ITEMS)) {
      if (state.nodes >= MAX_RESPONSE_NODES) break;
      items.push(sanitizeResponseValue(item, "", depth + 1, state));
    }
    if (items.length < value.length) items.push(TRUNCATED_VALUE);
    return items;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const sanitized: Record<string, JsonValue> = {};
    for (const [childKey, childValue] of entries.slice(0, MAX_RESPONSE_ITEMS)) {
      if (state.nodes >= MAX_RESPONSE_NODES) break;
      sanitized[childKey] = sanitizeResponseValue(
        childValue,
        childKey,
        depth + 1,
        state,
      );
    }
    if (Object.keys(sanitized).length < entries.length) {
      sanitized[TRUNCATED_VALUE] = true;
    }
    return sanitized;
  }
  return null;
}

export function sanitizeResponseData(value: unknown): JsonValue {
  return sanitizeResponseValue(value, "", 0, { nodes: 0 });
}

export type PageNetworkDetail = {
  source: "fetch" | "xhr";
  method?: string;
  url: string;
  status?: number;
  durationMs: number;
  resourceType?: string;
  size?: number;
  responseData?: JsonValue;
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
    ...(detail.responseData === undefined
      ? {}
      : { responseData: sanitizeResponseData(detail.responseData) }),
  };
}

export function interactionData(
  element: Element | null,
  extra: Record<string, JsonValue> = {},
): JsonValue {
  return { target: safeElementLabel(element), ...extra };
}
