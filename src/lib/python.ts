const WORKER_URL = process.env.AGENTSWARM_WORKER_URL || "http://127.0.0.1:8001";

export async function decompose(query: string, lang = "en") {
  const res = await fetch(
    `${WORKER_URL}/decompose?query=${encodeURIComponent(query)}&lang=${lang}`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error(`Decompose failed: ${await res.text()}`);
  return res.json();
}

export async function executeTask(query: string, taskId: string, lang = "en", convId = "") {
  const res = await fetch(
    `${WORKER_URL}/execute?query=${encodeURIComponent(query)}&task_id=${taskId}&lang=${lang}&conv_id=${convId}`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error(`Execute failed: ${await res.text()}`);
  return res.json();
}

export async function cancelTask(taskId: string) {
  const res = await fetch(`${WORKER_URL}/cancel/${taskId}`, { method: "POST" });
  if (!res.ok) throw new Error(`Cancel failed: ${await res.text()}`);
  return res.json();
}

export function getEventStreamUrl(taskId: string): string {
  return `${WORKER_URL}/events/${taskId}`;
}
