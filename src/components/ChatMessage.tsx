"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function ChatMessage({ role, content, typing }: {
  role: string; content: string; typing?: boolean; id?: number;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex gap-3 animate-fade-up ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${isUser ? "bg-gradient-to-br from-indigo-500 to-purple-500 text-white" : "bg-gradient-to-br from-accent to-purple-400 text-white"}`}>
        {isUser ? "U" : "A"}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`msg-bubble rounded-lg px-3 py-2 text-sm ${isUser ? "bg-blue-600 text-white ml-auto max-w-[80%]" : "bg-zinc-800 text-zinc-200 max-w-[85%]"}`}>
          {typing ? (
            <span className="typing text-zinc-400">{content}</span>
          ) : isUser ? (
            <div className="whitespace-pre-wrap">{content}</div>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
}
