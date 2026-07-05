import { useState, useEffect } from 'react'

export default function DAGView({ data }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    if (!data) return
    const render = () => {
      try {
        let mm = 'graph LR\n'
        const colors = ['#6c5ce7', '#00d26a', '#f5a623', '#f93a3a'];
        (data.parallel_groups || []).forEach((g, gi) => {
          mm += `  subgraph G${gi + 1}[Group ${gi + 1}]\n    style G${gi + 1} fill:#1e1e24,stroke:${colors[gi % 4]}\n`;
          (g || []).forEach(tid => {
            const s = (data.subtasks || []).find(x => x.id === tid) || {}
            const name = String(s.name || tid).replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 18) || 'Agent'
            mm += `    ${tid}["${name}"]\n`
          })
          mm += '  end\n'
        });
        (data.subtasks || []).forEach(s => (s.depends_on || []).forEach(d => mm += `  ${d} --> ${s.id}\n`))
        if (window.mermaid) window.mermaid.render('dag-' + Date.now(), mm).then(r => setSvg(r.svg))
      } catch (e) { }
    }
    if (!window.mermaid) {
      const s = document.createElement('script'); s.src = '/static/mermaid.min.js'
      s.onload = () => { window.mermaid?.initialize({ startOnLoad: true, theme: 'dark' }); render() }
      document.head.appendChild(s)
    } else render()
  }, [data])
  return svg ? <div className="dag-container" dangerouslySetInnerHTML={{ __html: svg }} /> : null
}
