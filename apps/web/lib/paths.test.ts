import { describe, expect, it } from "vitest";

import {
  organizationPath,
  safeCallbackUrl,
  signInPath,
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

describe("safeCallbackUrl", () => {
  it("keeps a same-origin path", () => {
    expect(safeCallbackUrl("/o/acme/reviews/3?x=1")).toBe("/o/acme/reviews/3?x=1");
  });

  it("falls back to the apex for anything that could leave the site", () => {
    const unsafe = ["https://evil.test", "//evil.test", "/\\evil.test", "", undefined, ["/o/a"]];
    for (const value of unsafe) {
      expect(safeCallbackUrl(value)).toBe("/");
    }
  });
});

describe("signInPath", () => {
  it("carries the page to return to", () => {
    expect(signInPath("/o/acme/usage?range=7d")).toBe(
      "/sign-in?callbackUrl=%2Fo%2Facme%2Fusage%3Frange%3D7d",
    );
  });
});
