import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'
import { TranscriptLedger } from './transcript-ledger'

export interface LiveUpdate {
  id: string
  text: string
  draft: string
  phase: 'connecting' | 'listening' | 'finishing' | 'failed' | 'done'
  error?: string
  canRetry: boolean
}

export class RealtimeSession {
  readonly id = randomUUID()
  readonly startedAt = Date.now()
  text = ''
  ended = false
  durationMs = 0
  private ledger = new TranscriptLedger()
  private socket: WebSocket | null = null
  private ready = false
  private failed = false
  private retried = false
  private generation = 0
  private audio: Buffer[] = []
  private sent = 0
  private checkpoint = 0
  private safeBoundary = true
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private connectTimer: ReturnType<typeof setTimeout> | undefined
  private pumpTimer: ReturnType<typeof setTimeout> | undefined
  private finishSent = false
  private lastSpeechId: string | undefined
  private phase: LiveUpdate['phase'] = 'connecting'
  private error = ''
  constructor(
    private key: string,
    private language: string,
    private onUpdate: (update: LiveUpdate) => void,
    private onSentence: (text: string, confirmedIncrement?: boolean) => void,
    private diagnostic: (event: string, detail: string) => void = () => {}
  ) {}

  connect(): void {
    if (this.disposed) return
    const generation = ++this.generation
    this.failed = false
    this.ready = false
    this.finishSent = false
    this.lastSpeechId = undefined
    this.phase = 'connecting'
    this.error = ''
    const socket = new WebSocket('wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime', {
      headers: { Authorization: `Bearer ${this.key}` }, handshakeTimeout: 8_000
    })
    this.socket = socket
    const valid = (): boolean => this.generation === generation && !this.failed && !this.disposed && this.phase !== 'done'
    this.connectTimer = setTimeout(() => { if (valid()) this.fail('实时连接超时 / Connection timed out') }, 10_000)
    socket.on('open', () => {
      if (!valid()) return
      this.send({ type: 'session.update', session: {
        input_audio_format: 'pcm', sample_rate: 16000,
        input_audio_transcription: this.language === 'auto' ? {} : { language: this.language },
        turn_detection: { type: 'server_vad', threshold: 0, silence_duration_ms: 400 }
      } })
    })
    socket.on('message', raw => {
      if (!valid()) return
      try {
        const event = JSON.parse(raw.toString())
        const id = event.item_id as string
        if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') {
          this.fail(String(event.error?.message || '实时识别失败 / Recognition failed'))
          return
        }
        if (event.type === 'session.updated') {
          clearTimeout(this.connectTimer)
          this.ready = true
          this.phase = this.ended ? 'finishing' : 'listening'
          this.flush()
          if (this.ended) this.sendFinish()
        }
        if (event.type === 'conversation.item.created') this.ledger.link(event.item.id, event.previous_item_id || undefined)
        if (event.type === 'input_audio_buffer.speech_started' && id !== this.lastSpeechId) {
          this.ledger.link(id, this.lastSpeechId)
          this.lastSpeechId = id
        }
        if (event.type === 'input_audio_buffer.committed') this.ledger.link(id, event.previous_item_id || undefined)
        if (event.type === 'input_audio_buffer.speech_stopped') this.ledger.markAudioEnd(id, event.audio_end_ms)
        if (event.type === 'conversation.item.input_audio_transcription.text') this.ledger.update(id, event.text || '', event.stash || '')
        if (event.type === 'conversation.item.input_audio_transcription.completed') this.ledger.complete(id, event.transcript || '')
        for (const item of this.ledger.drain()) {
          this.text += item.text || ''
          if (item.endMs !== undefined) this.checkpoint = Math.max(this.checkpoint, Math.floor(item.endMs * 32))
          else this.safeBoundary = false
          if (item.text && !item.text.startsWith(item.delivered)) {
            this.safeBoundary = false
            this.fail('模型修订了已输出文字，最终结果已保存到历史记录。')
            return
          }
          const tail = item.text?.slice(item.delivered.length)
          if (tail) this.onSentence(tail)
        }
        for (const delta of this.ledger.drainConfirmed()) this.onSentence(delta, true)
        if (event.type === 'session.finished') {
          if (!this.text.trim()) { this.fail('未检测到可识别的语音 / No speech recognized'); return }
          clearTimeout(this.timer)
          clearTimeout(this.connectTimer)
          this.phase = 'done'
          this.audio = []
          socket.close()
        }
        this.emit()
      } catch { this.fail('实时响应格式错误 / Invalid realtime response') }
    })
    socket.on('error', error => { if (valid()) this.fail(error.message) })
    socket.on('close', code => {
      this.diagnostic('live-socket-close', `${this.id} generation=${generation} code=${code}`)
      if (valid() && this.phase !== 'done') this.fail('实时连接已断开 / Connection closed')
    })
    this.emit()
  }

  append(pcm: Uint8Array): void {
    if (this.ended || this.disposed) return
    const bytes = Buffer.from(pcm)
    if (bytes.length % 2 || bytes.length > 32_000) return
    this.audio.push(bytes)
    if (this.ready && !this.failed) this.flush()
  }

  finish(): void {
    if (this.ended || this.disposed) return
    this.ended = true
    this.durationMs = Date.now() - this.startedAt
    this.diagnostic('live-upload-pending-ms', `${this.id} ${this.audio.slice(this.sent).reduce((sum, chunk) => sum + chunk.length, 0) / 32}`)
    if (!this.failed) {
      this.phase = 'finishing'
      if (this.ready) this.sendFinish()
    }
    this.emit()
  }

  retry(): void {
    if (!this.ended || !this.failed || this.retried || !this.safeBoundary || this.disposed) return
    this.retried = true
    const all = Buffer.concat(this.audio)
    const pending = all.subarray(Math.min(this.checkpoint, all.length))
    this.audio = []
    for (let offset = 0; offset < pending.length; offset += 3200) this.audio.push(pending.subarray(offset, offset + 3200))
    this.sent = 0
    this.checkpoint = 0
    const delivered = this.ledger.pendingDelivered
    this.ledger.close()
    this.ledger = new TranscriptLedger()
    this.ledger.seedDelivered(delivered)
    this.connect()
    this.timer = setTimeout(() => this.fail('重试超时 / Retry timed out'), Math.max(15_000, pending.length / 32 + 15_000))
  }

  dispose(): void {
    this.disposed = true
    ++this.generation
    clearTimeout(this.timer)
    clearTimeout(this.connectTimer)
    clearTimeout(this.pumpTimer)
    this.socket?.terminate()
    this.ledger.close()
    this.audio = []
  }

  private send(value: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ event_id: randomUUID(), ...value }))
  }
  private flush(): void {
    if (this.pumpTimer || this.failed || !this.ready) return
    // Capture already runs at realtime speed. A second per-frame timer accumulates delay.
    const budget = this.retried ? 3200 : 32_000
    let transmitted = 0
    while (this.sent < this.audio.length && transmitted < budget) {
      if ((this.socket?.bufferedAmount || 0) > 4_000_000) { this.fail('网络发送积压 / Network backpressure'); return }
      const chunks: Buffer[] = []
      let bytes = 0
      while (this.sent < this.audio.length && bytes < 3200) {
        const chunk = this.audio[this.sent++]
        chunks.push(chunk)
        bytes += chunk.length
      }
      this.send({ type: 'input_audio_buffer.append', audio: Buffer.concat(chunks).toString('base64') })
      transmitted += bytes
    }
    if (this.sent < this.audio.length) this.pumpTimer = setTimeout(() => {
      this.pumpTimer = undefined
      this.flush()
    }, this.retried ? 20 : 0)
    else if (this.ended && !this.finishSent && !this.failed) {
      this.finishSent = true
      this.send({ type: 'session.finish' })
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.fail('识别收尾超时 / Finalization timed out'), 15_000)
    }
  }
  private sendFinish(): void { this.flush() }
  private fail(message: string): void {
    if (this.failed || this.phase === 'done') return
    this.failed = true
    this.ready = false
    this.phase = 'failed'
    this.error = message
    clearTimeout(this.timer)
    clearTimeout(this.connectTimer)
    clearTimeout(this.pumpTimer)
    this.pumpTimer = undefined
    this.socket?.terminate()
    if (this.retried) this.audio = []
    this.emit()
  }
  private emit(): void {
    if (this.disposed) return
    this.onUpdate({ id: this.id, text: this.text, draft: this.ledger.draft, phase: this.phase,
      error: this.error, canRetry: this.failed && this.ended && !this.retried && this.safeBoundary && this.audio.length > 0 })
  }
}
