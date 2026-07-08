# AgentSwarm Frontend Redesign

**Date**: 2026-07-05
**Status**: Design Approved

## Summary

Complete frontend rewrite from scratch. The current UI broke after attempting to mimic ChatGPT's layout, which fundamentally clashes with AgentSwarm's multi-agent orchestration model. New design is **orchestration-first**: DAG visualization and agent execution monitoring are the primary views, with chat serving as an interaction entry point.

## Decisions

| Decision | Choice |
|----------|--------|
| Layout | 方案 A — 画布主视区 (DAG canvas as centerpiece) |
| Tech Stack | React 18 + Vite + TypeScript |
| Visual Style | 暗色工具风 (referencing Linear / N8N / Vercel) |
| State Management | useReducer + 分层 Context |

## Layout Structure

```
┌────────────┬──────────────────────────────────┐
│ Sidebar    │  TopBar                          │
│ (280px)    ├──────────────────────────────────┤
│            │  DAG Canvas + Agent Status       │
│ ▪ Conv 1   │  ┌───┐     ┌───┐                │
│ ▪ Conv 2   │  │ A │────→│ C │   ●●○○○ 3/5   │
│ ▪ Conv 3   │  └───┘     └───┘                │
│            │       ↘    ↗                     │
│            │     ┌───┐                        │
│            │     │ B │                        │
│            ├──────────────────────────────────┤
│            │  Result Stream (expandable)       │
│            │  S: Decomposed into 5 agents     │
│            │  S: Agent A done: report.md      │
│            │  S: Final summary...             │
│            ├──────────────────────────────────┤
│            │  [📎] Input...            [Send] │
└────────────┴──────────────────────────────────┘
```

## Component Tree

```
App
├── Sidebar (collapsible, 280px)
│   ├── Logo
│   ├── SearchInput
│   ├── NewTaskButton
│   └── ConversationList → ConversationItem
│
├── MainArea
│   ├── TopBar (52px)
│   │   ├── SidebarToggle
│   │   ├── Title
│   │   ├── ConnectionDot
│   │   ├── ModelBadge
│   │   └── Actions (Theme, Lang, Settings)
│   │
│   ├── Canvas (flex: 1)
│   │   ├── DAGView (empty state / mermaid render)
│   │   ├── AgentProgressBar
│   │   └── AgentCardList
│   │
│   ├── ResizeHandle
│   │
│   ├── ResultStream (collapsible)
│   │   └── MessageList
│   │       ├── UserBubble
│   │       └── AgentBubble
│   │
│   └── InputBar (fixed bottom, 64px)
│       ├── FileUpload
│       ├── TextArea (auto-resize)
│       └── SendButton / StopButton
│
├── AgentDetailPanel (slide-out, 420px)
│   ├── Header (name, status, close)
│   ├── AgentOutput (md render)
│   └── ActivityTimeline (tool calls)
│
├── SettingsModal
└── ToastContainer
```

## State Management

Three separate contexts to avoid unnecessary re-renders:

```typescript
// App-level: persists across conversations
interface AppState {
  conversations: Record<string, ConvMeta>;
  activeConvId: string | null;
}

// Per-conversation: loaded on demand
interface ConversationState {
  messages: Message[];
  agents: Record<string, AgentState>;
  dag: DAGData | null;
  activity: ActivityEntry[];
  running: boolean;
}

// UI-only: never triggers data re-renders
interface UIState {
  theme: 'dark' | 'light';
  lang: 'zh' | 'en';
  sidebarOpen: boolean;
  monitorOpen: boolean;
  settingsOpen: boolean;
  panelAgent: AgentState | null;
  toasts: Toast[];
}
```

SSE connection lifecycle managed via `useEffect` with proper cleanup on unmount.

Agent completion counting handled atomically in the reducer, not reading stale closures.

## Design Tokens

```
Colors (dark tool aesthetic):
--bg-app:        #09090b
--bg-surface:    #131316
--bg-elevated:   #1a1a1f
--border:        #252529
--text-primary:  #fafafa
--text-secondary:#a1a1aa
--text-muted:    #52525b
--accent:        #6366f1 (indigo)
--success:       #22c55e
--warning:       #f59e0b
--danger:        #ef4444

Typography:
--font-sans: 'Inter', -apple-system, sans-serif
--font-mono: 'JetBrains Mono', 'Fira Code', monospace
Sizes: 11, 12, 13, 14, 16, 20, 24px

Spacing: 4px unit scale (4, 8, 12, 16, 24, 32px)
Radius: 6, 8, 12px
```

## API Endpoints (unchanged)

```
GET    /api/conversations
POST   /api/conversations?title=
GET    /api/conversations/:id
DELETE /api/conversations/:id
POST   /run?query=&conv_id=
GET    /stream/:task_id (SSE)
GET    /api/settings
PUT    /api/settings
GET    /api/workspace/:conv_id
GET    /api/workspace/:conv_id/file?path=
POST   /api/upload
POST   /api/sync
```

## Key Interactions

- **Submit task**: input clears, canvas shows loading, DAG fades in
- **DAG node click**: opens AgentDetailPanel from right
- **Agent card hover**: status tooltip (duration, retries)
- **Resize handle**: drag to adjust Canvas/ResultStream ratio
- **Agent completion**: DAG node turns green, result stream appends summary
- **Stop task**: SSE close, canvas dims with current progress preserved
- **Edit rerun**: inline textarea on user message, Ctrl+Enter to submit
