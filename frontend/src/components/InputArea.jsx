import { useState, useRef } from 'react'
import { useApp } from '../App'

export default function InputArea() {
  const { state, dispatch, t, runTask, cancelTask } = useApp()
  const [query, setQuery] = useState('')
  const [sending, setSending] = useState(false)
  const taRef = useRef(null)

  const conv = state.activeConvId ? state.conversations[state.activeConvId] : null
  const isRunning = conv?.running

  const autoResize = () => { const el=taRef.current; if(!el)return; el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,140)+'px' }

  const handleFile = async (e) => {
    const file=e.target.files[0]; if(!file)return; setSending(true)
    const fd=new FormData(); fd.append('file',file)
    try{ const r=await fetch('/api/upload',{method:'POST',body:fd}); const d=await r.json()
      if(d.content){ setQuery(q=>q+'\n\n--- File: '+d.filename+' ---\n'+d.content.slice(0,8000)); setTimeout(autoResize,50) }
      else if(d.error) dispatch({type:'ADD_TOAST',payload:'Upload failed: '+d.error}) }
    catch(e){ dispatch({type:'ADD_TOAST',payload:'Upload failed'}) }
    setSending(false); e.target.value=''
  }

  const submit = async () => {
    const q=query.trim(); if(!q||sending)return; setSending(true);setQuery('')
    let convId=state.activeConvId
    if(!convId){ const r=await fetch('/api/conversations?title=New+Task',{method:'POST'}); const c=await r.json()
      dispatch({type:'ADD_CONV',payload:{id:c.id,title:'New Task',messages:[],time:new Date(c.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),_loaded:true,agents:{},totalAgents:0,completedAgents:0}})
      convId=c.id }
    if(state.conversations[convId]?.title==='New Task') dispatch({type:'SET_TITLE',payload:{id:convId,title:q.slice(0,40)}})
    await runTask(convId,q); setSending(false)
  }

  return (
    <div className="input-area"><div className="input-wrapper">
      <label className="upload-btn" title="Upload file"><input type="file" accept=".pdf,.txt,.md,.py,.json,.csv" onChange={handleFile} style={{display:'none'}}/>📎</label>
      <textarea id="queryInput" ref={taRef} value={query} onChange={e=>{setQuery(e.target.value);autoResize()}} onInput={autoResize} placeholder={t('taskPlaceholder')} rows={1}
        onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit()}}}/>
      {isRunning ? (
        <button className="stop-btn" onClick={cancelTask}>{t('stop')}</button>
      ) : (
        <button onClick={submit} disabled={sending}>{t('send')}</button>
      )}
    </div></div>
  )
}
