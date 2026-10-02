import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

const AI_CRAWLERS = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"];

const PRIVATE = ["/o/", "/dashboard", "/sign-in", "/api/", "/dev/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [...AI_CRAWLERS, "*"].map((userAgent) => ({
      userAgent,
      allow: "/",
      disallow: PRIVATE,
    })),
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
