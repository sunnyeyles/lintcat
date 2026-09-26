import { DOCS_HOME } from "@/lib/docs";
import {
  hostname,
  organizationSlugFromHost,
  sessionCookieDomain,
  subdomainRewritePath,
} from "@/lib/host";

export const REQUEST_PATH_HEADER = "x-request-path";

/** The organization picker: the dashboard's own front door, on the apex beside the docs. */
export const DASHBOARD_PATH = "/dashboard";

export function organizationPath(slug: string, path = ""): string {
  return `/o/${encodeURIComponent(slug)}${path}`;
}

/** Strips `/o/<slug>` so a page is recognised whichever organization it is in. */
export function withinOrganization(pathname: string): string {
  return pathname.replace(/^\/o\/[^/]+/, "") || "/";
}

export const SIGN_IN_PATH = "/sign-in";

/** Docs, sign-in and the picker exist only on the apex; `/` on a subdomain is still that organization. */
export function isApexOnly(pathname: string): boolean {
  const page = pathname.replace(/\/$/, "") || "/";
  return (
    page === DASHBOARD_PATH ||
    page.startsWith(`${DASHBOARD_PATH}/`) ||
    page === SIGN_IN_PATH ||
    page === DOCS_HOME ||
    page.startsWith(`${DOCS_HOME}/`)
  );
}

/** Docs and the organization picker live on the apex, so a subdomain request needs an absolute link. */
export function apexUrl(
  path: string,
  host: string | null | undefined,
  protocol: string,
  domain: string,
): string {
  if (organizationSlugFromHost(host, domain) === undefined) return path;
  const port = host?.match(/:(\d+)$/)?.[0] ?? "";
  return `${protocol}://${hostname(domain)}${port}${path}`;
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
  const query = `${SIGN_IN_PATH}?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  if (callbackUrl.startsWith("/")) return query;
  const url = new URL(callbackUrl);
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${hostname(domain)}${port}${query}`;
}

/** The topbar's sign-in link for the page being served; none on the sign-in page itself. */
export function topbarSignInHref(requestPath: string | null, domain: string): string | undefined {
  if (!requestPath || requestPath === "/") return signInUrl(DASHBOARD_PATH, domain);
  const pathname = requestPath.startsWith("/")
    ? requestPath.replace(/[?#].*$/, "")
    : new URL(requestPath).pathname;
  if (pathname.replace(/\/$/, "") === SIGN_IN_PATH) return undefined;
  return signInUrl(requestPath, domain);
}

/** Where to land after sign-in; without a shared cookie a subdomain becomes its /o/ path. */
export function returnUrl(callbackUrl: string, domain: string): string {
  if (callbackUrl.startsWith("/") || sessionCookieDomain(domain) !== undefined) return callbackUrl;
  const url = new URL(callbackUrl);
  const slug = organizationSlugFromHost(url.host, domain);
  if (slug === undefined) return callbackUrl;
  return subdomainRewritePath(slug, url.pathname) + url.search + url.hash;
}

/** The requested page under the organization's current slug, on its subdomain if asked for on one. */
export function renamedOrganizationUrl(
  requested: string | null,
  slug: string,
  domain: string,
): string {
  if (!requested) return organizationPath(slug);
  if (requested.startsWith("/")) {
    return organizationPath(slug, requested.replace(/^\/o\/[^/?#]+/, ""));
  }
  const url = new URL(requested);
  const pathname = url.pathname.replace(/^\/o\/[^/]+/, "");
  const rest = url.search + url.hash;
  const port = url.port ? `:${url.port}` : "";
  const host = `${slug}.${hostname(domain)}`;
  // A reserved slug has no subdomain, so it is served at its /o/ path on the apex.
  if (organizationSlugFromHost(host, domain) !== slug) {
    const path = organizationPath(slug, pathname === "/" ? "" : pathname);
    return `${url.protocol}//${hostname(domain)}${port}${path}${rest}`;
  }
  return `${url.protocol}//${host}${port}${pathname || "/"}${rest}`;
}
