import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './theme.css'
import './index.css'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:40,fontFamily:'monospace',color:'#f93a3a',background:'#0d0d0d',height:'100vh'}}>
          <h2>Error</h2>
          <pre style={{whiteSpace:'pre-wrap',fontSize:'0.85rem',marginTop:16}}>{this.state.error.message}</pre>
          <pre style={{whiteSpace:'pre-wrap',fontSize:'0.75rem',color:'#999',marginTop:8}}>{this.state.error.stack?.slice(0,500)}</pre>
          <button onClick={()=>this.setState({error:null})} style={{marginTop:16,padding:'8px 16px',background:'var(--accent)',color:'#fff',border:'none',borderRadius:8,cursor:'pointer'}}>Retry</button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>
)
