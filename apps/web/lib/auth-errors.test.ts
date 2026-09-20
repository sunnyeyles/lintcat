import { describe, expect, it } from "vitest";

import { signInErrorMessage } from "@/lib/auth-errors";

describe("signInErrorMessage", () => {
  it("names what went wrong for the codes Auth.js sends", () => {
    expect(signInErrorMessage("AccessDenied")).toMatch(/did not grant/);
    expect(signInErrorMessage("Configuration")).toMatch(/on our side/);
    expect(signInErrorMessage("OAuthCallbackError")).toMatch(/did not finish/);
    expect(signInErrorMessage("OAuthAccountNotLinked")).toMatch(/already linked/);
    expect(signInErrorMessage("OAuthSignin")).toMatch(/could not be started/);
  });

  it("falls back to a generic message for an unknown code", () => {
    expect(signInErrorMessage("Verification")).toBe("Sign-in failed. Try again.");
  });

  it("is silent when there is no error", () => {
    expect(signInErrorMessage(undefined)).toBeUndefined();
    expect(signInErrorMessage("")).toBeUndefined();
    expect(signInErrorMessage(["AccessDenied"])).toBeUndefined();
  });
});
