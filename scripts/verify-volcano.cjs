const { app, safeStorage } = require('electron')
const { readFileSync, writeFileSync, renameSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')
app.setPath('userData', join(process.env.APPDATA, 'FlowType'))
const deadline = setTimeout(() => { console.error('FAIL Volcano probe timed out'); app.exit(1) }, 60000)
app.whenReady().then(async () => {
  const data = JSON.parse(readFileSync(join(app.getPath('userData'), 'flowtype-data.json'), 'utf8'))
  const key = process.env.FLOWTYPE_VOLCANO_KEY || safeStorage.decryptString(Buffer.from(data.settings.volcanoApiKeyEncrypted, 'base64'))
  if (process.argv.includes('--save-key-only')) {
    if (!process.env.FLOWTYPE_VOLCANO_KEY || !safeStorage.isEncryptionAvailable()) throw new Error('Encrypted configuration unavailable')
    data.settings.volcanoApiKeyEncrypted = safeStorage.encryptString(key).toString('base64')
    data.settings.volcanoAccessKeyEncrypted = ''
    data.settings.volcanoResourceId = 'volc.seedasr.sauc.duration'
    const file = join(app.getPath('userData'), 'flowtype-data.json')
    writeFileSync(file + '.configuration.tmp', JSON.stringify(data, null, 2), 'utf8')
    renameSync(file + '.configuration.tmp', file)
    console.log(JSON.stringify({ keySavedEncrypted: true, providerPreserved: data.settings.provider, historyCount: data.history.length, permissionsVerified: false }))
    clearTimeout(deadline); app.exit(0); return
  }
  const { build } = require('esbuild')
  const { Module } = require('node:module')
  const filename = join(__dirname, 'speech-fixture.cjs')
  const output = await build({ entryPoints: [join(__dirname, '../src/main/speech-providers.ts')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const fixture = new Module(filename, module); fixture.filename = filename; fixture.paths = module.paths
  fixture._compile(output.outputFiles[0].text, filename)
  const script = `Add-Type -AssemblyName System.Speech
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $m = New-Object System.IO.MemoryStream
    $f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $s.SetOutputToAudioStream($m, $f); $s.Speak('This is a voice recognition test. Hello from FlowType.')
    [Console]::Write([Convert]::ToBase64String($m.ToArray())); $s.Dispose(); $m.Dispose()`
  const generated = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
  if (generated.status !== 0) throw new Error('Synthetic speech fixture failed')
  const pcm = Buffer.concat([Buffer.from(generated.stdout.trim(), 'base64'), Buffer.alloc(32000)])
  const deltas = []
  let feed
  const probe = new fixture.exports.VolcanoSession({ volcanoApiKey: key, volcanoResourceId: process.env.FLOWTYPE_VOLCANO_RESOURCE || 'volc.seedasr.sauc.duration', language: 'auto' }, state => {
    if (state.phase === 'listening' && !feed) {
      let offset = 0; const start = Date.now()
      feed = setInterval(() => {
        const available = Math.min(pcm.length, Math.floor((Date.now() - start) / 200) * 6400)
        while (offset < available) { probe.append(pcm.subarray(offset, Math.min(offset + 6400, pcm.length))); offset += 6400 }
        if (offset >= pcm.length) { clearInterval(feed); probe.finish() }
      }, 20)
    }
    if (state.phase === 'done' || state.phase === 'failed') {
      clearInterval(feed); clearTimeout(deadline); probe.dispose()
      if (state.phase === 'failed') { console.error('FAIL Volcano:', state.error); app.exit(1); return }
      if (!state.text.trim() || deltas.join('') !== state.text) { console.error('FAIL transcript delivery mismatch'); app.exit(1); return }
      console.log(JSON.stringify({ passed: true, provider: 'Volcano', finalizedCharacters: state.text.length, insertions: deltas.length, syntheticSpeechOnly: true })); app.exit(0)
    }
  }, text => deltas.push(text))
  probe.connect()
}).catch(() => { console.error('FAIL Volcano probe setup'); app.exit(1) })
