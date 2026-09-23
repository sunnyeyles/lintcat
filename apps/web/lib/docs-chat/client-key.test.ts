import { describe, expect, it } from "vitest";

import { clientAddress, rateLimitKey } from "@/lib/docs-chat/client-key";

describe("clientAddress", () => {
  it("prefers x-real-ip", () => {
    const headers = new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" });
    expect(clientAddress(headers)).toEqual({ address: "203.0.113.7", source: "x-real-ip" });
  });

  it("falls back to the first x-forwarded-for entry", () => {
    const headers = new Headers({ "x-forwarded-for": " 198.51.100.1, 10.0.0.1" });
    expect(clientAddress(headers)).toEqual({ address: "198.51.100.1", source: "x-forwarded-for" });
  });

  it("puts a request without either header in one shared bucket", () => {
    expect(clientAddress(new Headers())).toEqual({ address: "unknown", source: "none" });
  });

  it("counts an IPv6 client by its /64", () => {
    const one = clientAddress(new Headers({ "x-real-ip": "2001:DB8:0:42:aaaa::1" }));
    const two = clientAddress(new Headers({ "x-real-ip": "2001:db8::42:ffff:1:2:3" }));
    expect(one.address).toBe("2001:db8:0:42::/64");
    expect(two.address).toBe("2001:db8:0:42::/64");
    expect(clientAddress(new Headers({ "x-real-ip": "::1" })).address).toBe("0:0:0:0::/64");
  });

  it("reads an IPv4-mapped IPv6 address as IPv4", () => {
    expect(clientAddress(new Headers({ "x-real-ip": "::ffff:203.0.113.7" })).address).toBe("203.0.113.7");
  });
});

describe("rateLimitKey", () => {
  it("hashes the address under the secret, so the key never holds it", () => {
    const key = rateLimitKey("203.0.113.7", "secret");
    expect(key).toMatch(/^docs-chat:ip:[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.7");
    expect(rateLimitKey("203.0.113.7", "secret")).toBe(key);
    expect(rateLimitKey("203.0.113.7", "other")).not.toBe(key);
    expect(rateLimitKey("203.0.113.8", "secret")).not.toBe(key);
  });
});
