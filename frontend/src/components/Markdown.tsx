import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(code).catch(() => {});
  };

  return (
    <div className="md-codeblock-wrapper my-2 group">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-[10px] text-text-muted font-mono uppercase">{lang || 'code'}</span>
        <button className="text-[10px] text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity" onClick={handleCopy}>
          Copy
        </button>
      </div>
      <pre className="md-codeblock">{code}</pre>
    </div>
  );
}

const components: Components = {
  code({ className, children }) {
    const match = /language-(\w+)/.exec(className || '');
    // Inline code: no language class
    if (!match) {
      return <code className="md-code">{children}</code>;
    }
    const lang = match[1];
    let code = String(children).replace(/\n$/, '');
    
    if (lang === 'json' || (!lang && code.trim().startsWith('{') && code.trim().endsWith('}'))) {
      try {
        JSON.parse(code.trim());
        code = JSON.stringify(JSON.parse(code.trim()), null, 2);
      } catch { /* not valid JSON */ }
    }
    
    return (
      <CodeBlock lang={lang} code={code} />
    );
  },
  pre({ children }) {
    return <>{children}</>;
  },
  table({ children }) {
    return <table className="w-full my-2 border-collapse text-sm">{children}</table>;
  },
  th({ children }) {
    return <th className="px-3 py-1.5 text-xs font-semibold text-text-primary border-b border-border-subtle text-left">{children}</th>;
  },
  td({ children }) {
    return <td className="px-3 py-1.5 text-xs text-text-secondary border-b border-border-subtle">{children}</td>;
  },
  a({ href, children }) {
    return <a href={href} className="text-accent underline hover:brightness-125" target="_blank" rel="noopener">{children}</a>;
  },
  hr() {
    return <hr className="border-border-subtle my-3" />;
  },
  ul({ children }) {
    return <ul className="ml-4 my-2 space-y-1 list-disc text-text-secondary text-sm">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="ml-4 my-2 space-y-1 list-decimal text-text-secondary text-sm">{children}</ol>;
  },
  h1({ children }) {
    return <h1 className="text-lg font-bold text-text-primary mt-4 mb-2">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-base font-semibold text-text-primary mt-3 mb-1.5">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-sm font-semibold text-text-primary mt-2 mb-1">{children}</h3>;
  },
  blockquote({ children }) {
    return <blockquote className="border-l-2 border-accent pl-3 my-2 text-text-secondary italic">{children}</blockquote>;
  },
};

interface Props {
  content: string;
  className?: string;
}

export default function Markdown({ content, className = '' }: Props) {
  if (!content || typeof content !== 'string') return null;
  return (
    <div className={`text-sm leading-relaxed text-inherit ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
