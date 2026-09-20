const MESSAGES: Record<string, string> = {
  Configuration: "Sign-in could not be completed on our side. Try again in a moment.",
  AccessDenied: "GitHub did not grant access to this account.",
  OAuthCallbackError: "GitHub did not finish the sign-in. Try again.",
  OAuthCallback: "GitHub did not finish the sign-in. Try again.",
  Callback: "GitHub did not finish the sign-in. Try again.",
  OAuthAccountNotLinked: "This GitHub account is already linked to a different sign-in.",
  OAuthSignin: "The sign-in with GitHub could not be started.",
  OAuthSigninError: "The sign-in with GitHub could not be started.",
};

const GENERIC = "Sign-in failed. Try again.";

/** The message for an Auth.js `?error=` code; none when there is no error. */
export function signInErrorMessage(code: unknown): string | undefined {
  if (typeof code !== "string" || code === "") return undefined;
  return MESSAGES[code] ?? GENERIC;
}
