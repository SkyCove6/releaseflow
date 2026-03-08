"use client";

import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, X, Send, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
  escalated?: boolean;
}

const GREETING: Message = {
  role:    "assistant",
  content: "Hi! I'm the ReleaseFlow support bot. How can I help you today?",
};

export function SupportWidget() {
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput]       = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const chatMutation = trpc.support.chat.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.answer, escalated: data.escalated },
      ]);
    },
    onError: (err) => {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Sorry, something went wrong: ${err.message}. Please try again.` },
      ]);
    },
  });

  // Scroll to bottom when messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatMutation.isPending]);

  function handleSend() {
    const text = input.trim();
    if (!text || chatMutation.isPending) return;

    const userMsg: Message = { role: "user", content: text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");

    // Send only role+content (strip escalated flag)
    chatMutation.mutate({
      messages: updated.map(({ role, content }) => ({ role, content })),
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all",
          "bg-primary text-primary-foreground hover:bg-primary/90"
        )}
        aria-label="Support chat"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex w-[360px] max-w-[calc(100vw-3rem)] flex-col rounded-xl border bg-background shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <MessageCircle className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">ReleaseFlow Support</span>
            <Badge variant="secondary" className="ml-auto text-xs">Beta</Badge>
          </div>

          {/* Messages */}
          <div className="flex max-h-96 min-h-[200px] flex-col gap-3 overflow-y-auto p-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn("flex flex-col gap-1", msg.role === "user" ? "items-end" : "items-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  )}
                >
                  {msg.content}
                </div>
                {msg.escalated && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <AlertCircle className="h-3 w-3 text-amber-500" />
                    Escalated to our team
                  </div>
                )}
              </div>
            ))}

            {chatMutation.isPending && (
              <div className="flex items-start">
                <div className="flex items-center gap-1.5 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t p-3 flex items-center gap-2">
            <Input
              placeholder="Ask anything…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={chatMutation.isPending}
              className="text-sm"
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!input.trim() || chatMutation.isPending}
              className="shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
