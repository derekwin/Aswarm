import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import InputArea from './components/InputArea'
import LiveMonitor from './components/LiveMonitor'

const AppContext = createContext(null)
export const useApp = () => useContext(AppContext)

const I18N = {
  en: { newTask:'New Task',send:'Send',settings:'Settings',save:'Saved',noConvs:'No conversations',
    searchConv:'Search conversations...',taskPlaceholder:'Describe your task...',
    emptyTitle:'What do you want to research?',emptyDesc:'Describe your task.',
    classifying:'Classifying task',executing:'Executing agents',complete:'Complete',
    loadError:'Connection lost.',deleteConfirm:'Delete this conversation?',
    agents:'agents',groups:'groups',retries:'Retries' },
  zh: { newTask:'新建任务',send:'发送',settings:'设置',save:'已保存',noConvs:'暂无对话',
    searchConv:'搜索对话...',taskPlaceholder:'描述你的任务...',
    emptyTitle:'想要研究什么？',emptyDesc:'描述你的任务。',
    classifying:'正在分类任务',executing:'正在执行 Agent',complete:'完成',
    loadError:'连接已断开。',deleteConfirm:'确定删除此对话？',
    agents:'个 Agent',groups:'组',retries:'次重试' },
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_CONVS': return { ...state, conversations: action.payload }
    case 'SET_ACTIVE': return { ...state, activeConvId: action.payload }
    case 'ADD_CONV': return { ...state, conversations: { ...state.conversations, [action.payload.id]: action.payload }, activeConvId: action.payload.id }
    case 'DEL_CONV': { const c={...state.conversations}; delete c[action.payload]; return {...state, conversations:c, activeConvId:state.activeConvId===action.payload?null:state.activeConvId} }
    case 'APPEND_MSG': {
      const convs = {...state.conversations}
      const c = convs[action.payload.id]
      convs[action.payload.id] = {...c, messages:[...(c.messages||[]), action.payload.msg]}
      return {...state, conversations:convs}
    }
    case 'UPDATE_LAST_MSG': {
      const convs = {...state.conversations}
      const c = convs[action.payload.id]
      const msgs = [...(c.messages||[])]
      if (msgs.length) msgs[msgs.length-1] = {...msgs[msgs.length-1], ...action.payload.updates}
      convs[action.payload.id] = {...c, messages:msgs}
      return {...state, conversations:convs}
    }
    case 'SET_MSGS': return { ...state, conversations: {...state.conversations, [action.payload.id]: {...state.conversations[action.payload.id], messages:action.payload.messages, _loaded:true} }}
    case 'SET_TITLE': return { ...state, conversations: {...state.conversations, [action.payload.id]: {...state.conversations[action.payload.id], title:action.payload.title} }}
    case 'SET_CONV_META': return { ...state, conversations: {...state.conversations, [action.payload.id]: {...state.conversations[action.payload.id], ...action.payload.meta} }}
    case 'APPEND_ACTIVITY': {
      const convs = {...state.conversations}
      const c = convs[action.payload.convId]
      convs[action.payload.convId] = {...c, activity: [...(c.activity||[]), action.payload.entry].slice(-50)}
      return {...state, conversations:convs}
    }
    case 'UPDATE_AGENT': {
      const convs = {...state.conversations}
      const c = convs[action.payload.convId]
      convs[action.payload.convId] = {...c, agents:{...(c.agents||{}), [action.payload.id]: {...(c.agents?.[action.payload.id]||{}), ...action.payload.data}}}
      return {...state, conversations:convs}
    }
    case 'SET_THEME': return { ...state, theme: action.payload }
    case 'SET_LANG': return { ...state, lang: action.payload }
    case 'SET_CONNECTED': return { ...state, connected: action.payload }
    case 'SET_MONITOR': return { ...state, monitorOpen: action.payload }
    case 'SET_MONITOR_WIDTH': return { ...state, monitorWidth: action.payload }
    case 'SET_SIDEBAR_OPEN': return { ...state, sidebarOpen: action.payload }
    case 'SET_PANEL': return { ...state, panelAgent: action.payload }
    case 'SET_SETTINGS_OPEN': return { ...state, settingsOpen: action.payload }
    case 'ADD_TOAST': return { ...state, toasts: [...state.toasts, {id:Date.now(),msg:action.payload}] }
    case 'REMOVE_TOAST': return { ...state, toasts: state.toasts.filter(t=>t.id!==action.payload) }
    default: return state
  }
}

