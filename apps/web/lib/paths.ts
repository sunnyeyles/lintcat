import {
  hostname,
  organizationSlugFromHost,
  sessionCookieDomain,
  subdomainRewritePath,
} from "@/lib/host";

export const REQUEST_PATH_HEADER = "x-request-path";

export function organizationPath(slug: string, path = ""): string {
  return `/o/${encodeURIComponent(slug)}${path}`;
}

/** Strips `/o/<slug>` so a page is recognised whichever organization it is in. */
export function withinOrganization(pathname: string): string {
  return pathname.replace(/^\/o\/[^/]+/, "") || "/";
}

function onAppDomain(url: URL, domain: string): boolean {
  const apex = hostname(domain);
  const name = url.hostname.toLowerCase();
  return name === apex || name.endsWith(`.${apex}`);
}

/** A same-origin path, or a URL on the app domain or its subdomains; else the apex. */
export function safeCallbackUrl(value: unknown, domain: string): string {
  if (typeof value !== "string") return "/";
  if (value.startsWith("/")) {
    return value.startsWith("//") || value.startsWith("/\\") ? "/" : value;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "/";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "/";
  if (url.username || url.password || !onAppDomain(url, domain)) return "/";
  return url.href;
}

/** Auth.js's redirect check, widened from the current origin to the app domain's subdomains. */
export function authRedirect(url: string, baseUrl: string, domain: string): string {
  const safe = safeCallbackUrl(url, domain);
  if (safe.startsWith("/") && safe !== "/") return baseUrl + safe;
  if (safe !== "/") return safe;
  try {
    if (new URL(url).origin === baseUrl) return url;
  } catch {}
  return baseUrl;
}

/** The sign-in page; for a subdomain URL, the one on the apex, since sign-in happens there. */
export function signInUrl(callbackUrl: string, domain: string): string {
  const query = `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  if (callbackUrl.startsWith("/")) return query;
  const url = new URL(callbackUrl);
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${hostname(domain)}${port}${query}`;
}

/** Where to land after sign-in; without a shared cookie a subdomain becomes its /o/ path. */
export function returnUrl(callbackUrl: string, domain: string): string {
  if (callbackUrl.startsWith("/") || sessionCookieDomain(domain) !== undefined) return callbackUrl;
  const url = new URL(callbackUrl);
  const slug = organizationSlugFromHost(url.host, domain);
  if (slug === undefined) return callbackUrl;
  return subdomainRewritePath(slug, url.pathname) + url.search + url.hash;
}
