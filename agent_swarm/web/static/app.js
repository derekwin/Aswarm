/* AgentSwarm App — modular, testable frontend */

// ── Utils ──
const Utils = {
  esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
  formatTime(iso) { try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } },
  mdRender(text) {
    return Utils.esc(text)
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<div class="md-codeblock">$2</div>')
      .replace(/\*\*(.+?)\*\*/g, '<span class="md-bold">$1</span>')
      .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
  },
  debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; },
  $(sel) { return document.querySelector(sel); },
  $$(sel) { return document.querySelectorAll(sel); },
};

// ── i18n ──
const I18n = {
  _lang: localStorage.getItem("lang") || "en",
  _dict: {
    en: { newTask: "New Task", send: "Send", settings: "Settings", save: "Saved",
      noConvs: "No conversations yet", searchConv: "Search conversations...",
      taskPlaceholder: "Describe your task...", emptyTitle: "What do you want to research?",
      emptyDesc: "Describe your task. AgentSwarm decomposes it, spawns specialized agents, and executes them in parallel.",
      classifying: "Classifying task", decomposing: "Decomposed into",
      executing: "Executing agents", connected: "Connected", disconnected: "Disconnected",
      loadError: "Connection lost.", serverError: "Server error.", complete: "Complete",
      loading: "Loading conversation", deleteConfirm: "Delete this conversation?",
      agents: "agents", groups: "groups", retries: "Retries",
    },
    zh: { newTask: "新建任务", send: "发送", settings: "设置", save: "已保存",
      noConvs: "暂无对话", searchConv: "搜索对话...",
      taskPlaceholder: "描述你的任务...", emptyTitle: "想要研究什么？",
      emptyDesc: "描述你的任务。AgentSwarm 会拆解任务，生成专门 Agent，并行执行。",
      classifying: "正在分类任务", decomposing: "拆解为",
      executing: "正在执行 Agent", connected: "已连接", disconnected: "已断开",
      loadError: "连接已断开。", serverError: "服务器错误。", complete: "完成",
      loading: "加载对话", deleteConfirm: "确定删除此对话？",
      agents: "个 Agent", groups: "组", retries: "次重试",
    },
  },
  t(key) { return (this._dict[this._lang] || this._dict.en)[key] || key; },
  setLang(l) { this._lang = l; localStorage.setItem("lang", l); },
  getLang() { return this._lang; },
};

// ── Theme ──
const Theme = {
  _dark: localStorage.getItem("theme") !== "light",
  apply() {
    document.documentElement.classList.toggle("light", !this._dark);
    const btn = Utils.$("#themeBtn");
    if (btn) btn.textContent = this._dark ? "☀️" : "🌙";
  },
  toggle() { this._dark = !this._dark; localStorage.setItem("theme", this._dark ? "dark" : "light"); this.apply(); },
};