function initState() {
  return {
    conversations:{}, activeConvId:null,
    theme:localStorage.getItem('theme')==='light'?'light':'dark',
    lang:localStorage.getItem('lang')||'en', connected:false, monitorOpen:false,
    monitorWidth: parseInt(localStorage.getItem('monitorWidth')) || 480,
    panelAgent:null, settingsOpen:false, sidebarOpen:false, toasts:[],
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, null, initState)
  const eventSourceRef = useRef(null)
  const t = useCallback((key)=>(I18N[state.lang]||I18N.en)[key]||key, [state.lang])

  useEffect(()=>{
    document.documentElement.className = state.theme
    localStorage.setItem('theme', state.theme)
  },[state.theme])
  useEffect(()=>{ localStorage.setItem('lang', state.lang) },[state.lang])
  useEffect(()=>{
    fetch('/api/conversations').then(r=>r.json()).then(data=>{
      const convs={}
      data.forEach(c=>{convs[c.id]={title:c.title,messages:[],time:new Date(c.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),_loaded:false,agents:{},totalAgents:0,completedAgents:0}})
      dispatch({type:'SET_CONVS',payload:convs})
    }).catch(()=>{})
  },[])

  useEffect(()=>{
    const h = e => {
      if ((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();document.getElementById('queryInput')?.focus()}
      if (e.key==='Escape'){dispatch({type:'SET_PANEL',payload:null})}
    }
    window.addEventListener('keydown',h)
    return ()=>window.removeEventListener('keydown',h)
  },[])

  // Shared task runner — called by both InputArea and ChatArea edit
  const runTask = useCallback(async (convId, query) => {
    dispatch({ type: 'APPEND_MSG', payload: { id: convId, msg: { role: 'user', content: query } } })
    dispatch({ type: 'APPEND_MSG', payload: { id: convId, msg: { role: 'assistant', content: 'Analyzing task...', typing: true } } })
    try {
      const r = await fetch('/run?query=' + encodeURIComponent(query) + '&conv_id=' + encodeURIComponent(convId), { method: 'POST' })
      const { task_id } = await r.json()
      if (eventSourceRef.current) eventSourceRef.current.close()
      dispatch({ type: 'SET_CONNECTED', payload: true })
      dispatch({ type: 'SET_CONV_META', payload: { id: convId, meta: { running: true } } })
      dispatch({ type: 'SET_MONITOR', payload: true })  // auto-open monitor

      eventSourceRef.current = new EventSource('/stream/' + task_id)
      eventSourceRef.current.onmessage = (e) => {
        const d = JSON.parse(e.data)
        switch (d.type) {
          case 'status':
            dispatch({ type: 'UPDATE_LAST_MSG', payload: { id: convId, updates: { content: d.msg } } })
            break
          case 'dag':
            dispatch({ type: 'SET_CONV_META', payload: { id: convId, meta: { totalAgents: d.subtasks.length, completedAgents: 0, agents: {}, dag: d } } })
            dispatch({ type: 'UPDATE_LAST_MSG', payload: { id: convId, updates: { content: 'Decomposed into ' + d.subtasks.length + ' agents.' } } })
            break
          case 'agent_start':
            dispatch({ type: 'UPDATE_AGENT', payload: { convId, id: d.subtask_id, data: { state: 'running', name: d.agent_name, role: d.role } } })
            break
          case 'agent_done':
            dispatch({ type: 'UPDATE_AGENT', payload: { convId, id: d.subtask_id, data: { state: d.state, output: d.output, error: d.error, retry: d.retry_count } } })
            if (d.state === 'completed' || d.state === 'failed') {
              const c = state.conversations[convId]
              dispatch({ type: 'SET_CONV_META', payload: { id: convId, meta: { completedAgents: (c.completedAgents||0) + 1 } } })
            }
            break
          case 'tool_call':
            dispatch({ type: 'APPEND_ACTIVITY', payload: { convId, entry: { agent: d.agent_name, tool: d.tool, args: d.args, time: Date.now() } } })
            break
          case 'done':
            dispatch({ type: 'SET_CONNECTED', payload: false })
            dispatch({ type: 'UPDATE_LAST_MSG', payload: { id: convId, updates: { content: d.summary || 'Complete', typing: false } } })
            dispatch({ type: 'SET_CONV_META', payload: { id: convId, meta: { running: false } } })
            if (eventSourceRef.current) eventSourceRef.current.close()
            dispatch({ type: 'ADD_TOAST', payload: '✓ ' + t('complete') })
            break
          case 'error':
            dispatch({ type: 'SET_CONNECTED', payload: false })
            dispatch({ type: 'UPDATE_LAST_MSG', payload: { id: convId, updates: { content: 'Error: ' + d.msg, typing: false } } })
            dispatch({ type: 'SET_CONV_META', payload: { id: convId, meta: { running: false } } })
            break
        }
      }
      eventSourceRef.current.onerror = () => {
        dispatch({ type: 'SET_CONNECTED', payload: false })
        dispatch({ type: 'SET_CONV_META', payload: { id: convId, meta: { running: false } } })
      }
    } catch (e) {
      dispatch({ type: 'SET_CONNECTED', payload: false })
      dispatch({ type: 'UPDATE_LAST_MSG', payload: { id: convId, updates: { content: t('loadError'), typing: false } } })
    }
  }, [t, eventSourceRef, state.conversations])

  const cancelTask = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    dispatch({ type: 'SET_CONNECTED', payload: false })
    if (state.activeConvId) {
      dispatch({ type: 'SET_CONV_META', payload: { id: state.activeConvId, meta: { running: false } } })
      dispatch({ type: 'UPDATE_LAST_MSG', payload: { id: state.activeConvId, updates: { content: 'Task cancelled by user.', typing: false } } })
    }
  }, [state.activeConvId])

  const setMonitorWidth = useCallback((w) => {
    const clamped = Math.max(360, Math.min(640, w))
    dispatch({ type: 'SET_MONITOR_WIDTH', payload: clamped })
    localStorage.setItem('monitorWidth', clamped)
  }, [])

  const value = { state, dispatch, t, eventSourceRef, runTask, cancelTask, setMonitorWidth }

  return (
    <AppContext.Provider value={value}>
      <div id="app">
        <Sidebar />
        <main className="main">
          <div className="main-header">
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <button className="header-btn hamburger-btn" onClick={()=>dispatch({type:'SET_SIDEBAR_OPEN',payload:!state.sidebarOpen})}>☰</button>
              <h3>{state.activeConvId&&state.conversations[state.activeConvId]?state.conversations[state.activeConvId].title:t('newTask')}</h3>
            </div>
            <div className="header-actions">
              <button className="header-btn" onClick={()=>dispatch({type:'SET_THEME',payload:state.theme==='dark'?'light':'dark'})}>{state.theme==='dark'?'☀️':'🌙'}</button>
              <button className="header-btn" onClick={()=>dispatch({type:'SET_LANG',payload:state.lang==='zh'?'en':'zh'})} style={{fontSize:'0.75rem'}}>{state.lang==='zh'?'EN':'中'}</button>
              <button className="header-btn" onClick={()=>dispatch({type:'SET_SETTINGS_OPEN',payload:true})}>⚙</button>
              <span className={'conn-dot '+(state.connected?'on':'off')} />
              <span className="model-badge">qwen3.5:35b</span>
            </div>
          </div>
          <ChatArea />
          <InputArea />
        </main>
        {state.monitorOpen && <LiveMonitor />}
      </div>
      {state.settingsOpen && <SettingsModal />}
      <AgentPanel />
      <ToastContainer />
    </AppContext.Provider>
  )
}

