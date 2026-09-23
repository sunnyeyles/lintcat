"use client";

import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@pr-review/design";
import { Sparkles } from "lucide-react";
import { useRef, useState } from "react";

import { ChatPanel } from "@/components/docs-chat/chat-panel";
import { useDocsChat } from "@/components/docs-chat/use-docs-chat";

// Lives in the docs layout, so the conversation outlasts closing the sheet and moving between pages.
export function AskAiButton() {
  const chat = useDocsChat();
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Sparkles />
          <span className="sr-only sm:not-sr-only">Ask AI</span>
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
      >
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-link" />
            Ask AI
          </SheetTitle>
          <SheetDescription>Answers come from these docs and can be wrong.</SheetDescription>
        </SheetHeader>
        <ChatPanel chat={chat} inputRef={input} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
