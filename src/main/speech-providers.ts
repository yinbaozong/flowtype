import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import type { AppSettings } from '../shared/types'
import type { LiveUpdate } from './realtime-session'

export async function requestDeepSeek(audio: Uint8Array, key: string, fetcher: typeof fetch = fetch, allowEmpty = false): Promise<string> {
  if (!key) throw new Error('请先填写 DeepSeek API Key / Missing DeepSeek API Key')
  const body = new FormData()
  body.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'speech.wav')
  const response = await fetcher('https://api.deepseek.com/v1/tools/asr', {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body, signal: AbortSignal.timeout(60_000)
  })
  if (!response.ok) throw new Error(`DeepSeek ASR HTTP ${response.status}：请检查语音服务权限、余额或稍后重试。`)
  const result = await response.json() as { text?: string }
  if (!result.text?.trim() && !allowEmpty) throw new Error('DeepSeek 未返回识别文字 / No transcription returned')
  return result.text?.trim() || ''
}

function encodeVolcano(type: number, payload: Buffer, final = false): Buffer {
  const body = gzipSync(payload)
  const header = Buffer.alloc(8)
  header.set([0x11, (type << 4) | (final ? 2 : 0), type === 1 ? 0x11 : 0x01, 0])
  header.writeUInt32BE(body.length, 4)
  return Buffer.concat([header, body])
}

export function decodeVolcano(frame: Buffer): { payload: any; final: boolean } {
  if (frame.length < 8 || frame[0] >> 4 !== 1) throw new Error('Invalid Volcano frame')
  const type = frame[1] >> 4, flags = frame[1] & 15
  let offset = (frame[0] & 15) * 4
  if (offset < 4) throw new Error('Invalid Volcano header')
  if (flags & 1) offset += 4
  if (flags & 4) offset += 4
  let code = 0
  if (type === 15) { if (offset + 4 > frame.length) throw new Error('Truncated error'); code = frame.readUInt32BE(offset); offset += 4 }
  if (offset + 4 > frame.length) throw new Error('Truncated Volcano payload')
  const length = frame.readUInt32BE(offset); offset += 4
  if (length !== frame.length - offset || length > 4_000_000) throw new Error('Invalid Volcano payload size')
  const raw = frame.subarray(offset)
  const body = (frame[2] & 15) === 1 ? gunzipSync(raw, { maxOutputLength: 4_000_000 }) : raw
  if (code) throw new Error(`Volcano ASR error ${code}`)
  if (type !== 9 || frame[2] >> 4 !== 1) throw new Error('Unsupported Volcano response')
  return { payload: JSON.parse(body.toString('utf8')), final: Boolean(flags & 2) }
}

export class VolcanoSession {
  readonly id = randomUUID()
  readonly startedAt = Date.now()
  text = ''
  ended = false
  durationMs = 0
  private audio: Buffer[] = []
  private sent = 0
  private pendingBytes = 0
  private socket: WebSocket | null = null
  private generation = 0
  private phase: LiveUpdate['phase'] = 'connecting'
  private draft = ''
  private error = ''
  private retried = false
  private disposed = false
  private finalSent = false
  private timer?: NodeJS.Timeout
  private pump?: NodeJS.Timeout
  constructor(private config: Pick<AppSettings, 'volcanoApiKey' | 'volcanoAppId' | 'volcanoAccessKey' | 'volcanoResourceId' | 'language'>,
    private update: (value: LiveUpdate) => void, private sentence: (value: string) => void) {}

