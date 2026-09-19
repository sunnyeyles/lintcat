export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  "www",
  "app",
  "api",
  "auth",
  "admin",
  "docs",
  "status",
  "mail",
]);

const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** The domain organizations are subdomains of, from `APP_DOMAIN`; `localhost` when unset. */
export function appDomain(): string {
  return hostname(process.env.APP_DOMAIN || "localhost");
}

/** Lowercased, without port or trailing dot. */
export function hostname(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/** `<slug>.<app-domain>` gives the slug; any other host is not an organization's. */
export function organizationSlugFromHost(
  host: string | null | undefined,
  domain: string,
): string | undefined {
  if (!host) return undefined;
  const name = hostname(host);
  const suffix = `.${hostname(domain)}`;
  if (!name.endsWith(suffix)) return undefined;
  const label = name.slice(0, -suffix.length);
  if (!SLUG.test(label) || RESERVED_SUBDOMAINS.has(label)) return undefined;
  return label;
}

/** Where a subdomain request is served; a path already under this organization is left alone. */
export function subdomainRewritePath(slug: string, pathname: string): string {
  const root = `/o/${slug}`;
  if (pathname === root || pathname.startsWith(`${root}/`)) return pathname;
  return pathname === "/" ? root : root + pathname;
}

/** Host-only on localhost and IP addresses, where a Domain attribute is not honoured. */
export function sessionCookieDomain(domain: string): string | undefined {
  const name = hostname(domain);
  if (name === "localhost" || /^[\d.]+$/.test(name) || name.includes(":")) return undefined;
  return name;
}
