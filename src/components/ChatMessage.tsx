"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

export function ChatMessage({ role, content, typing, onEdit, children }: {
  role: string; content: string; typing?: boolean; id?: number;
  onEdit?: (text: string) => void;
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(content);
  const isUser = role === "user";
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (editing) textareaRef.current?.focus(); }, [editing]);

  const submitEdit = () => {
    const text = editText.trim();
    if (text && text !== content && onEdit) { onEdit(text); setEditing(false); }
    else setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex gap-3 animate-fade-up">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-white flex items-center justify-center text-[11px] font-bold shrink-0">U</div>
        <div className="flex-1 min-w-0 space-y-2">
          <textarea ref={textareaRef} value={editText} onChange={e => setEditText(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-zinc-200 resize-y min-h-[60px] focus:outline-none focus:border-accent"
            onKeyDown={e => { if (e.key === "Escape") setEditing(false); if ((e.ctrlKey || e.metaKey) && e.key === "Enter") submitEdit(); }} />
          <div className="flex gap-2">
            <button onClick={submitEdit} className="px-3 py-1.5 bg-accent text-white text-xs rounded-lg">Rerun</button>
            <button onClick={() => setEditing(false)} className="px-3 py-1.5 bg-zinc-700 text-zinc-300 text-xs rounded-lg">Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 animate-fade-up group ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${isUser ? "bg-gradient-to-br from-indigo-500 to-purple-500 text-white" : "bg-gradient-to-br from-accent to-purple-400 text-white"}`}>
        {isUser ? "U" : "A"}
      </div>
      <div className="flex-1 min-w-0">
        {children && <div className="mb-2">{children}</div>}
        <div className={`msg-bubble rounded-lg px-3 py-2 text-sm ${isUser ? "bg-blue-600 text-white ml-auto max-w-[80%]" : "bg-zinc-800 text-zinc-200 max-w-[85%]"}`}>
          {typing ? <span className="typing text-zinc-400">{content}</span> :
           isUser ? <div className="whitespace-pre-wrap">{content}</div> :
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>}
        </div>
        <div className={`flex gap-2 mt-0.5 px-1 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? "justify-end" : ""}`}>
          {isUser && onEdit && <button onClick={() => { setEditing(true); setEditText(content); }} className="text-[11px] text-zinc-500 hover:text-accent">Edit</button>}
          {!isUser && <button onClick={() => navigator.clipboard.writeText(content)} className="text-[11px] text-zinc-500 hover:text-accent">Copy</button>}
        </div>
      </div>
    </div>
  );
}