  connect(): void {
    if (this.disposed) return
    this.phase = 'connecting'; this.error = ''; this.finalSent = false
    const generation = ++this.generation
    const valid = (): boolean => generation === this.generation && !this.disposed && this.phase !== 'failed' && this.phase !== 'done'
    const headers: Record<string, string> = {
      'X-Api-Resource-Id': this.config.volcanoResourceId || 'volc.seedasr.sauc.duration', 'X-Api-Request-Id': randomUUID()
    }
    if (this.config.language === 'ja') { this.fail('豆包实时接口仅支持中英文，请选择自动识别或切换整段模式。 / Realtime supports Chinese and English.'); return }
    if (this.config.volcanoAccessKey) {
      headers['X-Api-App-Key'] = this.config.volcanoAppId
      headers['X-Api-Access-Key'] = this.config.volcanoAccessKey
    } else headers['X-Api-Key'] = this.config.volcanoApiKey
    if (!headers['X-Api-Key'] && !this.config.volcanoAccessKey) { this.fail('请填写豆包语音 API Key / Missing speech API Key'); return }
    if (Object.values(headers).some(value => /[\r\n]/.test(value))) { this.fail('语音凭证包含换行，请重新粘贴。 / Invalid credential'); return }
    const socket = new WebSocket('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async', { headers, handshakeTimeout: 8000 })
    this.socket = socket
    this.timer = setTimeout(() => this.fail('豆包连接超时 / Connection timed out'), 10_000)
    socket.on('open', () => {
      if (!valid()) return
      clearTimeout(this.timer)
      socket.send(encodeVolcano(1, Buffer.from(JSON.stringify({
        user: { uid: 'flowtype-desktop' }, audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
        request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true, enable_nonstream: true, show_utterances: true, result_type: 'full' }
      }))))
      this.phase = this.ended ? 'finishing' : 'listening'
      this.flush(); this.emit()
    })
    socket.on('message', raw => {
      if (!valid()) return
      try {
        const { payload, final } = decodeVolcano(Buffer.from(raw as Buffer))
        const result = payload.result || {}
        const complete = final ? String(result.text || this.text) : (result.utterances || []).filter((item: any) => item.definite).map((item: any) => item.text || '').join('')
        if (complete.startsWith(this.text)) {
          const delta = complete.slice(this.text.length)
          this.text = complete
          if (delta) this.sentence(delta)
        } else if (!this.text.startsWith(complete) || final) { this.fail('豆包修订了已输出文字，请在历史中核对。'); return }
        this.draft = String(result.text || '').slice(this.text.length)
        if (final) {
          if (!this.text.trim()) { this.fail('未识别到语音 / No speech recognized'); return }
          this.phase = 'done'; this.audio = []; this.draft = ''; clearTimeout(this.timer); socket.close()
        }
        this.emit()
      } catch (error) { this.fail(error instanceof Error ? error.message : 'Invalid Volcano response') }
    })
    socket.on('unexpected-response', (_request, response) => {
      let detail = ''
      response.on('data', chunk => { if (detail.length < 4096) detail += chunk.toString() })
      response.on('end', () => {
        for (const secret of [this.config.volcanoApiKey, this.config.volcanoAccessKey].filter(Boolean)) detail = detail.split(secret).join('[redacted]')
        if (valid()) this.fail(`豆包 HTTP ${response.statusCode} (${headers['X-Api-Resource-Id']})：${detail.replace(/[\r\n]/g, ' ').slice(0, 250) || '请检查语音服务权限 / Check speech permissions'}`)
      })
      response.resume()
    })
    socket.on('error', error => { if (valid()) this.fail(`豆包连接失败 (${(error as NodeJS.ErrnoException).code || 'WebSocket'})：请检查语音 Key、资源 ID、服务权限和网络。`) })
    socket.on('close', () => { if (valid()) this.fail('豆包连接已断开 / Connection closed') })
    this.emit()
  }
  append(pcm: Uint8Array): void {
    if (this.ended || this.disposed || pcm.length % 2 || pcm.length > 32_000) return
    this.audio.push(Buffer.from(pcm)); this.pendingBytes += pcm.length; this.flush()
  }
  finish(): void {
    if (this.ended || this.disposed) return
    this.ended = true; this.durationMs = Date.now() - this.startedAt
    if (this.phase !== 'failed') { if (this.phase !== 'connecting') this.phase = 'finishing'; this.flush() }
    this.emit()
  }
  retry(): void {
    if (!this.ended || this.phase !== 'failed' || this.retried || this.disposed) return
    this.retried = true; this.sent = 0; this.pendingBytes = this.audio.reduce((sum, chunk) => sum + chunk.length, 0); this.connect()
  }
  dispose(): void {
    this.disposed = true; ++this.generation; clearTimeout(this.timer); clearTimeout(this.pump)
    this.socket?.terminate(); this.audio = []
  }
  private flush(): void {
    if (this.pump || this.phase === 'connecting' || this.phase === 'failed' || this.phase === 'done' || this.disposed) return
    let remaining = this.pendingBytes
    let batches = 0
    while (remaining >= 6400 || (this.ended && remaining > 0)) {
      if ((this.socket?.bufferedAmount || 0) > 4_000_000) { this.fail('豆包网络发送积压 / Network backpressure'); return }
      const chunks: Buffer[] = []; let bytes = 0
      while (this.sent < this.audio.length && bytes < 6400) { const chunk = this.audio[this.sent++]; chunks.push(chunk); bytes += chunk.length }
      this.socket?.send(encodeVolcano(2, Buffer.concat(chunks)))
      remaining -= bytes
      this.pendingBytes = remaining
      if (++batches >= (this.retried ? 1 : 10) && remaining > 0) {
        this.pump = setTimeout(() => { this.pump = undefined; this.flush() }, this.retried ? 40 : 0); return
      }
    }
    if (this.ended && !this.finalSent) {
      this.finalSent = true; this.socket?.send(encodeVolcano(2, Buffer.alloc(0), true))
      clearTimeout(this.timer); this.timer = setTimeout(() => this.fail('豆包收尾超时 / Finalization timed out'), 15_000)
    }
  }
  private fail(error: string): void {
    if (this.disposed || this.phase === 'done' || this.phase === 'failed') return
    this.phase = 'failed'; this.error = error; clearTimeout(this.timer); clearTimeout(this.pump); this.pump = undefined
    this.socket?.terminate(); if (this.retried) this.audio = []; this.emit()
  }
  private emit(): void {
    if (!this.disposed) this.update({ id: this.id, text: this.text, draft: this.draft, phase: this.phase, error: this.error,
      canRetry: this.ended && this.phase === 'failed' && !this.retried && this.audio.length > 0 })
  }
}
