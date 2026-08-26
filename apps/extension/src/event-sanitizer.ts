import { safeElementLabel, sanitizeUrl } from "@app-o11y/privacy";
import type { JsonValue } from "@app-o11y/protocol";

export type PageNetworkDetail = {
  source: "fetch" | "xhr";
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
