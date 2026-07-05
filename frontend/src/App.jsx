import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import InputArea from './components/InputArea'
import LiveMonitor from './components/LiveMonitor'
import SettingsModal from './components/SettingsModal'
import CommandPalette from './components/CommandPalette'
import AgentPanel from './components/AgentPanel'
import Toast from './components/Toast'

const AppContext = createContext(null)
export const useApp = () => useContext(AppContext)

const I18N = {
  en: { newTask:'New Task',send:'Send',settings:'Settings',save:'Saved',noConvs:'No conversations',
    searchConv:'Search conversations...',taskPlaceholder:'Describe your task...',
    emptyTitle:'What do you want to research?',emptyDesc:'Describe your task.',
    classifying:'Classifying task',executing:'Executing agents',complete:'Complete',
    loadError:'Connection lost.',deleteConfirm:'Delete this conversation?',
    agents:'agents',groups:'groups' },
  zh: { newTask:'新建任务',send:'发送',settings:'设置',save:'已保存',noConvs:'暂无对话',
    searchConv:'搜索对话...',taskPlaceholder:'描述你的任务...',
    emptyTitle:'想要研究什么？',emptyDesc:'描述你的任务。',
    classifying:'正在分类任务',executing:'正在执行 Agent',complete:'完成',
    loadError:'连接已断开。',deleteConfirm:'确定删除此对话？',
    agents:'个 Agent',groups:'组' },
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_CONVS': return { ...state, conversations: action.payload }
    case 'SET_ACTIVE': return { ...state, activeConvId: action.payload }
    case 'ADD_CONV': return { ...state, conversations: { ...state.conversations, [action.payload.id]: action.payload }, activeConvId: action.payload.id }
    case 'DEL_CONV': { const c = {...state.conversations}; delete c[action.payload]; return { ...state, conversations: c, activeConvId: state.activeConvId===action.payload?null:state.activeConvId } }
    case 'SET_MSGS': return { ...state, conversations: {...state.conversations, [action.payload.id]: {...state.conversations[action.payload.id], messages:action.payload.messages, _loaded:true} }}
    case 'SET_TITLE': return { ...state, conversations: {...state.conversations, [action.payload.id]: {...state.conversations[action.payload.id], title:action.payload.title} }}
    case 'SET_THEME': return { ...state, theme: action.payload }
    case 'SET_LANG': return { ...state, lang: action.payload }
    case 'SET_CONNECTED': return { ...state, connected: action.payload }
    case 'SET_AGENTS': return { ...state, agentStates: action.payload }
    case 'UPDATE_AGENT': return { ...state, agentStates: {...state.agentStates, [action.payload.id]: action.payload.data} }
    case 'RESET_TASK': return { ...state, agentStates:{}, totalAgents:0, completedAgents:0 }
    case 'SET_TASK': return { ...state, totalAgents:action.payload.total, completedAgents:0 }
    case 'INC_COMPLETED': return { ...state, completedAgents: state.completedAgents+1 }
    case 'SET_MONITOR': return { ...state, monitorOpen: action.payload }
    case 'SET_PANEL': return { ...state, panelAgent: action.payload }
    default: return state
  }
}

function initState() {
  return {
    conversations: {}, activeConvId: null, agentStates: {}, totalAgents:0, completedAgents:0,
    theme: localStorage.getItem('theme')==='light'?'light':'dark',
    lang: localStorage.getItem('lang')||'en', connected: false, monitorOpen: false, panelAgent: null,
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, null, initState)
  const eventSourceRef = useRef(null)

  const t = useCallback((key) => (I18N[state.lang]||I18N.en)[key]||key, [state.lang])

  useEffect(() => {
    document.documentElement.className = state.theme
    localStorage.setItem('theme', state.theme)
    fetch('/api/conversations').then(r=>r.json()).then(data => {
      const convs = {}
      data.forEach(c => { convs[c.id] = { title:c.title, messages:[], time:new Date(c.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), _loaded:false } })
      dispatch({type:'SET_CONVS', payload:convs})
    }).catch(()=>{})
  }, [])

  const value = { state, dispatch, t, eventSourceRef }

  return (
    <AppContext.Provider value={value}>
      <div id="app">
        <Sidebar />
        <main className="main">
          <div className="main-header">
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <button className="header-btn hamburger-btn" onClick={()=>{}}>☰</button>
              <h3>{state.activeConvId && state.conversations[state.activeConvId] ? state.conversations[state.activeConvId].title : t('newTask')}</h3>
            </div>
            <div className="header-actions">
              <button className="header-btn" onClick={()=>dispatch({type:'SET_THEME',payload:state.theme==='dark'?'light':'dark'})}>{state.theme==='dark'?'☀️':'🌙'}</button>
              <button className="header-btn" onClick={()=>dispatch({type:'SET_LANG',payload:state.lang==='zh'?'en':'zh'})} style={{fontSize:'0.75rem'}}>{state.lang==='zh'?'EN':'中'}</button>
              <button className="header-btn" onClick={()=>dispatch({type:'SET_MONITOR',payload:!state.monitorOpen})}>◫</button>
              <span className={'conn-dot '+(state.connected?'on':'off')} />
              <span className="model-badge">qwen3.5:35b</span>
            </div>
          </div>
          <ChatArea />
          <InputArea />
        </main>
        {state.monitorOpen && <LiveMonitor />}
      </div>
      <SettingsModal />
      <CommandPalette />
      <AgentPanel />
      <Toast />
    </AppContext.Provider>
  )
}
