import { describe, expect, it } from "vitest";

import {
  apexUrl,
  authRedirect,
  isApexOnly,
  organizationPath,
  renamedOrganizationUrl,
  returnUrl,
  safeCallbackUrl,
  signInUrl,
  withinOrganization,
} from "@/lib/paths";

describe("organizationPath", () => {
  it("prefixes a page with its organization", () => {
    expect(organizationPath("acme")).toBe("/o/acme");
    expect(organizationPath("acme", "/repos/acme/api")).toBe("/o/acme/repos/acme/api");
  });
});

describe("withinOrganization", () => {
  it("drops the organization prefix", () => {
    expect(withinOrganization("/o/acme/usage")).toBe("/usage");
    expect(withinOrganization("/o/acme")).toBe("/");
    expect(withinOrganization("/sign-in")).toBe("/sign-in");
  });
});

const DOMAIN = "prreview.dev";

describe("safeCallbackUrl", () => {
  it("keeps a same-origin path", () => {
    expect(safeCallbackUrl("/o/acme/reviews/3?x=1", DOMAIN)).toBe("/o/acme/reviews/3?x=1");
  });

  it("keeps an absolute URL on the app domain or one of its subdomains", () => {
    expect(safeCallbackUrl("https://acme.prreview.dev/repos?x=1", DOMAIN)).toBe(
      "https://acme.prreview.dev/repos?x=1",
    );
    expect(safeCallbackUrl("https://prreview.dev/", DOMAIN)).toBe("https://prreview.dev/");
    expect(safeCallbackUrl("http://acme.localhost:3000/usage", "localhost")).toBe(
      "http://acme.localhost:3000/usage",
    );
  });

  it("falls back to the apex for anything that could leave the site", () => {
    const unsafe = [
      "https://evil.test",
      "https://prreview.dev.evil.test/",
      "https://evilprreview.dev/",
      "https://acme.prreview.dev@evil.test/",
      "https://user:pw@acme.prreview.dev/",
      "javascript://acme.prreview.dev/%0aalert(1)",
      "ftp://acme.prreview.dev/",
      "//evil.test",
      "/\\evil.test",
      "not a url",
      "",
      undefined,
      ["/o/a"],
    ];
    for (const value of unsafe) {
      expect(safeCallbackUrl(value, DOMAIN)).toBe("/");
    }
  });
});

describe("authRedirect", () => {
  const base = "https://prreview.dev";

  it("resolves a path against the apex", () => {
    expect(authRedirect("/o/acme", base, DOMAIN)).toBe("https://prreview.dev/o/acme");
  });

  it("returns to an organization subdomain", () => {
    expect(authRedirect("https://acme.prreview.dev/repos", base, DOMAIN)).toBe(
      "https://acme.prreview.dev/repos",
    );
  });

  it("keeps the current origin when it is not the app domain, as on a preview", () => {
    const preview = "https://x-git-branch-team.vercel.app";
    expect(authRedirect(`${preview}/o/acme`, preview, DOMAIN)).toBe(`${preview}/o/acme`);
  });

  it("sends anything else to the apex", () => {
    expect(authRedirect("https://evil.test/", base, DOMAIN)).toBe(base);
    expect(authRedirect("//evil.test", base, DOMAIN)).toBe(base);
  });
});

describe("returnUrl", () => {
  it("returns to the subdomain when the session cookie reaches it", () => {
    const url = "https://acme.prreview.dev/usage";
    expect(returnUrl(url, DOMAIN)).toBe(url);
    expect(returnUrl("/o/acme", DOMAIN)).toBe("/o/acme");
  });

  it("on localhost, returns to the subdomain's /o/ path on the apex instead", () => {
    expect(returnUrl("http://acme.localhost:3000/usage?r=7d", "localhost")).toBe(
      "/o/acme/usage?r=7d",
    );
    expect(returnUrl("http://localhost:3000/", "localhost")).toBe("http://localhost:3000/");
  });
});

describe("signInUrl", () => {
  it("carries the page to return to", () => {
    expect(signInUrl("/o/acme/usage?range=7d", DOMAIN)).toBe(
      "/sign-in?callbackUrl=%2Fo%2Facme%2Fusage%3Frange%3D7d",
    );
  });

  it("signs a subdomain visitor in on the apex", () => {
    expect(signInUrl("https://acme.prreview.dev/usage", DOMAIN)).toBe(
      "https://prreview.dev/sign-in?callbackUrl=https%3A%2F%2Facme.prreview.dev%2Fusage",
    );
    expect(signInUrl("http://acme.localhost:3000/", "localhost")).toBe(
      "http://localhost:3000/sign-in?callbackUrl=http%3A%2F%2Facme.localhost%3A3000%2F",
    );
  });
});

describe("renamedOrganizationUrl", () => {
  it("swaps the slug in an /o/ path and keeps the rest", () => {
    expect(renamedOrganizationUrl("/o/acme/usage?range=7d#top", "acme-corp", DOMAIN)).toBe(
      "/o/acme-corp/usage?range=7d#top",
    );
    expect(renamedOrganizationUrl("/o/acme", "acme-corp", DOMAIN)).toBe("/o/acme-corp");
  });

  it("moves a subdomain request to the new subdomain", () => {
    expect(renamedOrganizationUrl("https://acme.prreview.dev/repos/acme/api?x=1", "acme-corp", DOMAIN)).toBe(
      "https://acme-corp.prreview.dev/repos/acme/api?x=1",
    );
    expect(renamedOrganizationUrl("http://acme.localhost:3000/", "acme-corp", "localhost")).toBe(
      "http://acme-corp.localhost:3000/",
    );
  });

  it("sends a slug with no subdomain of its own to its /o/ path on the apex", () => {
    expect(renamedOrganizationUrl("https://acme.prreview.dev/usage?x=1", "admin", DOMAIN)).toBe(
      "https://prreview.dev/o/admin/usage?x=1",
    );
  });

  it("falls back to the organization's root without a recorded request", () => {
    expect(renamedOrganizationUrl(null, "acme-corp", DOMAIN)).toBe("/o/acme-corp");
  });
});

describe("apexUrl", () => {
  it("keeps a path as it is on the apex", () => {
    expect(apexUrl("/docs/quickstart", "prreview.dev", "https", DOMAIN)).toBe("/docs/quickstart");
    expect(apexUrl("/dashboard", null, "https", DOMAIN)).toBe("/dashboard");
  });

  it("makes it absolute on an organization subdomain, keeping the port", () => {
    expect(apexUrl("/dashboard", "acme.prreview.dev", "https", DOMAIN)).toBe(
      "https://prreview.dev/dashboard",
    );
    expect(apexUrl("/", "acme.localhost:3000", "http", "localhost")).toBe(
      "http://localhost:3000/",
    );
  });
});

describe("isApexOnly", () => {
  it("claims the docs and the organization picker", () => {
    expect(isApexOnly("/docs")).toBe(true);
    expect(isApexOnly("/docs/quickstart")).toBe(true);
    expect(isApexOnly("/dashboard")).toBe(true);
  });

  it("leaves an organization's own pages alone", () => {
    expect(isApexOnly("/")).toBe(false);
    expect(isApexOnly("/repos")).toBe(false);
    expect(isApexOnly("/o/acme/usage")).toBe(false);
  });
});
