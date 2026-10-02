import type { FaqItem } from "@/lib/faq";
import { absoluteUrl, pageDates, SITE_NAME, siteUrl } from "@/lib/site";

type JsonLdObject = Record<string, unknown>;

export function organization(): JsonLdObject {
  return {
    "@type": "Organization",
    "@id": `${siteUrl()}/#organization`,
    name: SITE_NAME,
    url: siteUrl(),
    logo: absoluteUrl("/brand/lintcat-mark-colour.svg"),
  };
}

export function webSite(description: string): JsonLdObject {
  return {
    "@type": "WebSite",
    "@id": `${siteUrl()}/#website`,
    name: SITE_NAME,
    url: siteUrl(),
    description,
    publisher: { "@id": `${siteUrl()}/#organization` },
  };
}

export function webPage(path: string, name: string, description: string): JsonLdObject {
  const { published, modified } = pageDates(path);
  return {
    "@type": "WebPage",
    url: absoluteUrl(path),
    name,
    description,
    datePublished: published,
    dateModified: modified,
    isPartOf: { "@id": `${siteUrl()}/#website` },
  };
}

export function techArticle(path: string, headline: string, description: string): JsonLdObject {
  const { published, modified } = pageDates(path);
  const publisher = { "@id": `${siteUrl()}/#organization` };
  return {
    "@type": "TechArticle",
    url: absoluteUrl(path),
    mainEntityOfPage: absoluteUrl(path),
    headline,
    description,
    datePublished: published,
    dateModified: modified,
    author: publisher,
    publisher,
  };
}

export function faqPage(items: FaqItem[]): JsonLdObject {
  return {
    "@type": "FAQPage",
    mainEntity: items.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}

/** One `@graph` document; `<` escaped so text can never close the script tag. */
export function serializeJsonLd(nodes: JsonLdObject[]): string {
  return JSON.stringify({ "@context": "https://schema.org", "@graph": nodes }).replace(
    /</g,
    "\\u003c",
  );
}
