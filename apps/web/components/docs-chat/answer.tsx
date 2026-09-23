import { cn } from "@pr-review/design";
import Link from "next/link";

import { parseAnswer, type Inline } from "@/lib/docs-chat/markdown";

function Inlines({ inlines, onNavigate }: { inlines: Inline[]; onNavigate: () => void }) {
  return inlines.map((inline, i) => {
    switch (inline.kind) {
      case "code":
        return (
          <code key={i} className="rounded-sm bg-surface-2 px-1 py-px font-mono text-[0.85em] text-foreground">
            {inline.text}
          </code>
        );
      case "strong":
        return (
          <strong key={i} className="font-semibold text-foreground">
            {inline.text}
          </strong>
        );
      case "link":
        return (
          <Link
            key={i}
            href={inline.href}
            onClick={onNavigate}
            className="text-link underline underline-offset-2 hover:no-underline"
          >
            {inline.text}
          </Link>
        );
      default:
        return inline.text;
    }
  });
}

export function Answer({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      {parseAnswer(text).map((block, i) => {
        if (block.kind === "code") {
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-sm border border-border bg-card px-3 py-2 font-mono text-label leading-relaxed text-foreground"
            >
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={i} className={cn("flex flex-col gap-1.5 pl-5", block.ordered ? "list-decimal" : "list-disc")}>
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inlines inlines={item} onNavigate={onNavigate} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={i}>
            <Inlines inlines={block.inlines} onNavigate={onNavigate} />
          </p>
        );
      })}
    </div>
  );
}
