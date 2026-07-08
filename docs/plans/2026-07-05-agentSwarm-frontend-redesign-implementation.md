# AgentSwarm Frontend Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the AgentSwarm frontend from scratch in React + TypeScript, using an orchestration-first layout with dark tool aesthetic.

**Architecture:** Three-column layout (sidebar / canvas+chat / detail panel). State split into AppContext (conversations) / UIContext (theme, toasts) with per-conversation state loaded on demand. SSE stream managed via useEffect. All components typed.

**Tech Stack:** React 18, TypeScript, Vite 5, CSS custom properties (no CSS framework).

**Design doc:** `docs/plans/2026-07-05-agentSwarm-frontend-redesign.md`

---

### Preparation: Clean Slate

Before starting, remove the old JSX frontend code so we build from scratch while keeping config files.

**Step 1: Remove old source, keep config**

```bash
rm -rf /home/liujinyao/2606/agnetSwarm/frontend/src
mkdir -p /home/liujinyao/2606/agnetSwarm/frontend/src/{components,hooks,context,types,utils,styles}
```

**Step 2: Add TypeScript to the project**

```bash
cd /home/liujinyao/2606/agnetSwarm/frontend
npm install -D typescript @types/react @types/react-dom
```

**Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"]
}
```

**Step 4: Update `vite.config.js` → `vite.config.ts`** with path alias support.

**Step 5: Verify**: `npx tsc --noEmit` should pass (no files yet, so no errors).

---

### Task 1: Design System — CSS Tokens & Theme

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/reset.css`
- Create: `src/styles/global.css`

**Step 1: Create `src/styles/tokens.css`** — all CSS custom properties

```css
:root {
  /* Backgrounds */
  --bg-app: #09090b;
  --bg-surface: #131316;
  --bg-elevated: #1a1a1f;
  --bg-hover: rgba(255,255,255,0.04);

  /* Borders */
  --border: #252529;
  --border-hover: #333338;

  /* Text */
  --text-primary: #fafafa;
  --text-secondary: #a1a1aa;
  --text-muted: #52525b;

  /* Accent */
  --accent: #6366f1;
  --accent-soft: rgba(99,102,241,0.12);
  --accent-hover: rgba(99,102,241,0.2);

  /* Semantic */
  --success: #22c55e;
  --success-soft: rgba(34,197,94,0.12);
  --warning: #f59e0b;
  --danger: #ef4444;
  --danger-soft: rgba(239,68,68,0.12);

  /* Typography */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  --text-xs: 0.6875rem;
  --text-sm: 0.8125rem;
  --text-base: 0.9375rem;
  --text-lg: 1.125rem;
  --text-xl: 1.5rem;

  /* Spacing (4px unit) */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;
  --space-2xl: 32px;

  /* Radius */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Layout */
  --sidebar-width: 280px;
  --topbar-height: 52px;
  --input-height: 64px;
  --detail-width: 420px;
}
```

**Step 2: Create `src/styles/reset.css`** — minimal CSS reset

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
body { font-family: var(--font-sans); font-size: var(--text-base); line-height: 1.5; color: var(--text-primary); background: var(--bg-app); }
#root { display: flex; height: 100vh; overflow: hidden; }
button { font-family: inherit; cursor: pointer; border: none; background: none; color: inherit; font-size: inherit; }
input, textarea { font-family: inherit; font-size: inherit; color: inherit; }
a { color: inherit; text-decoration: none; }
```

**Step 3: Create `src/styles/global.css`** — rollup import

```css
@import './tokens.css';
@import './reset.css';
```

**Step 4: Verify**: No verification needed for CSS — it has no runtime errors. Check that build parses it: `npm run build` should pass (after creating a minimal `main.tsx`).

---

### Task 2: Type Definitions

**Files:**
- Create: `src/types/index.ts`

All TypeScript interfaces for the entire app. No runtime code.

```typescript
// ── Conversations ──

export interface ConvMeta {
  id: string;
  title: string;
  createdAt: string;
  loaded: boolean;
}

export interface Conversation extends ConvMeta {
  messages: Message[];
  agents: Record<string, AgentState>;
  dag: DAGData | null;
  activity: ActivityEntry[];
  totalAgents: number;
  completedAgents: number;
  running: boolean;
}

