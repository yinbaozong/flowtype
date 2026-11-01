const { app, safeStorage } = require('electron')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const WebSocket = require('ws')
const { spawnSync } = require('node:child_process')
const speech = process.argv.includes('--speech')
app.setPath('userData', join(process.env.APPDATA, 'FlowType'))
const timeout = setTimeout(() => { console.error('FAIL realtime API timed out'); app.exit(1) }, 45000)
app.whenReady().then(() => {
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
    if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript?.trim()) finals++
    if (event.type === 'session.finished') {
      clearTimeout(timeout); ws.close()
      if (speech && (!previews || !finals)) { console.error('FAIL speech fixture: missing live previews or final sentence'); app.exit(1); return }
      console.log(`PASS realtime API: authenticated, audio accepted, finished; live previews before release=${previews}, final sentences=${finals}; ${speech ? 'synthetic speech only' : 'silence probe'}`); app.exit(0)
    }
    if (event.type === 'error') { console.error('FAIL provider error code:', event.error?.code); app.exit(1) }
  })
  ws.on('error', error => { console.error('FAIL realtime connection:', error.code || error.name); app.exit(1) })
}).catch(error => { console.error('FAIL realtime check:', error.message.replace(/sk-[\w-]+/g, '[redacted]')); app.exit(1) })
