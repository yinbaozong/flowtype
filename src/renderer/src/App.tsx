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
import type { AppPage, AppSettings, AppState, HistoryItem, Provider, PublicSettings } from '../../shared/types'
import { providerStatus, type ProviderSettings } from '../../shared/provider-status'
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
    undoShortcut: 'Control+Alt+Backspace',
    overlayX: null,
    overlayY: null,
    overlayWidth: 64,
    overlayVisible: true,
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
  uiLanguage,
  canRetry = false
}: {
  item: HistoryItem
  onDelete: (id: string) => void
  t: Translator
  uiLanguage: UiLanguage
  canRetry?: boolean
}): React.JSX.Element {
  return (
    <article className="history-row">
      <div className={`history-row__mark ${item.status === 'error' ? 'history-row__mark--error' : ''}`}>
        {item.status === 'error' ? <X size={16} /> : <Mic2 size={16} />}
      </div>
      <div className="history-row__main">
        <p>{item.status === 'error' ? item.error : item.text || item.draft}</p>
        {item.status === 'success' && item.error ? <small>{item.error}</small> : null}
        <div className="history-row__meta">
          <span>{new Date(item.createdAt).toLocaleString(localeTag(uiLanguage), { hour12: false })}</span>
          <span>{formatDuration(item.durationMs, t)}</span>
          <span>{providerName(item.provider, t)}</span>
          {item.partial ? <span>{uiLanguage === 'en' ? 'Partial / unfinished' : '部分完成／未定稿'}</span> : null}
        </div>
      </div>
      {canRetry ? <>
        <button className="secondary-button" title={uiLanguage === 'en' ? 'Retry once' : '重试一次'} onClick={() => void window.flowApi.retryLive()}>{uiLanguage === 'en' ? 'Retry once' : '重试一次'}</button>
        <button className="secondary-button" title={uiLanguage === 'en' ? 'Dismiss' : '放弃'} onClick={() => void window.flowApi.dismissLive()}>{uiLanguage === 'en' ? 'Dismiss' : '放弃'}</button>
      </> : null}
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
      canRetry={state.pendingRetryId === item.id}
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
          <HistoryRow item={item} key={item.id} t={t} uiLanguage={uiLanguage} canRetry={state.pendingRetryId === item.id} onDelete={(id) => window.flowApi.deleteHistory(id)} />
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
  settings: PublicSettings
  onSave: (settings: AppSettings) => Promise<void>
  t: Translator
}): React.JSX.Element {
  const [draft, setDraft] = useState<ProviderSettings>(settings)
  const [notice, setNotice] = useState('')
  const [testing, setTesting] = useState(false)
  const [capturingShortcut, setCapturingShortcut] = useState(false)
  const [capturingUndoShortcut, setCapturingUndoShortcut] = useState(false)
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
      const result = await window.flowApi.captureShortcut('recording')
      setDraft((current) => ({ ...current, shortcut: result.shortcut }))
      setNotice(t('shortcutActive', { shortcut: formatShortcut(result.shortcut) }))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('shortcutCaptureFailed'))
    } finally {
      setCapturingShortcut(false)
    }
  }
  const captureUndoShortcut = async (): Promise<void> => {
    setCapturingUndoShortcut(true)
    setNotice(t('undoShortcutCapturePrompt'))
    try {
      const result = await window.flowApi.captureShortcut('undo')
      setDraft((current) => ({ ...current, undoShortcut: result.shortcut }))
      setNotice(t('undoShortcutActive', { shortcut: formatShortcut(result.shortcut) }))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('shortcutCaptureFailed'))
    } finally {
      setCapturingUndoShortcut(false)
    }
  }
  const savedSignature = JSON.stringify(settings)
  useEffect(() => setDraft(settings), [savedSignature])
  const en = draft.uiLanguage === 'en'
  const active = providerStatus(settings)
  const pending = providerStatus(draft)
  const hasPending = draft.provider !== settings.provider || pending.model !== active.model || Boolean(draft.qwenApiKey || draft.volcanoApiKey || draft.deepseekApiKey || draft.volcanoAccessKey)
  const selectCredential = (provider: Provider, field: 'qwenApiKey' | 'volcanoApiKey' | 'deepseekApiKey', value: string): void => {
    setDraft(current => ({ ...current, [field]: value, provider: value ? provider : current.provider, ...(field === 'volcanoApiKey' && value ? { volcanoAccessKey: '', volcanoAccessKeySuffix: '' } : {}) }))
  }
  const useService = async (provider: Provider): Promise<void> => {
    const next = { ...draft, provider }
    setDraft(next)
    setNotice(en ? 'Saving selected service…' : '正在保存所选服务…')
    try {
      await onSave(next)
      setDraft(current => ({ ...current, qwenApiKey: '', volcanoApiKey: '', deepseekApiKey: '', volcanoAccessKey: '' }))
      setNotice(en ? 'Selected service saved. Run the connection test to verify access.' : '已切换到所选服务，请运行连接测试确认权限。')
    } catch (error) { setNotice(error instanceof Error ? error.message : t('saveFailed')) }
  }
  const save = async (): Promise<void> => {
    setNotice(t('saving'))
    try {
      await onSave(draft)
      setDraft(current => ({ ...current, qwenApiKey: '', volcanoApiKey: '', deepseekApiKey: '', volcanoAccessKey: '' }))
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
          <label><span>{t('recognitionService')}</span><select value={draft.provider} onChange={(event) => update('provider', event.target.value as Provider)}><option value="demo">{t('providerDemo')}</option><option value="qwen">{t('providerQwen')}</option><option value="volcano">{t('providerVolcano')}</option><option value="deepseek">{t('providerDeepSeek')}</option></select></label>
          <div className="service-summary" data-testid="service-summary">
            <strong>{en ? 'Currently active: ' : '当前生效：'}{providerName(settings.provider, t)}</strong>
            <p>{active.model} · {active.configured ? `Key ••••${active.suffix || (en ? '(hidden)' : '（已隐藏）')}${active.legacy ? ' (Access Token)' : ''}` : en ? 'No credential configured' : '尚未配置凭证'}</p>
            {hasPending ? <p>{en ? 'Not saved yet: ' : '待保存：'}{providerName(draft.provider, t)} · {pending.model} · {pending.configured ? `Key ••••${pending.suffix || (en ? '(hidden)' : '（已隐藏）')}` : en ? 'No credential' : '未配置凭证'}</p> : null}
            <small>{en ? 'A saved credential is not proof of connectivity. No automatic provider fallback.' : '已配置不代表已连通。录音使用当前生效服务，不会自动回退到其他服务。'}</small>
          </div>
          <label className="toggle-row"><span><strong>{draft.uiLanguage === 'en' ? 'Prewarm microphone' : '预热麦克风'}</strong><small>{draft.uiLanguage === 'en' ? 'Off: microphone opens only on press. On: lower start delay, Windows may show microphone in use.' : '默认关闭，仅按键时打开麦克风；开启可进一步减少准备时间，但 Windows 可能显示占用。'}</small></span><input type="checkbox" checked={Boolean(draft.warmMicrophone)} onChange={event => update('warmMicrophone', event.target.checked)} /></label>
          {draft.provider === 'qwen' || draft.provider === 'volcano' ? <label><span>{draft.uiLanguage === 'en' ? 'Recognition mode' : '识别方式'}</span><select value={draft.recognitionMode || 'realtime'} onChange={event => update('recognitionMode', event.target.value as 'realtime' | 'batch')}><option value="realtime">{draft.uiLanguage === 'en' ? 'Realtime, continuous output' : '实时识别，连续出字'}</option><option value="batch">{draft.uiLanguage === 'en' ? 'Transcribe after release' : '松手后整段识别'}</option></select></label> : null}
          {draft.provider === 'deepseek' ? <p>{draft.uiLanguage === 'en' ? 'Official DeepSeek ASR: automatic language detection, transcription after release. Chat model pricing does not apply to speech.' : '使用 DeepSeek 官方 ASR，自动检测语种，松手后识别。语音单独计费，不使用聊天模型的 Token 价格。'}</p> : null}
          {draft.provider === 'volcano' && draft.recognitionMode !== 'batch' ? <label><span>{draft.uiLanguage === 'en' ? 'Streaming speech resource' : '流式语音服务资源'}</span><select value={draft.volcanoResourceId || 'volc.seedasr.sauc.duration'} onChange={event => update('volcanoResourceId', event.target.value)}>{['volc.seedasr.sauc.duration', 'volc.seedasr.sauc.concurrent', 'volc.bigasr.sauc.duration', 'volc.bigasr.sauc.concurrent'].map(id => <option key={id} value={id}>{id}</option>)}</select><small>{draft.uiLanguage === 'en' ? 'Enable Doubao Streaming ASR in the speech console. Use a speech API Key, not an Ark chat-model Key. Realtime supports Chinese and English; confirmed sentences are inserted.' : '请在豆包语音控制台开通流式语音识别，使用语音 API Key，不是方舟聊天模型 Key。默认 2.0 小时版；实时支持中英文，按定稿分句输入。'}</small></label> : null}
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
          <div className="shortcut-setting">
            <span>{t('undoShortcut')}</span>
            <div className="shortcut-setting__controls">
              <kbd>{formatShortcut(draft.undoShortcut)}</kbd>
              <button type="button" className="secondary-button" disabled={capturingUndoShortcut} onClick={() => void captureUndoShortcut()}>{capturingUndoShortcut ? t('waitingForKeys') : t('captureUndoShortcut')}</button>
            </div>
            <small>{t('undoShortcutHint')}</small>
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
            <div className="overlay-position-actions">
              <button className="secondary-button" onClick={() => void window.flowApi.resetOverlayPosition()}>{t('resetPosition')}</button>
              <button className="secondary-button" onClick={() => {
                const next = { ...draft, overlayVisible: !draft.overlayVisible }
                setDraft(next)
                void onSave(next)
              }}>{draft.overlayVisible ? t('hideOverlay') : t('showOverlay')}</button>
            </div>
          </div>
          <label className="toggle-row"><span><strong>{t('launchAtStartup')}</strong><small>{t('launchAtStartupHint')}</small></span><input type="checkbox" checked={draft.launchAtStartup} onChange={(event) => update('launchAtStartup', event.target.checked)} /></label>
        </div>
      </section>
      <section className="settings-group">
        <div className="settings-group__title"><h2>{t('apiCredentials')}</h2><p>{t('apiCredentialsHint')}</p></div>
        <div className="settings-fields">
          <div className="credential-option"><label><span>Qwen API Key {settings.hasQwenApiKey ? <em>{t('configured')} · ••••{settings.qwenKeySuffix || (en ? '(hidden)' : '（已隐藏）')}</em> : null}</span><input type="password" value={draft.qwenApiKey} onChange={event => selectCredential('qwen', 'qwenApiKey', event.target.value)} placeholder={settings.hasQwenApiKey ? t('replaceKey') : 'sk-...'} /></label><button className="secondary-button" type="button" data-use-provider="qwen" onClick={() => void useService('qwen')}>{en ? 'Save and use Qwen' : '保存并使用千问'}</button></div>
          <div className="credential-option"><label><span>{en ? 'Doubao / Volcano API Key' : '豆包 / Volcano API Key'} {settings.hasVolcanoApiKey ? <em>{t('configured')} · ••••{settings.volcanoKeySuffix || (en ? '(hidden)' : '（已隐藏）')}</em> : null}</span><input type="password" value={draft.volcanoApiKey} onChange={event => selectCredential('volcano', 'volcanoApiKey', event.target.value)} placeholder={settings.hasVolcanoApiKey ? t('replaceKey') : t('consoleApiKey')} /></label><button className="secondary-button" type="button" data-use-provider="volcano" onClick={() => void useService('volcano')}>{en ? 'Save and use Doubao' : '保存并使用豆包'}</button></div>
          <div className="credential-option"><label><span>DeepSeek API Key {settings.hasDeepSeekApiKey ? <em>{t('configured')} · ••••{settings.deepseekKeySuffix || (en ? '(hidden)' : '（已隐藏）')}</em> : null}</span><input type="password" value={draft.deepseekApiKey || ''} onChange={event => selectCredential('deepseek', 'deepseekApiKey', event.target.value)} placeholder={settings.hasDeepSeekApiKey ? t('replaceKey') : 'sk-...'} /></label><button className="secondary-button" type="button" data-use-provider="deepseek" onClick={() => void useService('deepseek')}>{en ? 'Save and use DeepSeek' : '保存并使用 DeepSeek'}</button></div>
          <label><span>Volcano App ID ({t('optional')})</span><input value={draft.volcanoAppId} onChange={(event) => update('volcanoAppId', event.target.value)} placeholder={t('volcanoAppIdHint')} /></label>
          <label><span>{t('volcanoAccessKey')} {settings.volcanoAccessKeySuffix ? <em>••••{settings.volcanoAccessKeySuffix}</em> : null}</span><input type="password" value={draft.volcanoAccessKey} onChange={(event) => update('volcanoAccessKey', event.target.value)} placeholder={t('leaveEmpty')} /></label>
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

  const activeSettings = state.settings
  const activeService = providerStatus(activeSettings)

  return (
    <div className="app-shell" lang={uiLanguage === 'en' ? 'en' : 'zh-CN'}>
      <aside className="sidebar">
        <div className="brand"><img className="brand__mark" src={flowtypeIcon} alt="" /><strong>FlowType</strong></div>
        <nav>{nav.map((item) => { const Icon = item.icon; return <button className={page === item.id ? 'active' : ''} key={item.id} onClick={() => setPage(item.id)}><Icon size={18} /><span>{t(item.label)}</span></button> })}</nav>
        <div className="sidebar-card">
          <div><span className="status-dot status-dot--demo" /><strong>{providerName(state.settings.provider, t)}</strong></div>
          <p data-testid="active-provider">{activeService.model}<br />{activeService.configured ? `Key ••••${activeService.suffix || (uiLanguage === 'en' ? '(hidden)' : '（已隐藏）')}` : t('configureApi')}</p>
          <p>{!state.shortcutReady ? t('shortcutNotReady') : uiLanguage === 'en' ? 'Saved selection; connection not verified here' : '已选服务，连接状态请以测试结果为准'}</p>
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
