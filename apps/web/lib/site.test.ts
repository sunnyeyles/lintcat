import { afterEach, describe, expect, it, vi } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { DOCS_FAQ, HOME_FAQ, SECURITY_FAQ } from "@/lib/faq";
import { PAGE_DATES, PUBLIC_PATHS, siteUrl } from "@/lib/site";
import { faqPage, serializeJsonLd } from "@/lib/structured-data";

afterEach(() => vi.unstubAllEnvs());

describe("siteUrl", () => {
  it("is https on the app domain and http on localhost", () => {
    vi.stubEnv("APP_DOMAIN", "example.com");
    expect(siteUrl()).toBe("https://example.com");
    vi.stubEnv("APP_DOMAIN", "");
    expect(siteUrl()).toBe("http://localhost:3000");
  });
});

describe("PAGE_DATES", () => {
  it("dates every public page, and only those", () => {
    expect(Object.keys(PAGE_DATES).sort()).toEqual([...PUBLIC_PATHS].sort());
  });

  it("holds ISO dates, modified no earlier than published", () => {
    for (const { published, modified } of Object.values(PAGE_DATES)) {
      expect(published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(modified >= published).toBe(true);
    }
  });
});

describe("sitemap", () => {
  it("lists every public page with a lastmod", () => {
    vi.stubEnv("APP_DOMAIN", "example.com");
    const entries = sitemap();
    expect(entries.map((entry) => entry.url)).toContain("https://example.com/docs/security");
    expect(entries).toHaveLength(PUBLIC_PATHS.length);
    for (const entry of entries) expect(entry.lastModified).toBeTruthy();
  });
});

describe("robots", () => {
  it("allows the AI crawlers and points at the sitemap", () => {
    vi.stubEnv("APP_DOMAIN", "example.com");
    const { rules, sitemap: map } = robots();
    const agents = [rules].flat().map((rule) => rule.userAgent);
    for (const bot of ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]) {
      expect(agents).toContain(bot);
    }
    for (const rule of [rules].flat()) expect(rule.allow).toBe("/");
    expect(map).toBe("https://example.com/sitemap.xml");
  });
});

describe("structured data", () => {
  it("phrases every FAQ entry as a question", () => {
    for (const { question } of [...HOME_FAQ, ...DOCS_FAQ, ...SECURITY_FAQ]) {
      expect(question.endsWith("?")).toBe(true);
    }
  });

  it("escapes < so text cannot close the script tag", () => {
    const json = serializeJsonLd([faqPage([{ question: "</script>?", answer: "a" }])]);
    expect(json).not.toContain("<");
    expect(JSON.parse(json)["@graph"][0].mainEntity[0].name).toBe("</script>?");
  });
});
