import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/light'
import sql from 'react-syntax-highlighter/dist/esm/languages/hljs/sql'
import python from 'react-syntax-highlighter/dist/esm/languages/hljs/python'
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json'
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash'
import javascript from 'react-syntax-highlighter/dist/esm/languages/hljs/javascript'
import atomOneDark from 'react-syntax-highlighter/dist/esm/styles/hljs/atom-one-dark'

SyntaxHighlighter.registerLanguage('sql', sql)
SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('javascript', javascript)

const SUPPORTED_LANGUAGES = new Set(['sql', 'python', 'json', 'bash', 'javascript'])

interface Props {
  language: string | null
  code: string
}

export default function ChatCodeBlock({ language, code }: Props) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const lang = language && SUPPORTED_LANGUAGES.has(language) ? language : undefined

  return (
    <div className="relative group my-1 rounded overflow-hidden border border-surface-50">
      <button
        onClick={copy}
        className="absolute top-1 right-1 p-1 rounded bg-surface-300/80 hover:bg-surface-300 opacity-0 group-hover:opacity-100 transition-opacity z-10"
        title="Copy code"
      >
        {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-gray-400" />}
      </button>
      <SyntaxHighlighter
        language={lang}
        style={atomOneDark}
        customStyle={{ margin: 0, fontSize: '12px', lineHeight: 1.5, padding: '10px', background: '#000' }}
      >
        {code.replace(/\n$/, '')}
      </SyntaxHighlighter>
    </div>
  )
}
