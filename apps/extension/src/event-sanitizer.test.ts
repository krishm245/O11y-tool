import { describe, expect, it } from "vitest";
import {
  sanitizeNetworkDetail,
  sanitizeRrwebValue,
} from "./event-sanitizer.js";

describe("capture sanitization", () => {
  it("removes query values and fragments from rrweb URL attributes", () => {
    const secret = "card-4111111111111111";
    const sanitized = sanitizeRrwebValue(
      {
        type: 2,
        data: {
          node: {
            attributes: {
              href: `/receipt?token=${secret}&view=full#${secret}`,
            },
          },
        },
      },
      "https://shop.example/checkout",
    );
    expect(JSON.stringify(sanitized)).not.toContain(secret);
    expect(JSON.stringify(sanitized)).toContain("token&view");
  });

  it("removes query values from serialized style and text URLs", () => {
    const secret = "signed-image-secret";
    const sanitized = sanitizeRrwebValue(
      {
        style: `background-image: url(https://cdn.example/image.png?signature=${secret})`,
        textContent: `See /receipt?token=${secret}`,
      },
      "https://shop.example/checkout",
    );
    expect(JSON.stringify(sanitized)).not.toContain(secret);
  });

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
