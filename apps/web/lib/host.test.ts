import { afterEach, describe, expect, it, vi } from "vitest";

import {
  appDomain,
  organizationSlugFromHost,
  RESERVED_SUBDOMAINS,
  sessionCookieDomain,
  subdomainRewritePath,
} from "@/lib/host";

const DOMAIN = "prreview.dev";

describe("organizationSlugFromHost", () => {
  it("reads the slug from an organization subdomain", () => {
    expect(organizationSlugFromHost("acme.prreview.dev", DOMAIN)).toBe("acme");
    expect(organizationSlugFromHost("my-org-2.prreview.dev", DOMAIN)).toBe("my-org-2");
  });

  it("gives nothing for the apex", () => {
    expect(organizationSlugFromHost("prreview.dev", DOMAIN)).toBeUndefined();
    expect(organizationSlugFromHost("prreview.dev:443", DOMAIN)).toBeUndefined();
  });

  it("gives nothing for each reserved name", () => {
    expect([...RESERVED_SUBDOMAINS].sort()).toEqual(
      ["admin", "api", "app", "auth", "docs", "mail", "status", "www"],
    );
    for (const name of RESERVED_SUBDOMAINS) {
      expect(organizationSlugFromHost(`${name}.prreview.dev`, DOMAIN)).toBeUndefined();
    }
  });

  it("lowercases the host", () => {
    expect(organizationSlugFromHost("ACME.PrReview.Dev", DOMAIN)).toBe("acme");
    expect(organizationSlugFromHost("WWW.PRREVIEW.DEV", DOMAIN)).toBeUndefined();
  });

  it("ignores a port", () => {
    expect(organizationSlugFromHost("acme.prreview.dev:8443", DOMAIN)).toBe("acme");
  });

  it("works on localhost for local development", () => {
    expect(organizationSlugFromHost("acme.localhost:3000", "localhost")).toBe("acme");
    expect(organizationSlugFromHost("localhost:3000", "localhost")).toBeUndefined();
    expect(organizationSlugFromHost("www.localhost:3000", "localhost")).toBeUndefined();
  });

  it("gives nothing for a Vercel preview host", () => {
    const preview = "pr-review-agents-git-feature-sunnyeyles.vercel.app";
    expect(organizationSlugFromHost(preview, DOMAIN)).toBeUndefined();
  });

  it("gives nothing for an unrelated host or a lookalike", () => {
    for (const host of [
      "acme.example.com",
      "acmeprreview.dev",
      "acme.prreview.dev.evil.test",
      "a.b.prreview.dev",
      "-acme.prreview.dev",
      "ac_me.prreview.dev",
      "127.0.0.1:3000",
      "",
      null,
      undefined,
    ]) {
      expect(organizationSlugFromHost(host, DOMAIN)).toBeUndefined();
    }
  });
});

describe("subdomainRewritePath", () => {
  it("serves a subdomain path from the organization's /o/ path", () => {
    expect(subdomainRewritePath("acme", "/")).toBe("/o/acme");
    expect(subdomainRewritePath("acme", "/repos/acme/api")).toBe("/o/acme/repos/acme/api");
  });

  it("leaves a path already under the same organization alone", () => {
    expect(subdomainRewritePath("acme", "/o/acme")).toBe("/o/acme");
    expect(subdomainRewritePath("acme", "/o/acme/usage")).toBe("/o/acme/usage");
  });

  it("keeps another organization's path inside this one, where it is not found", () => {
    expect(subdomainRewritePath("acme", "/o/globex/usage")).toBe("/o/acme/o/globex/usage");
    expect(subdomainRewritePath("acme", "/o/acmeco")).toBe("/o/acme/o/acmeco");
  });
});

describe("sessionCookieDomain", () => {
  it("scopes the cookie to the app domain so subdomains share it", () => {
    expect(sessionCookieDomain("prreview.dev")).toBe("prreview.dev");
    expect(sessionCookieDomain("lvh.me")).toBe("lvh.me");
  });

  it("stays host-only where browsers ignore a Domain attribute", () => {
    expect(sessionCookieDomain("localhost")).toBeUndefined();
    expect(sessionCookieDomain("127.0.0.1")).toBeUndefined();
  });
});

describe("appDomain", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads APP_DOMAIN, defaulting to localhost", () => {
    vi.stubEnv("APP_DOMAIN", "PrReview.dev");
    expect(appDomain()).toBe("prreview.dev");
    vi.stubEnv("APP_DOMAIN", "");
    expect(appDomain()).toBe("localhost");
  });
});
