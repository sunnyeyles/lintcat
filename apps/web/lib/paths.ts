export const REQUEST_PATH_HEADER = "x-request-path";

export function organizationPath(slug: string, path = ""): string {
  return `/o/${encodeURIComponent(slug)}${path}`;
}

/** Strips `/o/<slug>` so a page is recognised whichever organization it is in. */
export function withinOrganization(pathname: string): string {
  return pathname.replace(/^\/o\/[^/]+/, "") || "/";
}

/** Only a same-origin path survives; anything else falls back to the apex. */
export function safeCallbackUrl(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/";
  }
  return value;
}

export function signInPath(callbackUrl: string): string {
  return `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}