function SettingsModal() {
  const { state, dispatch, t } = useApp()
  const [provider, setProvider] = React.useState('ollama')
  const [cfg, setCfg] = React.useState({ llm_base_url:'',llm_api_key:'',classifier_model:'',decomposer_model:'',default_model:'' })
  React.useEffect(()=>{fetch('/api/settings').then(r=>r.json()).then(setCfg).catch(()=>{})},[])
  const save = async () => { await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});dispatch({type:'SET_SETTINGS_OPEN',payload:false});dispatch({type:'ADD_TOAST',payload:'✓ '+t('save')}) }
  return (
    <div className="modal open" onClick={e=>{if(e.target===e.currentTarget)dispatch({type:'SET_SETTINGS_OPEN',payload:false})}}>
      <div className="modal-content">
        <div className="modal-header"><h2>{t('settings')}</h2><button className="modal-close" onClick={()=>dispatch({type:'SET_SETTINGS_OPEN',payload:false})}>✕</button></div>
        <div className="tab-bar">{['ollama','openai','anthropic'].map(p=><button key={p} className={'tab-btn'+(provider===p?' active':'')} onClick={()=>setProvider(p)}>{p.charAt(0).toUpperCase()+p.slice(1)}</button>)}</div>
        <div className="form-group"><label className="form-label">Base URL</label><input className="form-input" value={cfg.llm_base_url} onChange={e=>setCfg({...cfg,llm_base_url:e.target.value})} /></div>
        {provider!=='ollama'&&<div className="form-group"><label className="form-label">API Key</label><input className="form-input" value={cfg.llm_api_key} onChange={e=>setCfg({...cfg,llm_api_key:e.target.value})} /></div>}
        <div className="form-group"><label className="form-label">Classifier Model</label><input className="form-input" value={cfg.classifier_model} onChange={e=>setCfg({...cfg,classifier_model:e.target.value})} /></div>
        <div className="form-group"><label className="form-label">Decomposer Model</label><input className="form-input" value={cfg.decomposer_model} onChange={e=>setCfg({...cfg,decomposer_model:e.target.value})} /></div>
        <div className="form-group"><label className="form-label">Default Agent Model</label><input className="form-input" value={cfg.default_model} onChange={e=>setCfg({...cfg,default_model:e.target.value})} /></div>
        <button className="form-submit" onClick={save}>{t('save')}</button>
      </div>
    </div>
  )
}

