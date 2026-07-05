import { useEffect, useMemo, useState } from 'react'
import {
  BookOpenText,
  Check,
  ChevronRight,
  Clipboard,
  Clock3,
  Command,
  Copy,
  Gauge,
  History,
  Keyboard,
  Languages,
  Mic2,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import type { AppPage, AppSettings, AppState, HistoryItem, Provider } from '../../shared/types'

const emptyState: AppState = {
  settings: {
    provider: 'demo',
    language: 'auto',
    shortcut: 'Super+Space',
    overlayX: null,
    overlayY: null,
    overlayWidth: 64,
    launchAtStartup: true,
    qwenApiKey: '',
    volcanoApiKey: '',
    volcanoAppId: '',
    volcanoAccessKey: '',
    dictionary: [],
    hasQwenApiKey: false,
    hasVolcanoApiKey: false
  },
  history: [],
  recording: false,
  shortcutReady: false
}

const nav: Array<{ id: AppPage; label: string; icon: typeof Gauge }> = [
  { id: 'overview', label: '概览', icon: Gauge },
  { id: 'history', label: '历史记录', icon: History },
  { id: 'dictionary', label: '词典', icon: BookOpenText },
  { id: 'settings', label: '设置', icon: Settings }
]

const providerNames: Record<Provider, string> = {
  demo: '演示模式',
  qwen: '千问 Qwen3-ASR',
  volcano: '火山大模型'
}

function formatShortcut(shortcut: string): string {
  return shortcut.replaceAll('Control', 'Ctrl').replaceAll('Super', 'Win')
}

function shortcutFromEvent(event: React.KeyboardEvent<HTMLInputElement>): string | null {
  const modifiers: string[] = []
  if (event.ctrlKey) modifiers.push('Control')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Super')

  const modifierCodes = new Set(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'])
  if (modifierCodes.has(event.code)) {
    return event.altKey && event.metaKey ? 'Alt+Super' : null
  }
  if (!modifiers.length) return null

  const key =
    event.code === 'Space'
      ? 'Space'
      : event.code.startsWith('Arrow')
        ? event.code.slice(5)
      : event.code.startsWith('Key')
        ? event.code.slice(3)
        : event.code.startsWith('Digit')
          ? event.code.slice(5)
          : event.key.length === 1
            ? event.key.toUpperCase()
            : event.key
  return [...modifiers, key].join('+')
}

function formatDuration(durationMs: number): string {
  if (durationMs < 60_000) return `${Math.max(1, Math.round(durationMs / 1000))} 秒`
  return `${Math.round(durationMs / 60_000)} 分钟`
}

function isToday(date: string): boolean {
  const value = new Date(date)
  const now = new Date()
  return value.toDateString() === now.toDateString()
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function HistoryRow({
  item,
  onDelete
}: {
  item: HistoryItem
  onDelete: (id: string) => void
}): React.JSX.Element {
  return (
    <article className="history-row">
      <div className={`history-row__mark ${item.status === 'error' ? 'history-row__mark--error' : ''}`}>
        {item.status === 'error' ? <X size={16} /> : <Mic2 size={16} />}
      </div>
      <div className="history-row__main">
        <p>{item.status === 'error' ? item.error : item.text}</p>
        <div className="history-row__meta">
          <span>{new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
          <span>{formatDuration(item.durationMs)}</span>
          <span>{providerNames[item.provider]}</span>
        </div>
      </div>
      {item.status === 'success' ? (
        <button className="icon-button" title="复制" onClick={() => window.flowApi.copyText(item.text)}>
          <Copy size={16} />
        </button>
      ) : null}
      <button className="icon-button icon-button--danger" title="删除" onClick={() => onDelete(item.id)}>
        <Trash2 size={16} />
      </button>
    </article>
  )
}

function StatChart({ history }: { history: HistoryItem[] }): React.JSX.Element {
  const days = useMemo(() => {
    const result: Array<{ label: string; value: number; today: boolean }> = []
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date()
      date.setDate(date.getDate() - offset)
      const value = history
        .filter((item) => dayKey(new Date(item.createdAt)) === dayKey(date) && item.status === 'success')
        .reduce((sum, item) => sum + item.durationMs / 60_000, 0)
      result.push({
        label: offset === 0 ? '今天' : date.toLocaleDateString('zh-CN', { weekday: 'short' }).replace('周', ''),
        value,
        today: offset === 0
      })
    }
    return result
  }, [history])
  const max = Math.max(...days.map((item) => item.value), 1)

  return (
    <div className="chart">
      {days.map((day) => (
        <div className="chart__day" key={day.label}>
          <div className="chart__track">
            <span
              className={day.today ? 'chart__bar chart__bar--today' : 'chart__bar'}
              style={{ height: `${Math.max(day.value ? 12 : 3, (day.value / max) * 100)}%` }}
            />
          </div>
          <small>{day.label}</small>
        </div>
      ))}
    </div>
  )
}

function Overview({
  state,
  setPage
}: {
  state: AppState
  setPage: (page: AppPage) => void
}): React.JSX.Element {
  const today = state.history.filter((item) => isToday(item.createdAt) && item.status === 'success')
  const minutes = today.reduce((sum, item) => sum + item.durationMs, 0) / 60_000
  const words = today.reduce((sum, item) => sum + item.text.replace(/\s/g, '').length, 0)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="date-label">
            {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
          </p>
          <h1>今天，说出来就好。</h1>
        </div>
        <button className="record-button" onClick={() => window.flowApi.toggleRecording()}>
          <Mic2 size={17} />
          {state.recording ? '结束识别' : '开始识别'}
          <kbd>{formatShortcut(state.settings.shortcut)}</kbd>
        </button>
      </header>

      <section className="daily-summary">
        <div className="daily-summary__lead">
          <span>今天的语音输入</span>
          <strong>{minutes < 1 ? minutes.toFixed(1) : Math.round(minutes)}</strong>
          <em>分钟</em>
          <p>共输入 {words.toLocaleString()} 个字</p>
        </div>
        <StatChart history={state.history} />
      </section>

      <section className="quick-strip">
        <button onClick={() => setPage('settings')}>
          <span className="quick-strip__icon"><Keyboard size={18} /></span>
          <span><strong>{formatShortcut(state.settings.shortcut)}</strong><small>全局快捷键</small></span>
          <ChevronRight size={16} />
        </button>
        <button onClick={() => setPage('settings')}>
          <span className="quick-strip__icon"><Sparkles size={18} /></span>
          <span><strong>{providerNames[state.settings.provider]}</strong><small>识别服务</small></span>
          <ChevronRight size={16} />
        </button>
        <button onClick={() => setPage('settings')}>
          <span className="quick-strip__icon"><Languages size={18} /></span>
          <span><strong>{state.settings.language === 'auto' ? '自动检测' : state.settings.language}</strong><small>识别语言</small></span>
          <ChevronRight size={16} />
        </button>
      </section>

      <section className="section-block">
        <div className="section-title">
          <div>
            <h2>最近识别</h2>
            <p>你的语音记录只保存在本机。</p>
          </div>
          <button className="text-button" onClick={() => setPage('history')}>查看全部 <ChevronRight size={15} /></button>
        </div>
        <div className="history-list">
          {state.history.length ? (
            state.history.slice(0, 5).map((item) => (
              <HistoryRow item={item} key={item.id} onDelete={(id) => window.flowApi.deleteHistory(id)} />
            ))
          ) : (
            <div className="empty">
              <div><Mic2 size={20} /></div>
              <h3>还没有识别记录</h3>
              <p>按下 {formatShortcut(state.settings.shortcut)}，开始第一次语音输入。</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function HistoryPage({ state }: { state: AppState }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const filtered = state.history.filter((item) =>
    `${item.text} ${item.error ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  )
  return (
    <div className="page">
      <header className="page-header">
        <div><p className="date-label">本机记录</p><h1>历史记录</h1></div>
        {state.history.length ? <button className="secondary-button" onClick={() => window.flowApi.clearHistory()}><Trash2 size={16} /> 清空记录</button> : null}
      </header>
      <div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索识别内容" /></div>
      <section className="section-block history-page-list">
        {filtered.length ? filtered.map((item) => <HistoryRow item={item} key={item.id} onDelete={(id) => window.flowApi.deleteHistory(id)} />) : <div className="empty"><div><Clock3 size={20} /></div><h3>没有找到记录</h3><p>新的语音识别会出现在这里。</p></div>}
      </section>
    </div>
  )
}

function DictionaryPage({
  settings,
  onSave
}: {
  settings: AppSettings
  onSave: (settings: AppSettings) => Promise<void>
}): React.JSX.Element {
  const [word, setWord] = useState('')
  const addWord = (): void => {
    const next = word.trim()
    if (!next || settings.dictionary.includes(next)) return
    onSave({ ...settings, dictionary: [...settings.dictionary, next] })
    setWord('')
  }
  return (
    <div className="page">
      <header className="page-header"><div><p className="date-label">专有词汇</p><h1>个人词典</h1><p className="page-subtitle">添加人名、产品名和专业术语，提高识别准确率。</p></div></header>
      <div className="dictionary-add"><input value={word} onChange={(event) => setWord(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addWord()} placeholder="例如：MakerWorld" /><button className="primary-button" onClick={addWord}><Plus size={17} /> 添加词汇</button></div>
      <section className="section-block">
        <div className="word-list">
          {settings.dictionary.length ? settings.dictionary.map((item) => <div className="word-row" key={item}><span>{item}</span><button className="icon-button icon-button--danger" onClick={() => onSave({ ...settings, dictionary: settings.dictionary.filter((wordValue) => wordValue !== item) })}><X size={16} /></button></div>) : <div className="empty"><div><BookOpenText size={20} /></div><h3>词典还是空的</h3><p>添加你经常使用，但容易被识别错的词。</p></div>}
        </div>
      </section>
    </div>
  )
}

function SettingsPage({
  settings,
  onSave
}: {
  settings: AppSettings & { hasQwenApiKey?: boolean; hasVolcanoApiKey?: boolean }
  onSave: (settings: AppSettings) => Promise<void>
}): React.JSX.Element {
  const [draft, setDraft] = useState(settings)
  const [notice, setNotice] = useState('')
  const [testing, setTesting] = useState(false)
  const [capturingShortcut, setCapturingShortcut] = useState(false)
  const applyShortcut = (shortcut: string): void => {
    const next = { ...draft, shortcut }
    setDraft(next)
    setNotice('正在应用快捷键…')
    void onSave(next)
      .then(() => setNotice(`快捷键已生效：${formatShortcut(shortcut)}`))
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : '快捷键注册失败'))
  }
  useEffect(() => setDraft(settings), [settings])
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => setDraft((current) => ({ ...current, [key]: value }))
  const save = async (): Promise<void> => {
    setNotice('正在保存…')
    try {
      await onSave(draft)
      setNotice('设置已保存')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存失败')
    }
  }
  const testProvider = async (): Promise<void> => {
    setTesting(true)
    setNotice('正在验证 API Key…')
    try {
      await onSave(draft)
      const result = await window.flowApi.testProvider()
      setNotice(result.message)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '连接测试失败')
    } finally {
      setTesting(false)
    }
  }
  return (
    <div className="page">
      <header className="page-header"><div><p className="date-label">偏好设置</p><h1>设置</h1>{notice ? <p className="settings-notice">{notice}</p> : null}</div><button className="primary-button" onClick={() => void save()}><Check size={17} /> 保存设置</button></header>
      <section className="settings-group">
        <div className="settings-group__title"><h2>识别设置</h2><p>选择服务、语言和启动快捷键。</p></div>
        <div className="settings-fields">
          <label><span>识别服务</span><select value={draft.provider} onChange={(event) => update('provider', event.target.value as Provider)}><option value="demo">演示模式</option><option value="qwen">千问 Qwen3-ASR</option><option value="volcano">火山大模型</option></select></label>
          <label><span>识别语言</span><select value={draft.language} onChange={(event) => update('language', event.target.value as AppSettings['language'])}><option value="auto">自动检测</option><option value="zh">中文</option><option value="en">英文</option><option value="ja">日语</option><option value="yue">粤语</option></select></label>
          <label>
            <span>全局快捷键</span>
            <input
              className="shortcut-capture"
              readOnly
              value={capturingShortcut ? '请按下新的组合键…' : formatShortcut(draft.shortcut)}
              onFocus={() => setCapturingShortcut(true)}
              onBlur={() => setCapturingShortcut(false)}
              onKeyDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const shortcut = shortcutFromEvent(event)
                if (!shortcut) return
                const next = { ...draft, shortcut }
                setDraft(next)
                setCapturingShortcut(false)
                event.currentTarget.blur()
                setNotice('正在应用快捷键…')
                void onSave(next)
                  .then(() => setNotice('快捷键已生效'))
                  .catch((error: unknown) => setNotice(error instanceof Error ? error.message : '快捷键注册失败'))
              }}
            />
            <small>{draft.shortcut === 'Super+Space' ? 'Win + Space 支持按住说话；其他组合键按一次开始，再按一次结束。' : '当前自定义快捷键按一次开始，再按一次结束。'}</small>
          </label>
          <div className="shortcut-presets">
            <button type="button" className="secondary-button" onClick={() => applyShortcut('Alt+Super')}>Alt + Win（按住说话）</button>
            <button type="button" className="secondary-button" onClick={() => applyShortcut('Super+Space')}>Win + Space（按住说话）</button>
          </div>
          <label>
            <span>悬浮条宽度：{draft.overlayWidth}px</span>
            <input type="range" min="44" max="280" value={Math.max(44, draft.overlayWidth)} onChange={(event) => {
              const next = { ...draft, overlayWidth: Number(event.target.value) }
              setDraft(next)
              void onSave(next)
            }} />
            <small>拖动此滑块调节大小；直接拖动悬浮条只会移动位置。</small>
          </label>
          <div className="overlay-position-setting">
            <span><strong>悬浮条位置</strong><small>直接拖动屏幕上的小横杠或波浪条即可保存位置。</small></span>
            <button className="secondary-button" onClick={() => void window.flowApi.resetOverlayPosition()}>恢复默认位置</button>
          </div>
          <label className="toggle-row"><span><strong>开机自动启动</strong><small>登录 Windows 后在托盘中静默运行。</small></span><input type="checkbox" checked={draft.launchAtStartup} onChange={(event) => update('launchAtStartup', event.target.checked)} /></label>
        </div>
      </section>
      <section className="settings-group">
        <div className="settings-group__title"><h2>API 凭证</h2><p>凭证使用 Windows 本机加密保存，不会写入历史记录。</p></div>
        <div className="settings-fields">
          <label><span>千问 API Key {settings.hasQwenApiKey ? <em>已配置</em> : null}</span><input type="password" value={draft.qwenApiKey} onChange={(event) => setDraft((current) => ({ ...current, qwenApiKey: event.target.value, provider: event.target.value ? 'qwen' : current.provider }))} placeholder={settings.hasQwenApiKey ? '输入新 Key 可替换' : 'sk-...'} /></label>
          <label><span>火山 API Key {settings.hasVolcanoApiKey ? <em>已配置</em> : null}</span><input type="password" value={draft.volcanoApiKey} onChange={(event) => update('volcanoApiKey', event.target.value)} placeholder={settings.hasVolcanoApiKey ? '输入新 Key 可替换' : '控制台 API Key'} /></label>
          <label><span>火山 App ID（可选）</span><input value={draft.volcanoAppId} onChange={(event) => update('volcanoAppId', event.target.value)} placeholder="用于旧版鉴权或用户标识" /></label>
          <label><span>火山 Access Key（兼容旧版，可选）</span><input type="password" value={draft.volcanoAccessKey} onChange={(event) => update('volcanoAccessKey', event.target.value)} placeholder="不使用时留空" /></label>
          <button className="secondary-button provider-test-button" disabled={testing} onClick={() => void testProvider()}>{testing ? '正在验证…' : '保存并测试当前识别服务'}</button>
        </div>
      </section>
    </div>
  )
}

export function App(): React.JSX.Element {
  const [state, setState] = useState<AppState>(emptyState)
  const [page, setPage] = useState<AppPage>('overview')

  useEffect(() => {
    void window.flowApi.getState().then(setState)
    return window.flowApi.onState(setState)
  }, [])

  const saveSettings = async (next: AppSettings): Promise<void> => {
    setState(await window.flowApi.saveSettings(next))
  }

  const activeSettings: AppSettings & { hasQwenApiKey?: boolean; hasVolcanoApiKey?: boolean } = state.settings

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand__mark"><span /><span /><span /><span /></div><strong>FlowType</strong></div>
        <nav>{nav.map((item) => { const Icon = item.icon; return <button className={page === item.id ? 'active' : ''} key={item.id} onClick={() => setPage(item.id)}><Icon size={18} /><span>{item.label}</span></button> })}</nav>
        <div className="sidebar-card">
          <div><span className={state.settings.provider === 'demo' ? 'status-dot status-dot--demo' : 'status-dot'} /><strong>{providerNames[state.settings.provider]}</strong></div>
          <p>{!state.shortcutReady ? '快捷键监听未就绪' : state.settings.provider === 'demo' ? '配置 API 后即可真实识别' : '语音识别服务已就绪'}</p>
          <button onClick={() => setPage('settings')}>管理识别服务 <ChevronRight size={14} /></button>
        </div>
        <button className="sidebar-record" onClick={() => window.flowApi.toggleRecording()}><Command size={16} /><span>{state.recording ? '正在聆听…' : '按快捷键开始说话'}</span><kbd>{formatShortcut(state.settings.shortcut)}</kbd></button>
      </aside>
      <main>
        {page === 'overview' ? <Overview state={state} setPage={setPage} /> : null}
        {page === 'history' ? <HistoryPage state={state} /> : null}
        {page === 'dictionary' ? <DictionaryPage settings={activeSettings} onSave={saveSettings} /> : null}
        {page === 'settings' ? <SettingsPage settings={activeSettings} onSave={saveSettings} /> : null}
      </main>
    </div>
  )
}