// ── Messages ──

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  typing?: boolean;
}

// ── Agents ──

export type AgentStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AgentState {
  name: string;
  role: string;
  state: AgentStatus;
  output?: string;
  error?: string;
  retryCount: number;
}

// ── DAG ──

export interface SubtaskInfo {
  id: string;
  name: string;
  role: string;
  tools: string[];
  dependsOn: string[];
}

export interface DAGData {
  intent: string;
  subtasks: SubtaskInfo[];
  parallelGroups: string[][];
}

// ── Activity ──

export interface ActivityEntry {
  agent: string;
  tool: string;
  args: string;
  time: number;
}

// ── SSE Events ──

export type SSEEvent =
  | { type: 'status'; msg: string }
  | { type: 'dag'; intent: string; subtasks: SubtaskInfo[]; parallel_groups: string[][] }
  | { type: 'agent_start'; subtask_id: string; agent_name: string; role: string }
  | { type: 'agent_done'; subtask_id: string; state: string; output?: string; error?: string; retry_count: number }
  | { type: 'tool_call'; agent_name: string; tool: string; args: string }
  | { type: 'done'; summary?: string; results?: unknown[] }
  | { type: 'error'; msg: string };

// ── Settings ──

export interface Settings {
  llm_base_url: string;
  llm_api_key: string;
  decomposer_model: string;
  default_model: string;
}

// ── Toast ──

export interface Toast {
  id: number;
  message: string;
}

// ── UI State ──

export type Theme = 'dark' | 'light';
export type Lang = 'zh' | 'en';
```

---

### Task 3: API Layer

**Files:**
- Create: `src/api/index.ts`

Typed wrapper around all backend endpoints. Replaces the old `api.js`.

```typescript
import type { ConvMeta, Conversation, Settings } from '@/types';

const BASE = '';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, options);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

export const api = {
  // Conversations
  listConversations: () => request<ConvMeta[]>('/api/conversations'),
  createConversation: (title = 'New Task') =>
    request<ConvMeta>(`/api/conversations?title=${encodeURIComponent(title)}`, { method: 'POST' }),
  getConversation: (id: string) => request<Conversation>(`/api/conversations/${id}`),
  deleteConversation: (id: string) => request<void>(`/api/conversations/${id}`, { method: 'DELETE' }),

  // Tasks
  runTask: (query: string, convId: string) =>
    request<{ task_id: string; conv_id: string }>(
      `/run?query=${encodeURIComponent(query)}&conv_id=${encodeURIComponent(convId)}`,
      { method: 'POST' }
    ),

  // Settings
  getSettings: () => request<Settings>('/api/settings'),
  saveSettings: (data: Settings) =>
    request<Settings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  // Workspace
  listFiles: (convId: string) =>
    request<{ files: { name: string; path: string; type: string; size: number }[] }>(
      `/api/workspace/${convId}`
    ),
  readFile: (convId: string, path: string) =>
    request<{ path: string; content: string }>(
      `/api/workspace/${convId}/file?path=${encodeURIComponent(path)}`
    ),

  // Upload
  uploadFile: async (file: File): Promise<{ filename: string; content: string; size: number; error?: string }> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    return res.json();
  },
};
```

---

### Task 4: State — AppContext (Conversation Metadata)

**Files:**
- Create: `src/context/AppContext.tsx`

Manages conversation list, active conversation ID. Separate from per-conversation data to avoid re-renders.

```typescript
import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { ConvMeta } from '@/types';
import { api } from '@/api';

interface AppState {
  conversations: Record<string, ConvMeta>;
  activeConvId: string | null;
}

