const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
};

function decode(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity] ?? entity);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

// Only safe because the markup is our own prose components, rendered by React.
export function htmlToCorpusText(html: string): string {
  const article = /<article[^>]*>([\s\S]*)<\/article>/.exec(html)?.[1];
  if (article === undefined) throw new Error("no <article> in the rendered page");

  const blocks: string[] = [];
  const hold = (block: string) => `\uE000${blocks.push(block) - 1}\uE000`;

  const text = article
    .replace(/<nav aria-label="Pagination"[\s\S]*?<\/nav>/g, "")
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<\/a>(?=<a )/g, "</a> ")
    .replace(/<caption[\s\S]*?<\/caption>/g, "")
    .replace(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/g, "\n\n$1:\n")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, (_, code: string) =>
      hold(`\n\n\`\`\`\n${decode(stripTags(code)).trim()}\n\`\`\`\n\n`),
    )
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/g, "\n\n# $1\n\n")
    .replace(
      /<section id="([^"]+)"[^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>/g,
      (_, id: string, title: string) => `\n\n## ${stripTags(title)} {#${id}}\n\n`,
    )
    .replace(/<aside[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>\s*<p[^>]*>/g, "\n\n**Note: $1** ")
    .replace(/<a [^>]*href="(\/[^"]*|https?:[^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_, href: string, label: string) =>
      `[${stripTags(label.replace(/<\/span>\s*<span[^>]*>/g, ": "))}](${href})`,
    )
    .replace(/<code>([\s\S]*?)<\/code>/g, "`$1`")
    .replace(/<\/?strong[^>]*>/g, "**")
    .replace(/<li[^>]*>/g, "\n- ")
    .replace(/<tr[^>]*>/g, "\n|")
    .replace(/<\/t[hd]>/g, " |")
    .replace(/<t[hd][^>]*>/g, " ")
    .replace(/<\/?(?:p|div|header|aside|section|ul|table|thead|tbody)[^>]*>/g, "\n\n");

  return decode(stripTags(text))
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\n(?=[-|] )/g, "\n")
    .replace(/\uE000(\d+)\uE000/g, (_, index: string) => blocks[Number(index)] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
