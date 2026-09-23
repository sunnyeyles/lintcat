import { DOCS_PAGES } from "@/lib/docs";

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "code"; text: string };

const PAGE_PATHS = new Set(DOCS_PAGES.map((page) => page.href));

/** A same-site link to a docs page, optionally to one of its sections; anything else is null. */
function safeDocsHref(href: string): string | null {
  const match = /^(\/[a-z0-9/-]*?)\/?(#[a-z0-9-]+)?$/.exec(href);
  if (!match?.[1] || !PAGE_PATHS.has(match[1])) return null;
  return match[1] + (match[2] ?? "");
}

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

function parseInline(text: string): Inline[] {
  const inlines: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) inlines.push({ kind: "text", text: text.slice(last, match.index) });
    const [whole, code, strong, label, href] = match;
    if (code !== undefined) inlines.push({ kind: "code", text: code });
    else if (strong !== undefined) inlines.push({ kind: "strong", text: strong });
    else if (label !== undefined && href !== undefined) {
      const safe = safeDocsHref(href);
      inlines.push(safe ? { kind: "link", text: label, href: safe } : { kind: "text", text: label });
    } else inlines.push({ kind: "text", text: whole });
    last = match.index + whole.length;
  }
  if (last < text.length) inlines.push({ kind: "text", text: text.slice(last) });
  return inlines;
}

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

// Tolerates a half-streamed answer: an unclosed fence is still code.
export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", inlines: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trimStart().startsWith("```")) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !(lines[i] ?? "").trimStart().startsWith("```")) code.push(lines[i] ?? "");
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const item = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (item) {
      flush();
      const ordered = !BULLET.test(line);
      const previous = blocks.at(-1);
      const inlines = parseInline(item[1] ?? "");
      if (previous?.kind === "list" && previous.ordered === ordered) previous.items.push(inlines);
      else blocks.push({ kind: "list", ordered, items: [inlines] });
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "paragraph", inlines: [{ kind: "strong", text: heading[1] ?? "" }] });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
