"use client";

import { Alert, AlertDescription, Button, Label, Textarea } from "@pr-review/design";
import { RotateCcw } from "@pr-review/design/icons";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { ChatPanel, type ChatCopy } from "@/components/docs-chat/chat-panel";
import { useStreamingChat } from "@/components/docs-chat/use-docs-chat";
import {
  MAX_ASSISTANT_CHARS,
  MAX_MESSAGES,
  MAX_SYSTEM_PROMPT_CHARS,
  MAX_USER_CHARS,
} from "@/lib/telemetry-agent/limits";
import { safeOrganizationHref } from "@/lib/telemetry-agent/system-prompt";

const COPY: Omit<ChatCopy, "safeHref"> = {
  title: "Ask about your telemetry",
  description: "The agent reads this organization's reviews, findings, tokens and cost before it answers.",
  placeholder: "Ask about reviews, findings or spend",
  suggestions: [
    "Which repositories cost the most in the last 30 days, and why?",
    "Are high-severity findings trending up or down?",
    "What categories of finding come up most often?",
    "Which recent reviews were slowest?",
  ],
  inputId: "telemetry-agent-question",
  maxUserChars: MAX_USER_CHARS,
};

const storageKey = (slug: string) => `lintcat:telemetry-agent:system-prompt:${slug}`;

// Storage can throw in a private window; the prompt then lasts only for the visit.
function readPrompt(slug: string): string {
  try {
    return window.localStorage.getItem(storageKey(slug)) ?? "";
  } catch {
    return "";
  }
}

function writePrompt(slug: string, prompt: string): void {
  try {
    if (prompt) window.localStorage.setItem(storageKey(slug), prompt);
    else window.localStorage.removeItem(storageKey(slug));
  } catch {}
}

export function TelemetryAgent({
  slug,
  endpoint,
  noModelKey,
}: {
  slug: string;
  endpoint: string;
  noModelKey?: { settingsHref: string | undefined };
}) {
  const [systemPrompt, setSystemPrompt] = useState("");
  const prompt = useRef(systemPrompt);
  const input = useRef<HTMLTextAreaElement>(null);
  const copy = useMemo(() => ({ ...COPY, safeHref: safeOrganizationHref(slug) }), [slug]);

  useEffect(() => {
    const saved = readPrompt(slug);
    prompt.current = saved;
    setSystemPrompt(saved);
  }, [slug]);

  const chat = useStreamingChat({
    url: endpoint,
    maxMessages: MAX_MESSAGES,
    maxAssistantChars: MAX_ASSISTANT_CHARS,
    extraBody: () => (prompt.current.trim() ? { systemPrompt: prompt.current } : {}),
  });

  const update = (value: string) => {
    prompt.current = value;
    setSystemPrompt(value);
    writePrompt(slug, value);
  };

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex h-[36rem] flex-col overflow-hidden rounded-md border border-border bg-background">
        {noModelKey ? (
          <Alert className="m-4 w-auto">
            <AlertDescription>
              {noModelKey.settingsHref ? (
                <>
                  The agent runs on this organization&apos;s model key.{" "}
                  <Link href={noModelKey.settingsHref} className="text-link underline underline-offset-2">
                    Add one in Settings
                  </Link>{" "}
                  to start.
                </>
              ) : (
                "The agent runs on this organization's model key. Ask an owner to add one in Settings."
              )}
            </AlertDescription>
          </Alert>
        ) : null}
        <ChatPanel chat={chat} inputRef={input} onNavigate={() => {}} copy={copy} />
      </div>

      <section aria-labelledby="telemetry-agent-system-prompt-label" className="flex flex-col gap-2">
        <Label id="telemetry-agent-system-prompt-label" htmlFor="telemetry-agent-system-prompt">
          System prompt
        </Label>
        <Textarea
          id="telemetry-agent-system-prompt"
          value={systemPrompt}
          onChange={(event) => update(event.target.value)}
          maxLength={MAX_SYSTEM_PROMPT_CHARS}
          rows={10}
          placeholder="e.g. Focus on cost. Always compare against the previous period and answer in under 100 words."
          className="resize-y"
        />
        <p className="text-caption text-muted-foreground">
          Sent with every question and saved in this browser. LintCat&apos;s own rules come first: the agent stays
          read-only and sees only repositories you can.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-caption text-muted-foreground">
            {systemPrompt.length}/{MAX_SYSTEM_PROMPT_CHARS}
          </span>
          {systemPrompt ? (
            <Button type="button" variant="ghost" size="xs" className="ml-auto" onClick={() => update("")}>
              <RotateCcw />
              Clear
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