type AppAction =
  | { type: 'SET_CONVS'; payload: Record<string, ConvMeta> }
  | { type: 'ADD_CONV'; payload: ConvMeta }
  | { type: 'DEL_CONV'; payload: string }
  | { type: 'SET_ACTIVE'; payload: string };

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_CONVS':
      return { ...state, conversations: action.payload };
    case 'ADD_CONV':
      return {
        ...state,
        conversations: { ...state.conversations, [action.payload.id]: action.payload },
        activeConvId: action.payload.id,
      };
    case 'DEL_CONV': {
      const { [action.payload]: _, ...rest } = state.conversations;
      return {
        ...state,
        conversations: rest,
        activeConvId: state.activeConvId === action.payload ? null : state.activeConvId,
      };
    }
    case 'SET_ACTIVE':
      return { ...state, activeConvId: action.payload };
    default:
      return state;
  }
}

function initAppState(): AppState {
  return { conversations: {}, activeConvId: null };
}

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, null, initAppState);

  useEffect(() => {
    api.listConversations()
      .then(data => {
        const convs: Record<string, ConvMeta> = {};
        data.forEach(c => { convs[c.id] = c; });
        dispatch({ type: 'SET_CONVS', payload: convs });
      })
      .catch(() => {});
  }, []);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}
```

---

### Task 5: State — UIContext (Theme, Lang, Toasts, UI Toggles)

**Files:**
- Create: `src/context/UIContext.tsx`

Separate context for UI-only state. Changes here never cause data re-renders.

```typescript
import { createContext, useContext, useReducer, useEffect, useCallback, type ReactNode } from 'react';
import type { Theme, Lang, Toast, AgentState } from '@/types';

interface UIState {
  theme: Theme;
  lang: Lang;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  panelAgent: AgentState | null;
  toasts: Toast[];
  connected: boolean;
}

type UIAction =
  | { type: 'SET_THEME'; payload: Theme }
  | { type: 'TOGGLE_THEME' }
  | { type: 'SET_LANG'; payload: Lang }
  | { type: 'TOGGLE_LANG' }
  | { type: 'SET_SIDEBAR_OPEN'; payload: boolean }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SETTINGS_OPEN'; payload: boolean }
  | { type: 'SET_PANEL_AGENT'; payload: AgentState | null }
  | { type: 'ADD_TOAST'; payload: string }
  | { type: 'REMOVE_TOAST'; payload: number }
  | { type: 'SET_CONNECTED'; payload: boolean };

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'SET_THEME': return { ...state, theme: action.payload };
    case 'TOGGLE_THEME': return { ...state, theme: state.theme === 'dark' ? 'light' : 'dark' };
    case 'SET_LANG': return { ...state, lang: action.payload };
    case 'TOGGLE_LANG': return { ...state, lang: state.lang === 'zh' ? 'en' : 'zh' };
    case 'SET_SIDEBAR_OPEN': return { ...state, sidebarOpen: action.payload };
    case 'TOGGLE_SIDEBAR': return { ...state, sidebarOpen: !state.sidebarOpen };
    case 'SET_SETTINGS_OPEN': return { ...state, settingsOpen: action.payload };
    case 'SET_PANEL_AGENT': return { ...state, panelAgent: action.payload };
    case 'ADD_TOAST': return { ...state, toasts: [...state.toasts, { id: Date.now(), message: action.payload }] };
    case 'REMOVE_TOAST': return { ...state, toasts: state.toasts.filter(t => t.id !== action.payload) };
    case 'SET_CONNECTED': return { ...state, connected: action.payload };
    default: return state;
  }
}

function initUIState(): UIState {
  return {
    theme: (localStorage.getItem('theme') as Theme) || 'dark',
    lang: (localStorage.getItem('lang') as Lang) || 'zh',
    sidebarOpen: true,
    settingsOpen: false,
    panelAgent: null,
    toasts: [],
    connected: false,
  };
}

