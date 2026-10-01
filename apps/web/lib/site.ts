import { DOCS_PAGES } from "@/lib/docs";
import { appDomain } from "@/lib/host";

export const SITE_NAME = "LintCat";

/** The apex origin public pages are canonical on; plain http on localhost. */
export function siteUrl(): string {
  const domain = appDomain();
  return domain === "localhost" ? "http://localhost:3000" : `https://${domain}`;
}

export function absoluteUrl(path: string): string {
  return new URL(path, siteUrl()).href;
}

export type PageDates = { published: string; modified: string };

// Bump `modified` whenever a page's content changes; sitemap and JSON-LD both read it.
export const PAGE_DATES: Record<string, PageDates> = {
  "/": { published: "2026-09-23", modified: "2026-10-01" },
  "/docs": { published: "2026-09-22", modified: "2026-10-01" },
  "/docs/quickstart": { published: "2026-09-22", modified: "2026-09-25" },
  "/docs/configuration": { published: "2026-09-22", modified: "2026-09-25" },
  "/docs/how-it-works": { published: "2026-09-22", modified: "2026-09-29" },
  "/docs/security": { published: "2026-09-23", modified: "2026-10-01" },
  "/docs/mcp-server": { published: "2026-09-22", modified: "2026-09-25" },
};

export const PUBLIC_PATHS: string[] = ["/", ...DOCS_PAGES.map((page) => page.href)];

export function pageDates(path: string): PageDates {
  const dates = PAGE_DATES[path];
  if (!dates) throw new Error(`No PAGE_DATES entry for ${path}`);
  return dates;
}
