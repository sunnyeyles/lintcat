import { describe, expect, it } from "vitest";

import { DOCS_HOME, DOCS_PAGES, docsNeighbours, isDocsPageActive } from "@/lib/docs";

describe("DOCS_PAGES", () => {
  it("starts at the home page and lists each page once", () => {
    expect(DOCS_PAGES[0]?.href).toBe(DOCS_HOME);
    expect(new Set(DOCS_PAGES.map((page) => page.href)).size).toBe(DOCS_PAGES.length);
  });
});

describe("docsNeighbours", () => {
  it("has no previous page at the start and no next page at the end", () => {
    expect(docsNeighbours(DOCS_HOME).previous).toBeUndefined();
    expect(docsNeighbours(DOCS_HOME).next?.href).toBe(DOCS_PAGES[1]?.href);
    expect(docsNeighbours(DOCS_PAGES[DOCS_PAGES.length - 1]!.href).next).toBeUndefined();
  });

  it("reads across sections", () => {
    const { previous, next } = docsNeighbours("/docs/trust-boundary");
    expect(previous?.href).toBe("/docs/how-it-works");
    expect(next?.href).toBe("/docs/agents");
  });

  it("gives nothing for a page outside the nav", () => {
    expect(docsNeighbours("/docs/nowhere")).toEqual({});
  });
});

describe("isDocsPageActive", () => {
  it("matches the home entry only on the home page", () => {
    expect(isDocsPageActive("/", DOCS_HOME)).toBe(true);
    expect(isDocsPageActive("/docs/quickstart", DOCS_HOME)).toBe(false);
  });

  it("matches a page and anything nested under it, trailing slash or not", () => {
    expect(isDocsPageActive("/docs/agents", "/docs/agents")).toBe(true);
    expect(isDocsPageActive("/docs/agents/", "/docs/agents")).toBe(true);
    expect(isDocsPageActive("/docs/agents/security", "/docs/agents")).toBe(true);
    expect(isDocsPageActive("/docs/agents-and-more", "/docs/agents")).toBe(false);
  });
});
