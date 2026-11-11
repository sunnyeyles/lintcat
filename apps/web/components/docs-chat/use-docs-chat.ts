"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_ASSISTANT_CHARS, MAX_MESSAGES } from "@/lib/docs-chat/limits";

type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatError =
  | { kind: "rate-limited"; retryAfterSeconds: number }
  | { kind: "unavailable" | "interrupted" | "failed" | "no-model-key" };

export type DocsChat = {
  messages: ChatMessage[];
  streaming: boolean;
  error?: ChatError;
  send: (question: string) => void;
  retry: () => void;
  stop: () => void;
  reset: () => void;
};

// A question left without an answer (it failed, or was stopped early) is dropped before the next one.
function answered(messages: ChatMessage[]): ChatMessage[] {
  return messages.at(-1)?.role === "user" ? messages.slice(0, -1) : messages;
}

function errorFor(response: Response): ChatError {
  if (response.status === 429) {
    const seconds = Number(response.headers.get("retry-after"));
    return { kind: "rate-limited", retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 60 };
  }
  if (response.status === 409) return { kind: "no-model-key" };
  return { kind: response.status === 503 ? "unavailable" : "failed" };
}

export type StreamingChatOptions = {
  url: string;
  maxMessages: number;
  maxAssistantChars: number;
  /** Extra fields sent with every question, read at send time. */
  extraBody?: () => Record<string, unknown>;
};

export function useDocsChat(): DocsChat {
  return useStreamingChat({
    url: "/api/docs-chat",
    maxMessages: MAX_MESSAGES,
    maxAssistantChars: MAX_ASSISTANT_CHARS,
  });
}

export function useStreamingChat(options: StreamingChatOptions): DocsChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<ChatError>();
  const controller = useRef<AbortController | null>(null);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const ask = useCallback(async (history: ChatMessage[], question: string) => {
    const { url, maxMessages, maxAssistantChars, extraBody } = latest.current;
    const conversation: ChatMessage[] = [...answered(history), { role: "user", content: question }];
    const outgoing = conversation
      .slice(-(maxMessages - 1))
      .map((message) => ({ ...message, content: message.content.slice(0, maxAssistantChars) }));
    const abort = new AbortController();
    controller.current = abort;
    setMessages(conversation);
    setError(undefined);
    setStreaming(true);

    let answer = "";
    const show = () =>
      setMessages([...conversation, ...(answer ? [{ role: "assistant" as const, content: answer }] : [])]);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...extraBody?.(), messages: outgoing }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        setError(errorFor(response));
        return;
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += value;
        show();
      }
    } catch {
      if (!abort.signal.aborted) setError({ kind: answer ? "interrupted" : "failed" });
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setStreaming(false);
      }
    }
  }, []);

  const send = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || controller.current) return;
      void ask(messages, trimmed);
    },
    [ask, messages],
  );

  const retry = useCallback(() => {
    const last = messages.findLastIndex((message) => message.role === "user");
    const question = messages[last];
    if (!question || controller.current) return;
    void ask(messages.slice(0, last), question.content);
  }, [ask, messages]);

  const stop = useCallback(() => controller.current?.abort(), []);

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setMessages([]);
    setError(undefined);
    setStreaming(false);
  }, []);

  return { messages, streaming, error, send, retry, stop, reset };
}