function AgentPanel() {
  const { state, dispatch, t } = useApp()
  if (!state.panelAgent) return null
  const a = state.panelAgent
  return (
    <div className="agent-panel open">
      <div className="agent-panel-header"><h3>{a.name}</h3><button className="agent-panel-close" onClick={()=>dispatch({type:'SET_PANEL',payload:null})}>✕</button></div>
      <div className="agent-panel-content" dangerouslySetInnerHTML={{__html: renderMd((a.output||'')+(a.error?'\n[ERROR: '+a.error+']':'')+(a.retry?'\n'+t('retries')+': '+a.retry:''))}} />
    </div>
  )
}

function ToastContainer() {
  const { state, dispatch } = useApp()
  return (
    <div className="toast-container">
      {state.toasts.map(t=>{setTimeout(()=>dispatch({type:'REMOVE_TOAST',payload:t.id}),3500);return <div key={t.id} className="toast">{t.msg}</div>})}
    </div>
  )
}

function renderMd(text) {
  if (!text) return ''
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g,'<div class="md-codeblock">$2</div>')
    .replace(/\*\*(.+?)\*\*/g,'<span class="md-bold">$1</span>')
    .replace(/`([^`]+)`/g,'<code class="md-code">$1</code>')
    .replace(/\n/g,'<br>')
}