// ── API ──
const API = {
  async get(path) { const r = await fetch(path); if (!r.ok) throw new Error(r.statusText); return r.json(); },
  async post(path, body) { const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(r.statusText); return r.json(); },
  async del(path) { const r = await fetch(path, { method: "DELETE" }); if (!r.ok) throw new Error(r.statusText); return r.json(); },
  async put(path, body) { const r = await fetch(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(r.statusText); return r.json(); },
};

// ── State ──
const State = {
  conversations: {},
  activeConvId: null,
  eventSource: null,
  agentStates: {},
  totalAgents: 0,
  completedAgents: 0,
  curProvider: "ollama",
};

// ── Toast ──
const Toast = {
  show(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = msg;
    const c = document.getElementById("toastContainer");
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity 0.3s"; setTimeout(() => t.remove(), 300); }, 4000);
  },
};

// ── DOM references ──
function D(id) { return document.getElementById(id); }

// ── Empty state ──
function emptyStateHTML() {
  return '<div class="empty-state">' +
    '<div class="icon">✦</div>' +
    '<h2>' + Utils.esc(I18n.t("emptyTitle")) + '</h2>' +
    '<p>' + Utils.esc(I18n.t("emptyDesc")) + '</p>' +
    '<div class="suggestion-chips">' +
    '<button class="suggestion-chip" onclick="UI.suggest(\'调研2025年国产AI芯片市场并生成分析报告\')">国产芯片市场调研</button>' +
    '<button class="suggestion-chip" onclick="UI.suggest(\'对比分析 React 和 Vue 在2025年的生态和发展趋势\')">React vs Vue</button>' +
    '<button class="suggestion-chip" onclick="UI.suggest(\'写一篇关于大语言模型发展的技术报告\')">LLM报告</button>' +
    '</div></div>';
}

// ── UI ──
const UI = {
  init() { Theme.apply(); this.refreshLang(); this.loadConversations(); },
  refreshLang() {
    D("convSearch").placeholder = I18n.t("searchConv");
    D("queryInput").placeholder = I18n.t("taskPlaceholder");
    document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = I18n.t(el.dataset.i18n); });
  },
  suggest(text) { D("queryInput").value = text; D("queryInput").focus(); },
  setTitle(text) { D("convTitle").textContent = text || I18n.t("newTask"); },
  setConnected(on) { const d = D("connDot"); d.className = "conn-dot " + (on ? "on" : "off"); d.title = I18n.t(on ? "connected" : "disconnected"); },
  updateProgress() {
    const bar = D("progressBar"), fill = D("progressFill");
    if (State.totalAgents === 0) { bar.style.display = "none"; return; }
    bar.style.display = "block";
    fill.style.width = Math.round(State.completedAgents / State.totalAgents * 100) + "%";
    if (State.completedAgents >= State.totalAgents && State.totalAgents > 0) {
      setTimeout(() => { bar.style.display = "none"; State.totalAgents = 0; State.completedAgents = 0; }, 2000);
    }
  },

  // ── Conversations ──
  async loadConversations() {
    try {
      const data = await API.get("/api/conversations");
      State.conversations = {};
      data.forEach(c => { State.conversations[c.id] = { title: c.title, msgs: [], time: Utils.formatTime(c.created_at), _loaded: false }; });
      this.renderConvs();
    } catch (e) { console.error("Load conversations failed:", e); }
  },

  async newConversation() {
    if (State.eventSource) State.eventSource.close();
    try {
      const resp = await fetch("/api/conversations?title=New+Task", { method: "POST" });
      const data = await resp.json();
      State.conversations[data.id] = { title: data.title, msgs: [], time: Utils.formatTime(data.created_at), _loaded: true };
      State.activeConvId = data.id;
      this.renderConvs();
      D("chatArea").innerHTML = emptyStateHTML();
      this.setTitle(I18n.t("newTask"));
      D("submitBtn").disabled = false;
      this.resetTask();
    } catch (e) { console.error("New conversation failed:", e); }
  },

  async switchConversation(id) {
    if (State.eventSource) State.eventSource.close();
    if (State.conversations[State.activeConvId]) {
      State.conversations[State.activeConvId]._html = D("chatArea").innerHTML;
    }
    State.activeConvId = id;
    this.resetTask();
    const c = State.conversations[id];
    this.setTitle(c.title);
    if (!c._loaded) {
      D("chatArea").innerHTML = '<div class="flex items-center justify-center flex-1"><span class="typing">' + I18n.t("loading") + '</span></div>';
      await this.loadMessages(id);
    }
    D("chatArea").innerHTML = c._html || (c.msgs.length ? c.msgs.join("") : emptyStateHTML());
    this.renderConvs();
    D("submitBtn").disabled = false;
  },

  async loadMessages(convId) {
    try {
      const data = await API.get("/api/conversations/" + convId);
      State.conversations[convId]._loaded = true;
      if (data.messages?.length) {
        State.conversations[convId].msgs = data.messages.map(m =>
          m.role === "user" ? this._userBubble(m.content) : this._assistantBubble(m.content)
        );
      }
    } catch (e) { console.error("Load messages failed:", e); }
  },

  async deleteConversation(id) {
    if (!confirm(I18n.t("deleteConfirm"))) return;
    try {
      await API.del("/api/conversations/" + id);
      delete State.conversations[id];
      if (State.activeConvId === id) {
        const ids = Object.keys(State.conversations);
        if (ids.length) { await this.switchConversation(ids[ids.length - 1]); }
        else { State.activeConvId = null; D("chatArea").innerHTML = emptyStateHTML(); this.setTitle(I18n.t("newTask")); }
      }
      this.renderConvs();
    } catch (e) { console.error("Delete failed:", e); }
  },

  renderConvs() {
    const list = D("convList"), filter = (D("convSearch").value || "").toLowerCase();
    let ids = Object.keys(State.conversations);
    if (filter) ids = ids.filter(id => State.conversations[id].title.toLowerCase().includes(filter));
    if (!ids.length) { list.innerHTML = '<div class="empty-conv">' + I18n.t("noConvs") + '</div>'; return; }
    list.innerHTML = ids.map(id => {
      const c = State.conversations[id], active = id === State.activeConvId;
      return '<div class="conv-item' + (active ? " active" : "") + '" onclick="UI.switchConversation(\'' + id + '\')">' +
        '<div class="conv-info"><div class="conv-title">' + Utils.esc(c.title) + '</div><div class="conv-time">' + c.time + '</div></div>' +
        '<span class="conv-delete" onclick="event.stopPropagation();UI.deleteConversation(\'' + id + '\')">✕</span></div>';
    }).join("");
  },

  // ── Bubbles ──
  // ── Live Monitor ──
  toggleMonitor() { D("liveMonitor").classList.toggle("open"); },
  addLogEntry(agentName, action, category) {
    const log = D("monitorLog");
    const entry = document.createElement("div");
    entry.className = "monitor-log-entry " + category;
    entry.innerHTML = '<span class="log-agent">' + Utils.esc(agentName) + '</span> <span class="log-action">' + Utils.esc(action) + '</span>';
    log.prepend(entry);
    if (log.children.length > 50) log.lastChild.remove();
  },
  updateMonitorAgent(subtaskId, name, state, action) {
    const list = D("monitorAgents");
    let card = D("ma-" + subtaskId);
    if (!card) {
      card = document.createElement("div"); card.className = "monitor-agent-card"; card.id = "ma-" + subtaskId;
      card.innerHTML = '<div class="monitor-agent-icon">' + subtaskId.replace("t","") + '</div><div class="monitor-agent-info"><div class="monitor-agent-name">' + Utils.esc(name || subtaskId) + '</div><div class="monitor-agent-action"></div></div>';
      list.appendChild(card);
    }
    card.className = "monitor-agent-card " + state;
    card.querySelector(".monitor-agent-icon").textContent = state === "completed" ? "✓" : state === "failed" ? "✗" : subtaskId.replace("t","");
    card.querySelector(".monitor-agent-action").textContent = action || "";
    // Update summary
    const total = State.totalAgents, done = Object.values(State.agentStates).filter(s => s.state === "completed" || s.state === "failed").length;
    D("monitorSummary").textContent = done + "/" + total;
    if (D("liveMonitor").classList.contains("open")) {
      D("monitorProgressFill").style.width = (total ? Math.round(done/total*100) : 0) + "%";
    }
  },

  // ── Edit & Re-run ──
  _userBubble(content) {
    const id = "ub-" + Date.now();
    return '<div class="user-bubble-wrapper fade-up" id="' + id + '"><div class="message user"><div class="bubble user">' + Utils.esc(content) +
      '</div><div class="avatar user">U</div></div>' +
      '<div class="bubble-actions"><button class="bubble-action-btn" onclick="UI.editMessage(\'' + id + '\')">✎</button></div></div>';
  },
  editMessage(id) {
    const wrapper = D(id), bubble = wrapper.querySelector(".bubble");
    const text = bubble.textContent;
    bubble.innerHTML = '<textarea class="edit-input" id="edit-' + id + '" rows="3">' + Utils.esc(text) + '</textarea>' +
      '<div class="edit-actions"><button class="save-btn" onclick="UI.saveEdit(\'' + id + '\')">Re-run</button><button class="cancel-btn" onclick="UI.cancelEdit(\'' + id + '\')">Cancel</button></div>';
    const ta = D("edit-" + id); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  },
  saveEdit(id) {
    const text = D("edit-" + id).value.trim(); if (!text) return;
    const wrapper = D(id);
    wrapper.querySelector(".bubble").innerHTML = Utils.esc(text);
    // Re-submit
    D("queryInput").value = text;
    UI.submitTask();
  },
  cancelEdit(id) {
    const wrapper = D(id);
    wrapper.querySelector(".bubble").innerHTML = Utils.esc(wrapper.querySelector(".bubble").querySelector("textarea")?.value || wrapper.querySelector(".bubble").textContent);
  },
  _assistantBubble(content, id) {
    return '<div class="fade-up message assistant" id="' + (id || "") + '"><div class="avatar assistant">S</div>' +
      '<div class="flex-1 min-w-0"><div class="bubble assistant">' + Utils.mdRender(content) +
      '</div><div id="st-' + (id || "") + '"></div></div></div>';
  },

  // ── Task ──
  resetTask() { State.agentStates = {}; State.totalAgents = 0; State.completedAgents = 0; UI.updateProgress(); },
  appendBubble(html) { D("chatArea").insertAdjacentHTML("beforeend", html); State.conversations[State.activeConvId]?.msgs.push(html); },

  async submitTask() {
    const q = D("queryInput").value.trim(); if (!q) return;
    if (!State.activeConvId) await this.newConversation();
    D("submitBtn").disabled = true; D("queryInput").value = "";
    const chat = D("chatArea");
    if (chat.querySelector(".empty-state")) chat.innerHTML = "";
    if (State.conversations[State.activeConvId].title === "New Task") {
      State.conversations[State.activeConvId].title = q.slice(0, 40);
      this.setTitle(q.slice(0, 40));
      this.renderConvs();
    }
    this.appendBubble(this._userBubble(q));
    const aid = "asst-" + Date.now();
    this.appendBubble(this._assistantBubble('<span class="typing">' + I18n.t("classifying") + '</span>', aid));
    chat.scrollTop = chat.scrollHeight;
    const bubble = Utils.$("#" + aid + " .bubble");
    this.setConnected(false);
    try {
      const resp = await fetch("/run?query=" + encodeURIComponent(q) + "&conv_id=" + encodeURIComponent(State.activeConvId), { method: "POST" });
      const { task_id } = await resp.json();
      if (State.eventSource) State.eventSource.close();
      State.eventSource = new EventSource("/stream/" + task_id);
      this.setConnected(true);
      State.eventSource.onmessage = e => UI.handleEvent(JSON.parse(e.data), bubble, aid, chat);
      State.eventSource.onerror = () => { this.setConnected(false); bubble.innerHTML = I18n.t("loadError"); D("submitBtn").disabled = false; };
    } catch (e) { this.setConnected(false); bubble.innerHTML = I18n.t("serverError"); D("submitBtn").disabled = false; }
  },

  handleEvent(data, bubble, aid, chat) {
    console.log("[AgentSwarm]", data.type, data.subtask_id || "", data.msg || "");
    switch (data.type) {
      case "status": bubble.innerHTML = '<span class="typing">' + Utils.esc(data.msg) + '</span>'; break;
      case "dag":
        State.totalAgents = data.subtasks.length; State.completedAgents = 0; UI.updateProgress();
        bubble.innerHTML = I18n.t("decomposing") + ' <strong>' + data.subtasks.length + ' ' + I18n.t("agents") + '</strong> across <strong>' + data.parallel_groups.length + ' ' + I18n.t("groups") + '</strong>.';
        this.loadMermaid(() => UI.renderStepper(aid, data));
        break;
      case "agent_start":
        State.agentStates[data.subtask_id] = { state: "running", name: data.agent_name, role: data.role };
        UI.updateStep(data.subtask_id);
        UI.updateMonitorAgent(data.subtask_id, data.agent_name, "running", "Started");
        break;
      case "agent_done":
        State.agentStates[data.subtask_id] = { state: data.state, name: State.agentStates[data.subtask_id]?.name || data.subtask_id, output: data.output, error: data.error, retry: data.retry_count };
        UI.updateStep(data.subtask_id);
        UI.updateMonitorAgent(data.subtask_id, State.agentStates[data.subtask_id]?.name, data.state, data.state);
        if (data.state === "completed" || data.state === "failed") { State.completedAgents++; UI.updateProgress(); }
        break;
      case "done":
        State.completedAgents = State.totalAgents; UI.updateProgress(); UI.setConnected(false);
        bubble.innerHTML = '<strong>' + I18n.t("complete") + '</strong>';
        if (data.summary) { const s = document.createElement("div"); s.className = "mt-3 p-3.5 rounded-lg text-xs leading-relaxed whitespace-pre-wrap max-h-[500px] overflow-y-auto"; s.style.background = "var(--bg-deeper)"; s.innerHTML = Utils.mdRender(data.summary); bubble.appendChild(s); }
        D("submitBtn").disabled = false;
        if (State.eventSource) State.eventSource.close();
        Toast.show('<div class="font-medium text-xs" style="color:var(--green)">✓ ' + I18n.t("complete") + '</div><div class="text-xs mt-1" style="color:var(--text-muted)">' + Utils.esc(State.conversations[State.activeConvId]?.title || "") + '</div>');
        break;
      case "error": UI.setConnected(false); bubble.innerHTML = '<span style="color:var(--red)">' + Utils.esc(data.msg) + '</span>'; D("submitBtn").disabled = false; break;
    }
    chat.scrollTop = chat.scrollHeight;
  },

  loadMermaid(cb) { if (window.mermaid) return cb(); const s = document.createElement("script"); s.src = "/static/mermaid.min.js"; s.onload = () => { mermaid.initialize({ startOnLoad: true, theme: document.documentElement.classList.contains("light") ? "default" : "dark" }); cb(); }; document.head.appendChild(s); },

  renderStepper(aid, data) {
    const st = D("st-" + aid); if (!st) return; st.innerHTML = "";
    const bl = document.createElement("div"); bl.className = "stepper";
    const dag = document.createElement("div"); dag.className = "dag-container";
    let mm = "graph LR\n";
    const colors = ["#6c5ce7", "#00d26a", "#f5a623", "#f93a3a", "#4f8fff", "#a78bfa"];
    data.parallel_groups.forEach((group, gi) => {
      mm += "  subgraph G" + (gi + 1) + "[G" + (gi + 1) + "]\n    style G" + (gi + 1) + " fill:var(--bg-deeper),stroke:" + colors[gi % colors.length] + "\n";
      group.forEach(tid => { const sd = data.subtasks.find(x => x.id === tid) || {}; mm += "    " + tid + '["' + Utils.esc((sd.name || tid).slice(0, 18)) + '"]\n'; });
      mm += "  end\n";
    });
    data.subtasks.forEach(s => { s.depends_on.forEach(dep => { mm += "  " + dep + " --> " + s.id + "\n"; }); });
    dag.innerHTML = '<div class="mermaid">' + mm + '</div>'; bl.appendChild(dag);
    const hd = document.createElement("div"); hd.className = "stepper-header";
    hd.innerHTML = '<span>' + I18n.t("agents") + '</span><span class="badge">' + data.parallel_groups.length + ' ' + I18n.t("groups") + '</span>';
    bl.appendChild(hd);
    const ss = document.createElement("div"); ss.className = "stepper-steps";
    data.subtasks.forEach(s => {
      const gIdx = data.parallel_groups.findIndex(g => g.includes(s.id));
      const sp = document.createElement("div"); sp.className = "step pending"; sp.id = "step-" + s.id;
      sp.innerHTML = '<div class="step-dot">' + (parseInt(s.id.replace("t", "")) || "") + '</div><div class="step-info"><div class="step-name">' + s.name.replace(/_/g, " ") + '</div><div class="step-meta">G' + (gIdx + 1) + " · " + s.tools.join(", ") + '</div></div>';
      sp.addEventListener("click", () => UI.openAgentPanel(s.id));
      ss.appendChild(sp);
    });
    bl.appendChild(ss); st.appendChild(bl);
  },

  updateStep(tid) {
    const sp = document.getElementById("step-" + tid); if (!sp) return;
    const inf = State.agentStates[tid];
    sp.className = "step " + inf.state;
    sp.classList.toggle("completed", inf.state === "completed");
    sp.classList.toggle("failed", inf.state === "failed");
    sp.classList.toggle("running", inf.state === "running");
    const dot = sp.querySelector(".step-dot");
    dot.textContent = inf.state === "completed" ? "✓" : inf.state === "failed" ? "✗" : dot.textContent;
  },

  openAgentPanel(tid) {
    const inf = State.agentStates[tid]; if (!inf || (!inf.output && !inf.error)) return;
    document.getElementById("panelTitle").textContent = inf.name || tid;
    document.getElementById("panelContent").innerHTML = Utils.mdRender((inf.output || "") + (inf.error ? "\n[ERROR: " + inf.error + "]" : "") + (inf.retry ? "\n" + I18n.t("retries") + ": " + inf.retry : ""));
    document.getElementById("agentPanel").classList.add("open");
  },

  // ── Sidebar ──
  toggleSidebar() { D("sidebar").classList.toggle("open"); D("sidebar-overlay").classList.toggle("show"); },

  // ── Command Palette ──
  openPalette() { D("cmdPalette").classList.add("open"); D("paletteInput").value = ""; D("paletteInput").focus(); UI.filterPalette(); },
  closePalette(e) { if (e && e.target !== D("cmdPalette")) return; D("cmdPalette").classList.remove("open"); },
  filterPalette() {
    const q = D("paletteInput").value.toLowerCase(), ids = Object.keys(State.conversations);
    let results = q ? ids.filter(id => State.conversations[id].title.toLowerCase().includes(q)) : ids.slice(-8).reverse();
    let html = '<div class="cmd-section">' + (q ? "Results" : "Recent") + '</div>';
    if (!results.length) html += '<div class="px-3 py-4 text-center text-xs" style="color:var(--text-muted)">No results</div>';
    results.forEach(id => {
      const c = State.conversations[id];
      html += '<div class="cmd-result" onclick="UI.switchConversation(\'' + id + '\');UI.closePalette()">' +
        '<span>' + Utils.esc(c.title) + '</span><span class="cmd-time">' + c.time + '</span></div>';
    });
    html += '<div class="border-t mt-2 pt-2" style="border-color:var(--border)"><div class="cmd-result" style="color:var(--accent)" onclick="UI.newConversation();UI.closePalette()">+ ' + I18n.t("newTask") + '</div></div>';
    document.getElementById("paletteResults").innerHTML = html;
  },

  // ── Settings ──
  async openSettings() {
    try {
      const s = await API.get("/api/settings");
      D("cfgBaseUrl").value = s.llm_base_url || "";
      D("cfgApiKey").value = s.llm_api_key || "";
      D("cfgClassifier").value = s.classifier_model || "";
      D("cfgDecomposer").value = s.decomposer_model || "";
      D("cfgDefaultModel").value = s.default_model || "";
      D("settingsModal").classList.add("open");
    } catch (e) { console.error("Load settings failed:", e); }
  },
  closeSettings(e) { if (e && e.target !== D("settingsModal")) return; D("settingsModal").classList.remove("open"); },
  switchProvider(p) {
    State.curProvider = p;
    document.querySelectorAll(".tab-btn").forEach(b => {
      const active = b.dataset.provider === p;
      b.classList.toggle("active", active);
      b.style.color = active ? "var(--text)" : "var(--text-secondary)";
    });
    D("fieldApiKey").style.display = p === "ollama" ? "none" : "block";
    const url = D("cfgBaseUrl");
    if (p === "ollama" && !url.value) url.value = "http://localhost:11434/v1";
    else if (p === "openai" && !url.value) url.value = "https://api.openai.com/v1";
    else if (p === "anthropic" && !url.value) url.value = "https://api.anthropic.com/v1";
  },
  async saveSettings() {
    const data = {
      llm_base_url: D("cfgBaseUrl").value, llm_api_key: D("cfgApiKey").value,
      classifier_model: D("cfgClassifier").value, decomposer_model: D("cfgDecomposer").value,
      default_model: D("cfgDefaultModel").value,
    };
    try { await API.put("/api/settings", data); this.closeSettings(); Toast.show('<span style="color:var(--green)">✓ ' + I18n.t("save") + '</span>'); }
    catch (e) { Toast.show("Save failed"); }
  },

  // ── Agent Panel ──
  closeAgentPanel() { D("agentPanel").classList.remove("open"); },

  // ── Theme / Lang ──
  toggleTheme() { Theme.toggle(); },
  toggleLang() { I18n.setLang(I18n.getLang() === "zh" ? "en" : "zh"); D("langBtn").textContent = I18n.getLang() === "zh" ? "EN" : "中"; this.refreshLang(); this.renderConvs(); },
};

// ── Keyboard shortcuts ──
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); UI.openPalette(); }
  if ((e.ctrlKey || e.metaKey) && e.key === "n") { e.preventDefault(); UI.newConversation(); }
  if (e.key === "Escape") {
    if (D("cmdPalette").classList.contains("open")) UI.closePalette();
    else if (D("agentPanel").classList.contains("open")) UI.closeAgentPanel();
    else if (D("sidebar").classList.contains("open")) UI.toggleSidebar();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); UI.submitTask(); }
});

// ── Boot ──
document.addEventListener("DOMContentLoaded", () => UI.init());
