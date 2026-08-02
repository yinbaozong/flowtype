import { useEffect, useMemo, useState } from 'react'
import {
  BookOpenText,
  Check,
  ChevronRight,
  Clock3,
  Command,
  Copy,
  Download,
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
import flowtypeIcon from '../../../resources/flowtype-icon.png'
import type { AppPage, AppSettings, AppState, HistoryItem, Provider } from '../../shared/types'
import {
  localeTag,
  providerName,
  translator,
  type MessageKey,
  type Translator,
  type UiLanguage
} from './i18n'

const emptyState: AppState = {
  settings: {
    provider: 'demo',
    uiLanguage: 'zh',
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

const nav: Array<{ id: AppPage; label: MessageKey; icon: typeof Gauge }> = [
  { id: 'overview', label: 'navOverview', icon: Gauge },
  { id: 'history', label: 'navHistory', icon: History },
  { id: 'dictionary', label: 'navDictionary', icon: BookOpenText },
  { id: 'settings', label: 'navSettings', icon: Settings }
]

function formatShortcut(shortcut: string): string {
  return shortcut.replaceAll('Control', 'Ctrl').replaceAll('Super', 'Win')
}

function formatDuration(durationMs: number, t: Translator): string {
  if (durationMs < 60_000) return t('seconds', { count: Math.max(1, Math.round(durationMs / 1000)) })
  return t('minutes', { count: Math.round(durationMs / 60_000) })
}

function recognitionLanguageName(language: AppSettings['language'], t: Translator): string {
  const key: Record<AppSettings['language'], MessageKey> = {
    auto: 'autoDetect',
    zh: 'chinese',
    en: 'english',
    ja: 'japanese',
    yue: 'cantonese'
  }
  return t(key[language])
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
  onDelete,
  t,
  uiLanguage
}: {
  item: HistoryItem
  onDelete: (id: string) => void
  t: Translator
  uiLanguage: UiLanguage
}): React.JSX.Element {
  return (
    <article className="history-row">
      <div className={`history-row__mark ${item.status === 'error' ? 'history-row__mark--error' : ''}`}>
        {item.status === 'error' ? <X size={16} /> : <Mic2 size={16} />}
      </div>
      <div className="history-row__main">
        <p>{item.status === 'error' ? item.error : item.text}</p>
        <div className="history-row__meta">
          <span>{new Date(item.createdAt).toLocaleString(localeTag(uiLanguage), { hour12: false })}</span>
          <span>{formatDuration(item.durationMs, t)}</span>
          <span>{providerName(item.provider, t)}</span>
        </div>
      </div>
      {item.status === 'success' ? (
        <button className="icon-button" title={t('copy')} onClick={() => window.flowApi.copyText(item.text)}>
          <Copy size={16} />
        </button>
      ) : null}
      <button className="icon-button icon-button--danger" title={t('delete')} onClick={() => onDelete(item.id)}>
        <Trash2 size={16} />
      </button>
    </article>
  )
}

function StatChart({ history, t, uiLanguage }: { history: HistoryItem[]; t: Translator; uiLanguage: UiLanguage }): React.JSX.Element {
  const days = useMemo(() => {
    const result: Array<{ label: string; value: number; today: boolean }> = []
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date()
      date.setDate(date.getDate() - offset)
      const value = history
        .filter((item) => dayKey(new Date(item.createdAt)) === dayKey(date) && item.status === 'success')
        .reduce((sum, item) => sum + item.durationMs / 60_000, 0)
      result.push({
        label: offset === 0 ? t('today') : date.toLocaleDateString(localeTag(uiLanguage), { weekday: 'short' }),
        value,
        today: offset === 0
      })
    }
    return result
  }, [history, t, uiLanguage])
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
  setPage,
  t,
  uiLanguage
}: {
  state: AppState
  setPage: (page: AppPage) => void
  t: Translator
  uiLanguage: UiLanguage
}): React.JSX.Element {
  const today = state.history.filter((item) => isToday(item.createdAt) && item.status === 'success')
  const minutes = today.reduce((sum, item) => sum + item.durationMs, 0) / 60_000
  const words = today.reduce((sum, item) => sum + item.text.replace(/\s/g, '').length, 0)
  const row = (item: HistoryItem): React.JSX.Element => (
    <HistoryRow
      item={item}
      key={item.id}
      t={t}
      uiLanguage={uiLanguage}
      onDelete={(id) => window.flowApi.deleteHistory(id)}
    />
  )

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="date-label">
            {new Date().toLocaleDateString(localeTag(uiLanguage), { month: 'long', day: 'numeric', weekday: 'long' })}
          </p>
          <h1>{t('greeting')}</h1>
        </div>
        <button className="record-button" onClick={() => window.flowApi.toggleRecording()}>
          <Mic2 size={17} />
          {state.recording ? t('stopRecognition') : t('startRecognition')}
          <kbd>{formatShortcut(state.settings.shortcut)}</kbd>
        </button>
      </header>

      <section className="daily-summary">
        <div className="daily-summary__lead">
          <span>{t('todayVoiceInput')}</span>
          <strong>{minutes < 1 ? minutes.toFixed(1) : Math.round(minutes)}</strong>
          <em>{t('minuteUnit')}</em>
          <p>{t('totalWords', { count: words.toLocaleString(localeTag(uiLanguage)) })}</p>
        </div>
        <StatChart history={state.history} t={t} uiLanguage={uiLanguage} />
      </section>

      <section className="quick-strip">
        <button onClick={() => setPage('settings')}>
          <span className="quick-strip__icon"><Keyboard size={18} /></span>
          <span><strong>{formatShortcut(state.settings.shortcut)}</strong><small>{t('globalShortcut')}</small></span>
          <ChevronRight size={16} />
        </button>
        <button onClick={() => setPage('settings')}>
          <span className="quick-strip__icon"><Sparkles size={18} /></span>
          <span><strong>{providerName(state.settings.provider, t)}</strong><small>{t('recognitionService')}</small></span>
          <ChevronRight size={16} />
        </button>
        <button onClick={() => setPage('settings')}>
          <span className="quick-strip__icon"><Languages size={18} /></span>
          <span><strong>{recognitionLanguageName(state.settings.language, t)}</strong><small>{t('recognitionLanguage')}</small></span>
          <ChevronRight size={16} />
        </button>
      </section>

      <section className="section-block">
        <div className="section-title">
          <div><h2>{t('recentRecognition')}</h2><p>{t('localOnly')}</p></div>
          <button className="text-button" onClick={() => setPage('history')}>{t('viewAll')} <ChevronRight size={15} /></button>
        </div>
        <div className="history-list">
          {state.history.length ? state.history.slice(0, 5).map(row) : (
            <div className="empty">
              <div><Mic2 size={20} /></div>
              <h3>{t('noRecognition')}</h3>
              <p>{t('firstRecognition', { shortcut: formatShortcut(state.settings.shortcut) })}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function HistoryPage({ state, t, uiLanguage }: { state: AppState; t: Translator; uiLanguage: UiLanguage }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [exportNotice, setExportNotice] = useState('')
  const filtered = state.history.filter((item) =>
    `${item.text} ${item.error ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  )
  return (
    <div className="page">
      <header className="page-header">
        <div><p className="date-label">{t('localRecords')}</p><h1>{t('navHistory')}</h1></div>
        {state.history.length ? (
          <div className="page-header__actions">
            <button className="primary-button" onClick={() => {
              setExportNotice(t('exporting'))
              void window.flowApi.exportHistory()
                .then((result) => setExportNotice(result.canceled ? '' : t('exported', { count: result.count })))
                .catch((error: unknown) => setExportNotice(error instanceof Error ? error.message : t('exportFailed')))
            }}><Download size={16} /> {t('exportMarkdown')}</button>
            <button className="secondary-button" onClick={() => window.flowApi.clearHistory()}><Trash2 size={16} /> {t('clearRecords')}</button>
          </div>
        ) : null}
      </header>
      {exportNotice ? <p className="settings-notice">{exportNotice}</p> : null}
      <div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchPlaceholder')} /></div>
      <section className="section-block history-page-list">
        {filtered.length ? filtered.map((item) => (
          <HistoryRow item={item} key={item.id} t={t} uiLanguage={uiLanguage} onDelete={(id) => window.flowApi.deleteHistory(id)} />
        )) : <div className="empty"><div><Clock3 size={20} /></div><h3>{t('noRecordsFound')}</h3><p>{t('newRecognitionHint')}</p></div>}
      </section>
    </div>
  )
}

function DictionaryPage({
  settings,
  onSave,
  t
}: {
  settings: AppSettings
  onSave: (settings: AppSettings) => Promise<void>
  t: Translator
}): React.JSX.Element {
  const [word, setWord] = useState('')
  const addWord = (): void => {
    const next = word.trim()
    if (!next || settings.dictionary.includes(next)) return
    void onSave({ ...settings, dictionary: [...settings.dictionary, next] })
    setWord('')
  }
  return (
    <div className="page">
      <header className="page-header"><div><p className="date-label">{t('properNouns')}</p><h1>{t('personalDictionary')}</h1><p className="page-subtitle">{t('dictionaryDescription')}</p></div></header>
      <div className="dictionary-add"><input value={word} onChange={(event) => setWord(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addWord()} placeholder={t('dictionaryPlaceholder')} /><button className="primary-button" onClick={addWord}><Plus size={17} /> {t('addWord')}</button></div>
      <section className="section-block">
        <div className="word-list">
          {settings.dictionary.length ? settings.dictionary.map((item) => (
            <div className="word-row" key={item}><span>{item}</span><button className="icon-button icon-button--danger" onClick={() => void onSave({ ...settings, dictionary: settings.dictionary.filter((value) => value !== item) })}><X size={16} /></button></div>
          )) : <div className="empty"><div><BookOpenText size={20} /></div><h3>{t('dictionaryEmpty')}</h3><p>{t('dictionaryEmptyHint')}</p></div>}
        </div>
      </section>
    </div>
  )
}

function SettingsPage({
  settings,
  onSave,
  t
}: {
  settings: AppSettings & { hasQwenApiKey?: boolean; hasVolcanoApiKey?: boolean }
  onSave: (settings: AppSettings) => Promise<void>
  t: Translator
}): React.JSX.Element {
  const [draft, setDraft] = useState(settings)
  const [notice, setNotice] = useState('')
  const [testing, setTesting] = useState(false)
  const [capturingShortcut, setCapturingShortcut] = useState(false)
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => setDraft((current) => ({ ...current, [key]: value }))
  const applyShortcut = (shortcut: string): void => {
    const next = { ...draft, shortcut }
    setDraft(next)
    setNotice(t('applyingShortcut'))
    void onSave(next)
      .then(() => setNotice(t('shortcutActive', { shortcut: formatShortcut(shortcut) })))
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : t('shortcutRegisterFailed')))
  }
  const captureShortcut = async (): Promise<void> => {
    setCapturingShortcut(true)
    setNotice(t('shortcutCapturePrompt'))
    try {
      const result = await window.flowApi.captureShortcut()
      const next = { ...draft, shortcut: result.shortcut }
      setDraft(next)
      setNotice(t('applyingShortcut'))
      await onSave(next)
      setNotice(t('shortcutActive', { shortcut: formatShortcut(result.shortcut) }))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('shortcutCaptureFailed'))
    } finally {
      setCapturingShortcut(false)
    }
  }
  useEffect(() => setDraft(settings), [settings])
  const save = async (): Promise<void> => {
    setNotice(t('saving'))
    try {
      await onSave(draft)
      setNotice(t('settingsSaved'))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('saveFailed'))
    }
  }
  const testProvider = async (): Promise<void> => {
    setTesting(true)
    setNotice(t('testingApi'))
    try {
      await onSave(draft)
      const result = await window.flowApi.testProvider()
      setNotice(result.message)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('connectionTestFailed'))
    } finally {
      setTesting(false)
    }
  }
  const changeUiLanguage = (uiLanguage: UiLanguage): void => {
    const next = { ...draft, uiLanguage }
    setDraft(next)
    void onSave(next)
  }
  return (
    <div className="page">
      <header className="page-header"><div><p className="date-label">{t('preferences')}</p><h1>{t('navSettings')}</h1>{notice ? <p className="settings-notice">{notice}</p> : null}</div><button className="primary-button" onClick={() => void save()}><Check size={17} /> {t('saveSettings')}</button></header>
      <section className="settings-group">
        <div className="settings-group__title"><h2>{t('interfaceSettings')}</h2><p>{t('interfaceSettingsDescription')}</p></div>
        <div className="settings-fields">
          <label><span>{t('interfaceLanguage')}</span><select value={draft.uiLanguage} onChange={(event) => changeUiLanguage(event.target.value as UiLanguage)}><option value="zh">中文</option><option value="en">English</option></select></label>
        </div>
      </section>
      <section className="settings-group">
        <div className="settings-group__title"><h2>{t('recognitionSettings')}</h2><p>{t('recognitionSettingsDescription')}</p></div>
        <div className="settings-fields">
          <label><span>{t('recognitionService')}</span><select value={draft.provider} onChange={(event) => update('provider', event.target.value as Provider)}><option value="demo">{t('providerDemo')}</option><option value="qwen">{t('providerQwen')}</option><option value="volcano">{t('providerVolcano')}</option></select></label>
          <label><span>{t('recognitionLanguage')}</span><select value={draft.language} onChange={(event) => update('language', event.target.value as AppSettings['language'])}><option value="auto">{t('autoDetect')}</option><option value="zh">{t('chinese')}</option><option value="en">{t('english')}</option><option value="ja">{t('japanese')}</option><option value="yue">{t('cantonese')}</option></select></label>
          <div className="shortcut-setting">
            <span>{t('globalShortcut')}</span>
            <div className="shortcut-setting__controls">
              <kbd>{formatShortcut(draft.shortcut)}</kbd>
              <button type="button" className="secondary-button" disabled={capturingShortcut} onClick={() => void captureShortcut()}>{capturingShortcut ? t('waitingForKeys') : t('captureShortcut')}</button>
            </div>
            <small>{t('holdToTalkHint')}</small>
          </div>
          <div className="shortcut-presets">
            <button type="button" className="secondary-button" onClick={() => applyShortcut('Alt+Super')}>Alt + Win ({t('holdToTalk')})</button>
            <button type="button" className="secondary-button" onClick={() => applyShortcut('Super+Space')}>Win + Space ({t('holdToTalk')})</button>
          </div>
          <label>
            <span>{t('overlayWidth', { width: draft.overlayWidth })}</span>
            <input type="range" min="44" max="280" value={Math.max(44, draft.overlayWidth)} onChange={(event) => {
              const next = { ...draft, overlayWidth: Number(event.target.value) }
              setDraft(next)
              void onSave(next)
            }} />
            <small>{t('overlayWidthHint')}</small>
          </label>
          <div className="overlay-position-setting">
            <span><strong>{t('overlayPosition')}</strong><small>{t('overlayPositionHint')}</small></span>
            <button className="secondary-button" onClick={() => void window.flowApi.resetOverlayPosition()}>{t('resetPosition')}</button>
          </div>
          <label className="toggle-row"><span><strong>{t('launchAtStartup')}</strong><small>{t('launchAtStartupHint')}</small></span><input type="checkbox" checked={draft.launchAtStartup} onChange={(event) => update('launchAtStartup', event.target.checked)} /></label>
        </div>
      </section>
      <section className="settings-group">
        <div className="settings-group__title"><h2>{t('apiCredentials')}</h2><p>{t('apiCredentialsHint')}</p></div>
        <div className="settings-fields">
          <label><span>Qwen API Key {settings.hasQwenApiKey ? <em>{t('configured')}</em> : null}</span><input type="password" value={draft.qwenApiKey} onChange={(event) => setDraft((current) => ({ ...current, qwenApiKey: event.target.value, provider: event.target.value ? 'qwen' : current.provider }))} placeholder={settings.hasQwenApiKey ? t('replaceKey') : 'sk-...'} /></label>
          <label><span>Volcano API Key {settings.hasVolcanoApiKey ? <em>{t('configured')}</em> : null}</span><input type="password" value={draft.volcanoApiKey} onChange={(event) => update('volcanoApiKey', event.target.value)} placeholder={settings.hasVolcanoApiKey ? t('replaceKey') : t('consoleApiKey')} /></label>
          <label><span>Volcano App ID ({t('optional')})</span><input value={draft.volcanoAppId} onChange={(event) => update('volcanoAppId', event.target.value)} placeholder={t('volcanoAppIdHint')} /></label>
          <label><span>{t('volcanoAccessKey')}</span><input type="password" value={draft.volcanoAccessKey} onChange={(event) => update('volcanoAccessKey', event.target.value)} placeholder={t('leaveEmpty')} /></label>
          <button className="secondary-button provider-test-button" disabled={testing} onClick={() => void testProvider()}>{testing ? t('verifying') : t('verifyProvider')}</button>
        </div>
      </section>
    </div>
  )
}

export function App(): React.JSX.Element {
  const [state, setState] = useState<AppState>(emptyState)
  const [page, setPage] = useState<AppPage>('overview')
  const uiLanguage = state.settings.uiLanguage
  const t = useMemo(() => translator(uiLanguage), [uiLanguage])

  useEffect(() => {
    void window.flowApi.getState().then(setState)
    return window.flowApi.onState(setState)
  }, [])

  const saveSettings = async (next: AppSettings): Promise<void> => {
    setState(await window.flowApi.saveSettings(next))
  }

  const activeSettings: AppSettings & { hasQwenApiKey?: boolean; hasVolcanoApiKey?: boolean } = state.settings

  return (
    <div className="app-shell" lang={uiLanguage === 'en' ? 'en' : 'zh-CN'}>
      <aside className="sidebar">
        <div className="brand"><img className="brand__mark" src={flowtypeIcon} alt="" /><strong>FlowType</strong></div>
        <nav>{nav.map((item) => { const Icon = item.icon; return <button className={page === item.id ? 'active' : ''} key={item.id} onClick={() => setPage(item.id)}><Icon size={18} /><span>{t(item.label)}</span></button> })}</nav>
        <div className="sidebar-card">
          <div><span className={state.settings.provider === 'demo' ? 'status-dot status-dot--demo' : 'status-dot'} /><strong>{providerName(state.settings.provider, t)}</strong></div>
          <p>{!state.shortcutReady ? t('shortcutNotReady') : state.settings.provider === 'demo' ? t('configureApi') : t('serviceReady')}</p>
          <button onClick={() => setPage('settings')}>{t('manageService')} <ChevronRight size={14} /></button>
        </div>
        <button className="sidebar-record" onClick={() => window.flowApi.toggleRecording()}><Command size={16} /><span>{state.recording ? t('listening') : t('pressShortcut')}</span><kbd>{formatShortcut(state.settings.shortcut)}</kbd></button>
      </aside>
      <main>
        {page === 'overview' ? <Overview state={state} setPage={setPage} t={t} uiLanguage={uiLanguage} /> : null}
        {page === 'history' ? <HistoryPage state={state} t={t} uiLanguage={uiLanguage} /> : null}
        {page === 'dictionary' ? <DictionaryPage settings={activeSettings} onSave={saveSettings} t={t} /> : null}
        {page === 'settings' ? <SettingsPage settings={activeSettings} onSave={saveSettings} t={t} /> : null}
      </main>
    </div>
  )
}