// ... (context provider with localStorage sync effects)
```

Create the full context with `useUI()` hook and `UIProvider` component that syncs theme/lang to localStorage.

---

### Task 6: Utility — Markdown Render

**Files:**
- Create: `src/utils/mdRender.ts`

Simple markdown-to-HTML renderer. Port from existing `mdRender.js` with TypeScript.

```typescript
export function mdRender(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<div class="md-codeblock">$2</div>')
    .replace(/\*\*(.+?)\*\*/g, '<span class="md-bold">$1</span>')
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
    .replace(/\n/g, '<br>');
}
```

---

### Task 7: Component — Sidebar

**Files:**
- Create: `src/components/Sidebar.tsx`
- Create: `src/styles/sidebar.css`

Collapsible conversation list sidebar. Renders conversation items with search filter.

Key props/features:
- List conversations from AppContext
- Search/filter by title
- New conversation button (calls API)
- Delete conversation (with confirm)
- Active conversation highlight
- Responsive: collapses to overlay on narrow screens

**Step 1: Write the component** with proper TypeScript. Use `useApp()` for conversations, `useUI()` for sidebar toggle.

**Step 2: Write the CSS** — dark sidebar with hover states, active item highlight in accent color.

---

### Task 8: Component — TopBar

**Files:**
- Create: `src/components/TopBar.tsx`
- Create: `src/styles/topbar.css`

Minimal 52px top bar with:
- Hamburger button (toggles sidebar)
- Active conversation title
- Connection indicator dot (green/off)
- Theme toggle, language toggle, settings button
- Model badge (reads from settings)

---

### Task 9: Component — DAGView

**Files:**
- Create: `src/components/DAGView.tsx`
- Create: `src/styles/canvas.css`

Mermaid-based DAG visualization. Handles:
- Script loading (module-level singleton flag, no duplicate script tags)
- Empty state (before task starts)
- Loading state (while decomposing)
- Rendered SVG display
- Node hover/click → emits selected agent ID

Use `useRef` for pending render, `useState` for SVG, module `let` for loading flag.

---

### Task 10: Component — AgentCard & AgentPanel

**Files:**
- Create: `src/components/AgentCard.tsx`
- Create: `src/components/AgentDetailPanel.tsx`
- Create: `src/styles/agent.css`

**AgentCard**: Compact card showing agent name, status dot (color-coded), role. Sorted by status (running → pending → completed → failed). Click opens detail panel.

**AgentDetailPanel**: Slide-out panel from right edge (420px). Shows:
- Agent name + status header
- Tab bar: Output | Activity
- Output: Markdown-rendered agent output
- Activity: Tool call timeline (filtered for this agent)
- Close button

---

### Task 11: Component — ResultStream (Chat Messages)

**Files:**
- Create: `src/components/ResultStream.tsx`
- Create: `src/styles/chat.css`

Scrollable message list showing user prompts and agent responses.

Features:
- Auto-scroll to bottom on new messages
- User message bubbles (right-aligned, accent tint)
- Assistant message bubbles (left-aligned, dark surface)
- Edit user message inline (textarea + save/cancel)
- Typing indicator animation
- Markdown rendering for assistant content

Use `useRef` for scroll container, `useEffect` on messages length for auto-scroll.

---

### Task 12: Component — InputBar

**Files:**
- Create: `src/components/InputBar.tsx`
- Create: `src/styles/input.css`

Fixed-bottom input bar (64px).

Features:
- File upload button (hidden input, triggers upload API, appends content to textarea)
- Auto-resize textarea (min 48px, max 160px)
- Enter to send, Shift+Enter for newline
- Send button (disabled when empty or sending)
- Stop button (replaces Send when task is running, closes SSE)
- Creates conversation if none active, auto-titles from first query

---

### Task 13: Hooks — useTaskRunner (SSE + Task Execution)

**Files:**
- Create: `src/hooks/useTaskRunner.ts`

Encapsulates all SSE communication and state updates. This is the core orchestration hook.

```typescript
import { useCallback, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import type { SSEEvent } from '@/types';
import { api } from '@/api';

export function useTaskRunner() {
  const { dispatch } = useApp();
  const eventSourceRef = useRef<EventSource | null>(null);

  const runTask = useCallback(async (convId: string, query: string) => {
    // 1. Add user + assistant (typing) messages to conversation
    // 2. POST /run → get task_id
    // 3. Close any existing EventSource
    // 4. Create new EventSource for /stream/:task_id
    // 5. Handle SSE events:
    //    - 'dag' → set DAG data, total agents
    //    - 'agent_start' → update agent state to running
    //    - 'agent_done' → update agent state, increment completedAgents (atomic dispatch)
    //    - 'tool_call' → append activity entry
    //    - 'done' → final summary, close stream
    //    - 'error' → error message, close stream
  }, [dispatch]);

  const cancelTask = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    // Mark conversation as not running
  }, []);

  // Cleanup on unmount
  // useEffect(() => () => eventSourceRef.current?.close(), []);

  return { runTask, cancelTask, eventSourceRef };
}
```

**Key implementation detail for agent completion counting:**

Use atomic reducer actions — the SSE handler dispatches `INCREMENT_COMPLETED` (which reads from current state in the reducer), never reads from closure-captured state.

---

### Task 14: Component — SettingsModal

**Files:**
- Create: `src/components/SettingsModal.tsx`
- Create: `src/styles/modal.css`

Settings dialog with:
- Provider tabs (Ollama / OpenAI / Anthropic)
- Base URL input
- API Key input (hidden for Ollama)
- Decomposer model input
- Default model input
- Save button → PUT /api/settings, update global settings state, show toast

---

### Task 15: Component — ToastContainer

**Files:**
- Create: `src/components/ToastContainer.tsx`
- Create: `src/styles/toast.css`

Toast notification system:
- `useEffect` watches toasts array, sets timers for new toasts only
- Tracks timer IDs in `useRef<Set<number>>` to avoid duplicate timeouts
- Auto-dismiss after 3.5 seconds
- Renders toast stack in bottom-right corner

---

### Task 16: App Shell — Wire Everything Together

**Files:**
- Create: `src/App.tsx`
- Create: `src/main.tsx`

**`main.tsx`**: Render `<App />` inside `<React.StrictMode>` with an ErrorBoundary.

**`App.tsx`**: Compose all components:

```tsx
export default function App() {
  return (
    <AppProvider>
      <UIProvider>
        <div id="app">
          <Sidebar />
          <main className="main">
            <TopBar />
            <div className="canvas-area">
              <DAGView />
              <AgentProgressBar />
              <AgentCardList />
            </div>
            <ResizeHandle />
            <ResultStream />
          </main>
          <InputBar />
          <AgentDetailPanel />
          <SettingsModal />
          <ToastContainer />
        </div>
      </UIProvider>
    </AppProvider>
  );
}
```

**Step 1**: Create `main.tsx` with root render and ErrorBoundary.
**Step 2**: Create `App.tsx` composing all components.
**Step 3**: Create `src/styles/app.css` for top-level layout (flex, grid areas).

---

### Task 17: Build & Verify

**Files:**
- Modify: `frontend/index.html` — update script src to `/src/main.tsx`

**Step 1**: Run `npx tsc --noEmit` — should have 0 type errors.

**Step 2**: Run `npm run build` — should produce output in `../backend/static/`.

**Step 3**: Start backend and verify `http://localhost:8000` serves the new UI.

