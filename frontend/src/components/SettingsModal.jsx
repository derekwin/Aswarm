import { useState, useEffect } from 'react'
import { useApp } from '../App'

export default function SettingsModal() {
  const { t } = useApp()
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState('ollama')
  const [cfg, setCfg] = useState({ llm_base_url: '', llm_api_key: '', classifier_model: '', decomposer_model: '', default_model: '' })

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(setCfg).catch(() => {})
  }, [])

  // Expose open function globally
  useEffect(() => { window._openSettings = () => setOpen(true) }, [])

  const save = async () => {
    await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) })
    setOpen(false)
  }

  if (!open) return null

  return (
    <div className="modal open" onClick={e => { if (e.target.className.includes('modal')) setOpen(false) }}>
      <div className="modal-content">
        <div className="modal-header"><h2>{t('settings')}</h2><button className="modal-close" onClick={() => setOpen(false)}>✕</button></div>
        <div className="tab-bar">
          {['ollama','openai','anthropic'].map(p => (
            <button key={p} className={'tab-btn' + (provider===p?' active':'')} onClick={() => setProvider(p)}>{p.charAt(0).toUpperCase()+p.slice(1)}</button>
          ))}
        </div>
        <div className="form-group"><label className="form-label">Base URL</label><input className="form-input" value={cfg.llm_base_url} onChange={e=>setCfg({...cfg,llm_base_url:e.target.value})} /></div>
        {provider !== 'ollama' && <div className="form-group"><label className="form-label">API Key</label><input className="form-input" value={cfg.llm_api_key} onChange={e=>setCfg({...cfg,llm_api_key:e.target.value})} /></div>}
        <div className="form-group"><label className="form-label">Classifier Model</label><input className="form-input" value={cfg.classifier_model} onChange={e=>setCfg({...cfg,classifier_model:e.target.value})} /></div>
        <div className="form-group"><label className="form-label">Decomposer Model</label><input className="form-input" value={cfg.decomposer_model} onChange={e=>setCfg({...cfg,decomposer_model:e.target.value})} /></div>
        <div className="form-group"><label className="form-label">Default Agent Model</label><input className="form-input" value={cfg.default_model} onChange={e=>setCfg({...cfg,default_model:e.target.value})} /></div>
        <button className="form-submit" onClick={save}>{t('save')}</button>
      </div>
    </div>
  )
}
