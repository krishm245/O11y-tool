import { sanitizeUrl } from "@app-o11y/privacy";

const NETWORK_EVENT = "o11y:network";
const NAVIGATION_EVENT = "o11y:navigation";

export default defineUnlistedScript(() => {
  const marker = "__o11yPageHooksV1__";
  const page = globalThis as typeof globalThis & Record<string, unknown>;
  if (page[marker] === true) return;
  page[marker] = true;

  function safeUrl(input: string | URL): string | null {
    try {
      const url = sanitizeUrl(String(input), location.href);
      return `${url.originPath}${
        url.queryKeys.length === 0 ? "" : `?${url.queryKeys.join("&")}`
      }`;
    } catch {
      return null;
    }
  }

  function emitNetwork(detail: Record<string, unknown>) {
    window.dispatchEvent(new CustomEvent(NETWORK_EVENT, { detail }));
  }

  const nativeFetch = window.fetch;
  window.fetch = async function o11yFetch(input, init) {
    const startedAt = performance.now();
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    const url = safeUrl(input instanceof Request ? input.url : String(input));
    try {
      const response = await nativeFetch.call(this, input, init);
      if (url !== null) {
        emitNetwork({
          source: "fetch",
          method,
          url,
          status: response.status,
          durationMs: performance.now() - startedAt,
          resourceType: "fetch",
          size: Number(response.headers.get("content-length")) || undefined,
        });
      }
      return response;
    } catch (error) {
      if (url !== null) {
        emitNetwork({
          source: "fetch",
          method,
          url,
          status: 0,
          durationMs: performance.now() - startedAt,
          resourceType: "fetch",
        });
      }
      throw error;
    }
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const xhrMetadata = new WeakMap<
    XMLHttpRequest,
    { method: string; url: string }
  >();
  XMLHttpRequest.prototype.open = function o11yOpen(
    this: XMLHttpRequest,
    method,
    url,
    ...rest
  ) {
    const sanitized = safeUrl(url);
    if (sanitized !== null) xhrMetadata.set(this, { method, url: sanitized });
    return nativeOpen.call(
      this,
      method,
      url,
      typeof rest[0] === "boolean" ? rest[0] : true,
      typeof rest[1] === "string" ? rest[1] : undefined,
      typeof rest[2] === "string" ? rest[2] : undefined,
    );
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function o11ySend(body) {
    const metadata = xhrMetadata.get(this);
    const startedAt = performance.now();
    if (metadata !== undefined) {
      this.addEventListener(
        "loadend",
        () => {
          emitNetwork({
            source: "xhr",
            method: metadata.method,
            url: metadata.url,
            status: this.status,
            durationMs: performance.now() - startedAt,
            resourceType: "xmlhttprequest",
            size: Number(this.getResponseHeader("content-length")) || undefined,
          });
        },
        { once: true },
      );
    }
    return nativeSend.call(this, body);
  };

  function emitNavigation(kind: string) {
    const url = safeUrl(location.href);
    if (url !== null) {
      window.dispatchEvent(
        new CustomEvent(NAVIGATION_EVENT, { detail: { kind, url } }),
      );
    }
  }

  for (const method of ["pushState", "replaceState"] as const) {
    const native = history[method];
    history[method] = function o11yHistory(...args) {
      const result = native.apply(this, args);
      emitNavigation(method);
      return result;
    };
  }
  window.addEventListener("popstate", () => emitNavigation("popstate"));
  window.addEventListener("hashchange", () => emitNavigation("hashchange"));
});
