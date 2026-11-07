const { app, safeStorage } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const WebSocket = require('ws')
const { spawnSync } = require('node:child_process')
const speech = process.argv.includes('--speech')
app.setPath('userData', join(process.env.APPDATA, 'FlowType'))
const timeout = setTimeout(() => { console.error('FAIL realtime API timed out'); app.exit(1) }, 90000)
app.whenReady().then(async () => {
  const data = JSON.parse(readFileSync(join(process.env.APPDATA, 'FlowType', 'flowtype-data.json'), 'utf8'))
  const key = safeStorage.decryptString(Buffer.from(data.settings.qwenApiKeyEncrypted, 'base64'))
  let pcm = Buffer.alloc(3200)
  if (speech) {
    const script = `Add-Type -AssemblyName System.Speech
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $m = New-Object System.IO.MemoryStream
    $f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $s.SetOutputToAudioStream($m, $f)
    $s.Speak('This is a FlowType internal speech recognition test. Streaming transcription keeps words while I am speaking.')
    [Console]::Write([Convert]::ToBase64String($m.ToArray()))
    $s.Dispose(); $m.Dispose()`
    const generated = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
    if (generated.status !== 0) throw new Error('Synthetic speech fixture failed')
    pcm = Buffer.concat([Buffer.from(generated.stdout.trim(), 'base64'), Buffer.alloc(32000)])
  }
  let finishing = false, previews = 0, finals = 0
  if (process.argv.includes('--flow')) {
    const { build } = require('esbuild')
    const { Module } = require('node:module')
    const filename = join(__dirname, 'realtime-flow-fixture.cjs')
    const baseline = process.argv.includes('--baseline')
    const plugins = baseline ? [{ name: 'baseline-062', setup(builder) {
      builder.onLoad({ filter: /realtime-session\.ts$/ }, () => {
        const source = spawnSync('git', ['show', '6170d0ce132edcc911f84e2863139f6d20507203:src/main/realtime-session.ts'], { cwd: join(__dirname, '..'), encoding: 'utf8', windowsHide: true })
        if (source.status !== 0) throw new Error('Baseline v0.6.2 source unavailable')
        return { contents: source.stdout, loader: 'ts' }
      })
    } }] : []
    const output = await build({ entryPoints: [join(__dirname, '../src/main/realtime-session.ts')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, plugins })
    const fixture = new Module(filename, module)
    fixture.filename = filename; fixture.paths = module.paths
    fixture._compile(output.outputFiles[0].text, filename)
    let early = 0, firstDraftMs, firstConfirmedMs, releasedAt
    const startedAt = Date.now()
    const deltas = []
    const probe = new fixture.exports.RealtimeSession(key, 'auto', state => {
      if ((state.draft || state.text) && firstDraftMs === undefined) firstDraftMs = Date.now() - startedAt
      if (state.phase === 'failed') { console.error('FAIL realtime flow:', state.error); probe.dispose(); app.exit(1) }
      if (state.phase === 'done') {
        if (!early || deltas.join('') !== state.text) { console.error('FAIL realtime flow:', JSON.stringify({early, increments: deltas.map(value => value.length), finalLength: state.text.length, matches: deltas.join('') === state.text})); app.exit(1); return }
        console.log(`PASS real realtime-session flow: ${early} confirmed increments before sentence completion; ${deltas.length} total increments; final text matches exactly; synthetic speech only`)
        console.log(JSON.stringify({ source: baseline ? 'v0.6.2' : 'working-tree', frameMs: 20, audioMs: Math.round(pcm.length / 32), feedMs: releasedAt - startedAt, firstDraftMs, firstConfirmedMs, releaseToDoneMs: Date.now() - releasedAt }))
        clearTimeout(timeout); probe.dispose(); app.exit(0)
      }
    }, (text, confirmedIncrement) => {
      if (firstConfirmedMs === undefined) firstConfirmedMs = Date.now() - startedAt
      if (confirmedIncrement) early++
      deltas.push(text)
    })
    probe.connect()
    let offset = 0
    const feedBegan = Date.now()
    const feed = setInterval(() => {
      // Match the worklet's audio clock, rather than stretching speech when Windows timers wake late.
      const available = Math.min(pcm.length, Math.floor((Date.now() - feedBegan) / 20) * 640)
      while (offset < available) { probe.append(pcm.subarray(offset, Math.min(offset + 640, pcm.length))); offset += 640 }
      if (offset >= pcm.length) { clearInterval(feed); releasedAt = Date.now(); probe.finish() }
    }, 10)
    return
  }
  let confirmedUpdates = 0
  const confirmedLengths = new Map()
  const ws = new WebSocket('wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime', { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 10000 })
  const send = value => ws.send(JSON.stringify({ event_id: require('node:crypto').randomUUID(), ...value }))
  ws.on('open', () => send({ type: 'session.update', session: { input_audio_format: 'pcm', sample_rate: 16000, turn_detection: { type: 'server_vad', threshold: 0, silence_duration_ms: 400 } } }))
  ws.on('message', raw => {
    const event = JSON.parse(raw.toString())
    if (event.type === 'session.updated') {
      let offset = 0
      const timer = setInterval(() => {
        if (offset < pcm.length) {
          send({ type: 'input_audio_buffer.append', audio: pcm.subarray(offset, offset + 3200).toString('base64') })
          offset += 3200
        } else { clearInterval(timer); finishing = true; send({ type: 'session.finish' }) }
      }, speech ? 100 : 1)
    }
    if (event.type === 'conversation.item.input_audio_transcription.text' && !finishing) previews++
    if (event.type === 'conversation.item.input_audio_transcription.text' && !finishing && event.text?.length > (confirmedLengths.get(event.item_id) || 0)) {
      confirmedUpdates++; confirmedLengths.set(event.item_id, event.text.length)
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript?.trim()) finals++
    if (event.type === 'session.finished') {
      clearTimeout(timeout); ws.close()
      if (speech && (!previews || !finals)) { console.error('FAIL speech fixture: missing live previews or final sentence'); app.exit(1); return }
      console.log(`PASS realtime API: authenticated, audio accepted, finished; live previews before release=${previews}, confirmed prefix updates=${confirmedUpdates}, final sentences=${finals}; ${speech ? 'synthetic speech only' : 'silence probe'}`); app.exit(0)
    }
    if (event.type === 'error') { console.error('FAIL provider error code:', event.error?.code); app.exit(1) }
  })
  ws.on('error', error => { console.error('FAIL realtime connection:', error.code || error.name); app.exit(1) })
}).catch(error => { console.error('FAIL realtime check:', error.message.replace(/sk-[\w-]+/g, '[redacted]')); app.exit(1) })
