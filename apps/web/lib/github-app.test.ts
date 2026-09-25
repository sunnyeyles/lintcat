import { describe, expect, it } from "vitest";

import { INSTALL_APP_URL, installAppUrl } from "@/lib/github-app";

describe("installAppUrl", () => {
  it("targets one account's install page", () => {
    expect(installAppUrl(42)).toBe(`${INSTALL_APP_URL}/permissions?target_id=42`);
  });

  it("falls back to GitHub's account chooser", () => {
    expect(installAppUrl()).toBe(INSTALL_APP_URL);
  });
});
