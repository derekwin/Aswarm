export function ChatMessage({ role, content }: { role: string; content: string; id: number }) {
  const isUser = role === "user";
  return (
    <div className={`flex gap-2 ${isUser ? "justify-end" : ""}`}>
      <div className={`rounded-lg px-3 py-2 max-w-[80%] text-sm ${
        isUser ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-200"
      }`}>
        <div className="whitespace-pre-wrap">{content}</div>
      </div>
    </div>
  );
}