---

### Task 18: Remove Old Files & Cleanup

**Files to delete:**
- `src/api.js` (replaced by `src/api/index.ts`)
- All old `.jsx` components (already deleted in preparation step)
- `src/index.css`, `src/theme.css` (replaced by `src/styles/`)

**Files to keep:**
- `frontend/package.json`
- `frontend/vite.config.ts` (updated with TypeScript + path alias)
- `frontend/index.html` (script src updated)
- `frontend/public/mermaid.min.js`
- `frontend/data/` (unchanged)

---

## Execution Order

Tasks 1-3 are prerequisites (types + design system). Tasks 4-6 are foundation (state + utils). Tasks 7-15 are parallelizable components. Task 16-18 are integration and cleanup.

```
1 (Tokens) ──→ 2 (Types) ──→ 3 (API)
                  │              │
                  ▼              ▼
              4 (AppCtx)    5 (UICtx)    6 (mdRender)
                  │              │
                  └──────┬───────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
     7 (Sidebar)   8 (TopBar)    14 (Settings)
          │              │              │
     9 (DAGView)  11 (ResultStream) 15 (Toasts)
          │              │
    10 (AgentCard)  12 (InputBar)
          │              │
    13 (useTaskRunner) ──┘
                         │
                   16 (App.tsx)
                         │
                   17 (Verify)
                         │
                   18 (Cleanup)
```

Components 7-12 and 14-15 can be built in parallel by separate sub-agents since they're independent.
