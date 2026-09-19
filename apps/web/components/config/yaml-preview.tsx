"use client";

import { Button, cn } from "@pr-review/design";
import { Check, Copy } from "lucide-react";
import { useEffect, useId, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

/** execCommand is the fallback for insecure origins, where clipboard is absent. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea path
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export type YamlPreviewProps = {
  filename: string;
  caption: string;
  yaml: string;
  /** Read out by the live region instead of the whole document. */
  summary: string;
  className?: string;
};

export function YamlPreview({
  filename,
  caption,
  yaml,
  summary,
  className,
}: YamlPreviewProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2400);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <section
      aria-labelledby={titleId}
      className={cn("min-w-0 rounded-sm border border-rule bg-surface", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule-soft px-3 py-2">
        <div className="min-w-0">
          <h3 id={titleId} className="font-mono text-label text-ink">
            {filename}
          </h3>
          <p className="mt-0.5 font-mono text-caption text-slate">{caption}</p>
        </div>
        <Button
          type="button"
          variant={state === "copied" ? "subtle" : "default"}
          size="sm"
          onClick={() => {
            void writeClipboard(yaml).then((ok) => setState(ok ? "copied" : "failed"));
          }}
        >
          {state === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
          {state === "copied" ? "Copied" : "Copy YAML"}
        </Button>
      </div>

      <pre
        tabIndex={0}
        aria-label={`${filename} contents`}
        className="max-h-[26rem] overflow-auto px-3 py-3 font-mono text-caption leading-relaxed whitespace-pre text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      >
        {yaml}
      </pre>

      <p aria-live="polite" className="sr-only">
        {summary}
      </p>
      {state === "failed" ? (
        <p role="alert" className="border-t border-rule-soft px-3 py-2 font-mono text-caption text-warn">
          Could not reach the clipboard. Select the text above and copy it.
        </p>
      ) : null}
    </section>
  );
}
