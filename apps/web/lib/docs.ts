export type Heading = { id: string; title: string };
export type DocsPage = { href: string; title: string; summary: string };
export type DocsSection = { title: string; pages: DocsPage[] };

export const DOCS_HOME = "/docs";

/** A page's sections keyed by id, and the same headings in order for its table of contents. */
export function docsHeadings<const T extends Record<string, string>>(titles: T) {
  const list: Heading[] = Object.entries(titles).map(([id, title]) => ({ id, title }));
  return [Object.fromEntries(list.map((h) => [h.id, h])) as Record<keyof T, Heading>, list] as const;
}

export const DOCS_NAV: DocsSection[] = [
  {
    title: "Start here",
    pages: [
      {
        href: DOCS_HOME,
        title: "Introduction",
        summary: "What LintCat reviews, and how it gets onto your repositories.",
      },
      {
        href: "/docs/quickstart",
        title: "Quickstart",
        summary: "Install the GitHub App, add a model key, label a pull request.",
      },
      {
        href: "/docs/configuration",
        title: "Configuration",
        summary: "The model key, when each repository is reviewed, models and fixes.",
      },
    ],
  },
  {
    title: "How it works",
    pages: [
      {
        href: "/docs/how-it-works",
        title: "How LintCat works",
        summary: "What it looks for, and how it differs.",
      },
      {
        href: "/docs/security",
        title: "Security",
        summary: "What LintCat can access, and what it never does.",
      },
    ],
  },
  {
    title: "Reference",
    pages: [
      {
        href: "/docs/mcp-server",
        title: "MCP server",
        summary: "The same review over a working tree, inside your coding agent.",
      },
    ],
  },
];

export const LOOKS_FOR = [
  ["Correctness", "Logic errors, wrong bounds, unhandled null, broken error handling"],
  ["Security", "Auth, cross-tenant access, injection, secret leakage, privilege"],
  ["Performance", "N+1 queries, unbounded reads, quadratic scans, blocking I/O"],
  ["Tests", "Branches this change adds or changes and leaves untested"],
  ["Documentation", "Documentation this change made wrong"],
] as const;

export const DOCS_PAGES: DocsPage[] = DOCS_NAV.flatMap((section) => section.pages);

export type DocsNeighbours = { previous?: DocsPage; next?: DocsPage };

/** The pages either side of `href` in reading order; nothing for a page outside the nav. */
export function docsNeighbours(href: string): DocsNeighbours {
  const index = DOCS_PAGES.findIndex((page) => page.href === href);
  if (index === -1) return {};
  return { previous: DOCS_PAGES[index - 1], next: DOCS_PAGES[index + 1] };
}

/** The home entry matches only itself; any other also matches pages nested under it. */
export function isDocsPageActive(pathname: string, href: string): boolean {
  const page = pathname.replace(/\/$/, "") || "/";
  if (href === DOCS_HOME) return page === DOCS_HOME;
  return page === href || page.startsWith(`${href}/`);
}
