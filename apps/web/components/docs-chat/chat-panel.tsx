"use client";

import {
  Alert,
  AlertDescription,
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Label,
  Textarea,
} from "@pr-review/design";
import { ArrowUp, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import { Answer } from "@/components/docs-chat/answer";
import type { ChatError, DocsChat } from "@/components/docs-chat/use-docs-chat";
import { LogoMark } from "@/components/shell/logo-mark";
import { MAX_USER_CHARS } from "@/lib/docs-chat/limits";

const SUGGESTIONS = [
  "How do I get LintCat reviewing my pull requests?",
  "Which models can a repository use?",
  "What can the GitHub App access?",
  "How do I review changes before I push?",
];

const WAITING_LINES = [
  "Chasing down the answer…",
  "Stalking the right page…",
  "Batting an idea around…",
  "Circling a few times first…",
  "Knocking a few things off the table…",
];

// Decorative, so hidden from screen readers; the live region already says "Answering…".
function Waiting() {
  const [line, setLine] = useState(() => Math.floor(Math.random() * WAITING_LINES.length));
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setLine((i) => (i + 1) % WAITING_LINES.length), 1500);
    return () => clearInterval(timer);
  }, []);
  return (
    <li className="flex items-center gap-2 text-muted-foreground" aria-hidden>
      <LogoMark animate="always" />
      {WAITING_LINES[line]}
    </li>
  );
}

function waitFor(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 1) return "a minute";
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? "an hour" : `${hours} hours`;
}

function errorText(error: ChatError): string {
  switch (error.kind) {
    case "rate-limited":
      return `That's the limit for now. Try again in ${waitFor(error.retryAfterSeconds)}.`;
    case "unavailable":
      return "Ask AI isn't available right now.";
    case "interrupted":
      return "The answer was cut off.";
    case "failed":
      return "Something went wrong getting an answer.";
  }
}

export function ChatPanel({
  chat,
  inputRef,
  onNavigate,
}: {
  chat: DocsChat;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onNavigate: () => void;
}) {
  const { messages, streaming, error, send, retry, stop, reset } = chat;
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const waiting = streaming && messages.at(-1)?.role === "user";

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages, error]);

  const submit = (question: string) => {
    if (!question.trim() || streaming) return;
    send(question);
    setDraft("");
    inputRef.current?.focus();
  };

  const status = error
    ? errorText(error)
    : streaming
      ? "Answering…"
      : messages.at(-1)?.role === "assistant"
        ? "Answer ready."
        : "";

  return (
    <>
      <div ref={list} className="flex-1 overflow-y-auto px-4 py-5 text-sm leading-relaxed">
        {messages.length === 0 ? (
          <Empty className="justify-start border-0 p-0 md:p-0">
            <EmptyHeader>
              <EmptyTitle className="text-h3">Ask about LintCat</EmptyTitle>
              <EmptyDescription>
                Answers come from these docs, with links to the pages they used.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <ul className="flex w-full flex-col gap-2">
                {SUGGESTIONS.map((question) => (
                  <li key={question}>
                    <button
                      type="button"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-left font-medium text-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      onClick={() => submit(question)}
                    >
                      {question}
                    </button>
                  </li>
                ))}
              </ul>
            </EmptyContent>
          </Empty>
        ) : (
          <ol aria-label="Conversation" className="flex flex-col gap-5">
            {messages.map((message, i) =>
              message.role === "user" ? (
                <li
                  key={i}
                  className="max-w-[85%] self-end rounded-md bg-primary/10 px-3 py-2 whitespace-pre-wrap text-foreground"
                >
                  <span className="sr-only">You asked: </span>
                  {message.content}
                </li>
              ) : (
                <li key={i} aria-busy={streaming && i === messages.length - 1} className="text-foreground">
                  <span className="sr-only">Answer: </span>
                  <Answer text={message.content} onNavigate={onNavigate} />
                </li>
              ),
            )}
            {waiting ? <Waiting /> : null}
          </ol>
        )}
        {error ? (
          <Alert variant={error.kind === "rate-limited" ? "default" : "destructive"} className="mt-5">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              {errorText(error)}
              {error.kind === "interrupted" || error.kind === "failed" ? (
                <Button type="button" variant="outline" size="xs" onClick={retry}>
                  <RotateCcw />
                  Retry
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <p className="sr-only" aria-live="polite">
        {status}
      </p>

      <form
        className="flex flex-col gap-2 border-t border-border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <Label htmlFor="docs-chat-question" className="sr-only">
          Your question
        </Label>
        <Textarea
          id="docs-chat-question"
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit(draft);
            }
          }}
          maxLength={MAX_USER_CHARS}
          rows={2}
          placeholder="Ask a question about LintCat"
          className="max-h-40 resize-none"
        />
        <div className="flex items-center gap-2">
          {messages.length > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              <RotateCcw />
              New chat
            </Button>
          ) : null}
          {draft.length > MAX_USER_CHARS * 0.8 ? (
            <span className="text-caption text-muted-foreground">
              {draft.length}/{MAX_USER_CHARS}
            </span>
          ) : null}
          {streaming ? (
            <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={stop}>
              <Square />
              Stop
            </Button>
          ) : (
            <Button type="submit" size="sm" className="ml-auto" disabled={!draft.trim()}>
              <ArrowUp />
              Send
            </Button>
          )}
        </div>
      </form>
    </>
  );
}
