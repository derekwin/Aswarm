import { useApp } from '../App'
import { useRef, useEffect } from 'react'

export default function ChatArea() {
  const { state, t } = useApp()
  const ref = useRef(null)
  const conv = state.activeConvId ? state.conversations[state.activeConvId] : null

  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [conv?.messages])

  if (!conv || !conv.messages?.length) {
    return (
      <div className="chat-area">
        <div className="empty-state">
          <div className="icon">✦</div>
          <h2>{t('emptyTitle')}</h2>
          <p>{t('emptyDesc')}</p>
          <div className="suggestion-chips">
            <button className="suggestion-chip" onClick={() => {}}>国产芯片市场调研</button>
            <button className="suggestion-chip" onClick={() => {}}>React vs Vue</button>
            <button className="suggestion-chip" onClick={() => {}}>LLM报告</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-area" ref={ref}>
      {conv.messages.map((m, i) => (
        <div key={i} className={'message fade-up ' + (m.role === 'user' ? 'user' : 'assistant')}>
          <div className={'avatar ' + m.role}>{m.role === 'user' ? 'U' : 'S'}</div>
          <div className={'bubble ' + m.role} dangerouslySetInnerHTML={{ __html: renderMd(m.content) }} />
        </div>
      ))}
    </div>
  )
}

function renderMd(text) {
  if (!text) return ''
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g,'<div class="md-codeblock">$2</div>')
    .replace(/\*\*(.+?)\*\*/g,'<span class="md-bold">$1</span>')
    .replace(/`([^`]+)`/g,'<code class="md-code">$1</code>')
    .replace(/\n/g,'<br>')
}
