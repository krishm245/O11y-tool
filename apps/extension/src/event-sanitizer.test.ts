import { describe, expect, it } from "vitest";
import {
  sanitizeNetworkDetail,
  sanitizeResponseData,
} from "./event-sanitizer.js";

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

  it("redacts and bounds JSON response data", () => {
    const responseData = sanitizeResponseData({
      id: 42,
      accessToken: "private-token",
      customer: {
        email: "person@example.com",
        notes: "x".repeat(1_100),
      },
    });
    expect(responseData).toMatchObject({
      id: 42,
      accessToken: "[MASKED]",
      customer: { email: "person@example.com" },
    });
    expect(JSON.stringify(responseData)).not.toContain("private-token");
    expect(JSON.stringify(responseData).length).toBeLessThan(1_200);
  });

  it("retains sanitized response data in network details", () => {
    const secret = "private-token";
    const sanitized = sanitizeNetworkDetail(
      {
        source: "fetch",
        url: "https://api.example/orders",
        durationMs: 10,
        responseData: { id: 42, accessToken: secret },
      },
      "https://shop.example",
    );
    expect(sanitized).toMatchObject({
      responseData: { id: 42, accessToken: "[MASKED]" },
    });
    expect(JSON.stringify(sanitized)).not.toContain(secret);
  });
});
