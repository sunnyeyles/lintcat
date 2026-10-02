import type { MetadataRoute } from "next";

import { absoluteUrl, pageDates, PUBLIC_PATHS } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({
    url: absoluteUrl(path),
    lastModified: pageDates(path).modified,
  }));
}
