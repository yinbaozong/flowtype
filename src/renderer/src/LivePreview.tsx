import { useEffect, useRef, useState } from 'react'

export function LivePreview(): React.JSX.Element {
  const [state, setState] = useState({ text: '', draft: '', phase: 'connecting', error: '', canRetry: false })
  const [english, setEnglish] = useState(false)
  const paragraph = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    void window.flowApi.getState().then(value => setEnglish(value.settings.uiLanguage === 'en'))
    return window.flowApi.onLive(value => setState({ ...value, error: value.error || '' }))
  }, [])
  useEffect(() => window.flowApi.onState(value => setEnglish(value.settings.uiLanguage === 'en')), [])
  useEffect(() => { if (paragraph.current) paragraph.current.scrollTop = paragraph.current.scrollHeight }, [state.text, state.draft])
  const labels: Record<string, string> = english
    ? { connecting: 'Connecting', listening: 'Listening', finishing: 'Finishing', failed: 'Recognition interrupted', done: 'Saved' }
    : { connecting: '连接中', listening: '正在聆听', finishing: '正在收尾', failed: '识别中断', done: '已保存' }
  return <div className="live-preview">
    <header><span className="status-dot" />{labels[state.phase]}</header>
    <p ref={paragraph}><span>{state.text.slice(-160)}</span><span className="live-preview__draft">{state.draft}</span></p>
    {state.error ? <small>{state.error}</small> : null}
    {state.phase === 'failed' ? <footer>
      {state.canRetry ? <button onClick={() => void window.flowApi.retryLive()}>{english ? 'Retry once' : '重试一次'}</button> : null}
      <button onClick={() => void window.flowApi.dismissLive()}>{english ? 'Dismiss' : '放弃'}</button>
    </footer> : null}
  </div>
}
