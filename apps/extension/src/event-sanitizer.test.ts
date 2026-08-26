import { describe, expect, it } from "vitest";
import { sanitizeNetworkDetail } from "./event-sanitizer.js";

describe("capture sanitization", () => {
  it("normalizes network metadata without retaining bodies or URL values", () => {
    const secret = "Bearer-private-token";
    const sanitized = sanitizeNetworkDetail(
      {
        source: "fetch",
        method: "post",
        url: `https://api.example/orders?authorization=${secret}`,
        status: 201,
        durationMs: 34.7,
        size: 120,
      },
      "https://shop.example",
    );
    const stored = JSON.stringify(sanitized);
    expect(stored).not.toContain(secret);
    expect(stored).not.toContain("body");
    expect(stored).not.toContain("headers");
    expect(sanitized).toMatchObject({
      method: "POST",
      originPath: "https://api.example/orders",
      queryKeys: ["authorization"],
      status: 201,
      durationMs: 35,
    });
  });
});
