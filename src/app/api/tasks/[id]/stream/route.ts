export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`http://127.0.0.1:8001/events/${id}`, { headers: { Accept: "text/event-stream" } });
  if (!res.ok || !res.body) return new Response("unavailable", { status: 502 });
  return new Response(res.body, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
