"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChatMessage } from "@/components/ChatMessage";
import { AgentTracker } from "@/components/AgentTracker";
import { AgentDetailPanel } from "@/components/AgentDetailPanel";
import { ProgressBar } from "@/components/ProgressBar";
import { FilesPanel } from "@/components/FilesPanel";
import { SettingsModal } from "@/components/SettingsModal";
import { InputBar } from "@/components/InputBar";
import { Sidebar } from "@/components/Sidebar";
import { useT } from "@/hooks/useT";

async function get(path: string) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function post(path: string, body?: unknown) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

type Agent = { name: string; role: string; state: string; subtaskId: string; output?: string; error?: string };
type Msg = { role: string; content: string; id: number; typing?: boolean };

export default function Home() {
  const t = useT();
  const [ac, setAc] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [ags, setAgs] = useState<Record<string, Agent>>({});
  const [es, setEs] = useState("idle");
  const [tid, setTid] = useState<string | null>(null);
  const [convs, setConvs] = useState<{ id: string; title: string; createdAt: string }[]>([]);
  const [ld, setLd] = useState(false);
  const [prog, setProg] = useState<{ completed: number; total: number } | null>(null);
  const [det, setDet] = useState<Agent | null>(null);
  const [sf, setSf] = useState(false);
  const [ss, setSs] = useState(false);
  const [so, setSo] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const er = useRef<EventSource | null>(null);
  const rt = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ef = useRef(es); useEffect(() => { ef.current = es; }, [es]);

  const rc = useCallback(async () => { try { setConvs(await get("/api/conversations")); } catch { /* */ } }, []);
  useEffect(() => { rc(); }, [rc]);

  const st = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  useEffect(() => {
    if (es === "completed" || es === "failed") {
      const b = "AgentSwarm", p = es === "completed" ? "✓ " : "✗ "; let c = 0;
      const i = setInterval(() => { document.title = c % 2 === 0 ? p + b : b; if (++c > 6) { document.title = b; clearInterval(i); } }, 1000);
      return () => { document.title = b; clearInterval(i); };
    }
  }, [es]);

  const cs = useCallback((id: string) => {
    er.current?.close(); clearTimeout(rt.current);
    const e = new EventSource(`/api/tasks/${id}/stream`); er.current = e;
    e.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        switch (d.type) {
          case "exec_state": setEs(d.state); break;
          case "dag": setEs("streaming"); setMsgs(p => { const a = [...p]; const l = a[a.length-1]; if (l?.role==="assistant"&&l.typing) a[a.length-1]={...l,content:`${d.subtasks.length} agents ready`,typing:false}; return a; }); break;
          case "agent_start": setAgs(p => ({...p,[d.subtask_id]:{name:d.agent_name,role:d.role,state:"running",subtaskId:d.subtask_id}})); break;
          case "agent_done": setAgs(p => ({...p,[d.subtask_id]:{...p[d.subtask_id],state:d.state,output:d.output,error:d.error}})); break;
          case "progress": setProg({completed:d.completed,total:d.total}); break;
          case "done": if(d.summary) setMsgs(p=>[...p,{role:"assistant",content:d.summary,id:Date.now()}]); setEs("completed"); e.close(); st("✓ "+t("complete")); break;
          case "error": setMsgs(p=>{const a=[...p];const l=a[a.length-1];if(l?.role==="assistant")a[a.length-1]={...l,content:`**Error**: ${d.msg}`,typing:false};return a;}); setEs("failed"); e.close(); st("✗ "+t("failed")); break;
        }
      } catch { /* */ }
    };
    e.onerror = () => { e.close(); const s = ef.current; if (s==="streaming"||s==="decomposing"||s==="connecting") rt.current = setTimeout(()=>cs(id),2000); };
  }, [t]);
  useEffect(() => { return () => { er.current?.close(); clearTimeout(rt.current); }; }, []);

  const hs = async (query: string) => {
    let cid = ac;
    if (!cid) { try { const c = await post("/api/conversations", { title: query.slice(0, 40) }); cid = c.id; setAc(cid); rc(); } catch { return; } }
    if (!cid) return;
    setMsgs(p=>[...p,{role:"user",content:query,id:Date.now()}]);
    setMsgs(p=>[...p,{role:"assistant",content:t("decomposing"),typing:true,id:Date.now()+1}]);
    setEs("connecting"); setAgs({}); setProg(null); setDet(null);
    try {
      const r = await post("/api/tasks", { query, convId: cid, lang: localStorage.getItem("lang") || "en" });
      setTid(r.taskId); cs(r.taskId);
    } catch {
      setMsgs(p=>{const a=[...p];a[a.length-1]={...a[a.length-1],content:t("connectionLost"),typing:false};return a;}); setEs("failed");
    }
  };

  const hp = () => { er.current?.close(); setEs("cancelled"); if(tid) post(`/api/tasks/${tid}/cancel`).catch(()=>{}); };

  const sw = async (id: string) => {
    er.current?.close(); clearTimeout(rt.current); setAc(id); setLd(true);
    setMsgs([]); setAgs({}); setEs("idle"); setProg(null); setDet(null);
    try {
      const c = await get(`/api/conversations/${id}`);
      setMsgs((c.messages||[]).map((m:{role:string;content:string;id?:number})=>({role:m.role,content:m.content,id:m.id??Date.now()})));
      if(c.task?.status==="running"){setTid(c.task.id);setEs("streaming");cs(c.task.id);}
    } catch { /* */ }
    setLd(false);
  };

  const he = (t: string) => { if(t) hs(t); };
  const hc = convs.length > 0;
  const ca = Object.values(ags).filter(a=>a.state==="completed"||a.state==="failed").length;
  const ta = Math.max(Object.keys(ags).length, prog?.total||0);

  return (
    <div className="flex h-screen overflow-hidden">
      {so&&<div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={()=>setSo(false)}/>}
      <div className={`${so?"translate-x-0":"-translate-x-full"} lg:translate-x-0 fixed lg:static top-0 bottom-0 left-0 z-50 transition-transform duration-200`}>
        <Sidebar conversations={convs} activeId={ac} onSelect={(id)=>{sw(id);setSo(false)}}
          onNew={async()=>{er.current?.close();if(!hc){try{const c=await post("/api/conversations",{title:"New Task"});setAc(c.id);rc();}catch{/* */}}else setAc(null);setMsgs([]);setAgs({});setEs("idle");setProg(null)}}/>
      </div>
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-zinc-800 flex items-center px-4 shrink-0 glass-heavy">
          <button onClick={()=>setSo(!so)} className="lg:hidden mr-2 text-zinc-400 hover:text-zinc-200 p-1"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button>
          <h1 className="font-semibold text-sm">AgentSwarm</h1>
          <div className="ml-auto flex items-center gap-1">
            {ac&&Object.keys(ags).length>0&&<button onClick={()=>setSf(!sf)} className={`px-2 py-1 text-xs rounded ${sf?"bg-zinc-700 text-zinc-200":"text-zinc-500 hover:text-zinc-300"}`}>📂</button>}
            <button onClick={()=>setSs(!ss)} className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300">⚙</button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {!hc&&!ac?(
            <div className="flex flex-col items-center justify-center h-full gap-6 text-zinc-500 px-6">
              <div className="w-16 h-16 flex items-center justify-center text-3xl bg-zinc-800 border border-zinc-700 rounded-xl">⚡</div>
              <h2 className="text-xl font-bold text-zinc-300">{t("emptyTitle")}</h2>
              <p className="text-base">{t("emptyDesc")}</p>
              <div className="flex flex-wrap gap-3 justify-center max-w-2xl mt-1">
                {[
                  { icon: "🔬", title: "Market Research", query: "Research the 2025 domestic AI chip market including market share, major vendors, product lines, and policy environment" },
                  { icon: "💻", title: "Code Generation", query: "Write a Python scraper to crawl Douban Movie Top 250, extract ranking, title, rating, review count, and save as CSV" },
                  { icon: "📊", title: "Tech Comparison", query: "Compare React vs Vue ecosystems, performance, community activity, and trends in 2025" },
                ].map(ex => (
                  <button key={ex.title} onClick={() => hs(ex.query)}
                    className="flex flex-col items-center gap-2 p-4 bg-zinc-800 border border-zinc-700 rounded-xl w-44 hover:border-accent hover:scale-[1.02] transition-all text-left group">
                    <span className="text-2xl">{ex.icon}</span>
                    <span className="text-xs font-semibold text-zinc-300 group-hover:text-accent">{ex.title}</span>
                    <span className="text-[10px] text-zinc-500 line-clamp-2">{ex.query.slice(0, 60)}...</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-2 max-w-md w-full mt-2">
                <input id="qi" placeholder={t("taskPlaceholder")} className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  onKeyDown={e=>{if(e.key==="Enter"){const v=(e.target as HTMLInputElement).value.trim();if(v)hs(v)}}}/>
                <button onClick={()=>{const el=document.getElementById("qi")as HTMLInputElement;const v=el?.value.trim();if(v)hs(v)}} className="px-5 py-2.5 bg-accent text-white text-sm font-medium rounded-lg">{t("send")}</button>
              </div>
            </div>
          ):ld?(
            <div className="flex items-center justify-center h-full"><span className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin"/></div>
          ):(
            <div className="max-w-3xl mx-auto p-4 space-y-4">
              {msgs.map((m,i)=><ChatMessage key={m.id||i} {...m} onEdit={he}/>)}
              {prog&&ta>0&&<ProgressBar completed={ca} total={ta}/>}
              {es!=="idle"&&<AgentTracker agents={ags} execState={es} onAgentClick={setDet}/>}
              {det&&tid&&<AgentDetailPanel agent={det} taskId={tid} onClose={()=>setDet(null)}/>}
              {sf&&ac&&<FilesPanel convId={ac} onClose={()=>setSf(false)}/>}
            </div>
          )}
        </div>
        {hc||ac?<InputBar onSubmit={hs} onStop={hp} disabled={es==="streaming"||es==="decomposing"||es==="connecting"}/>:null}
      </main>
      {ss&&<SettingsModal onClose={()=>setSs(false)}/>}
      {toast&&<div className="fixed bottom-6 right-6 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-sm text-zinc-200 shadow-lg animate-fade-up z-50">{toast}</div>}
    </div>
  );
}
