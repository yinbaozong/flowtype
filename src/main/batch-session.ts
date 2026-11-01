import { randomUUID } from 'node:crypto'
import type { LiveUpdate } from './realtime-session'

function wav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28)
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export class BatchSession {
  readonly id = randomUUID()
  readonly startedAt = Date.now()
  text = ''
  ended = false
  durationMs = 0
  private chunks: Buffer[] = []
  private pending: Buffer | null = null
  private offset = 0
  private disposed = false
  private retried = false
  private running = false
  private failed = false
  constructor(private transcribe: (audio: Uint8Array) => Promise<string>, private update: (state: LiveUpdate) => void, private sentence: (text: string) => void) {}
  connect(): void { this.emit('listening') }
  append(pcm: Uint8Array): void { if (!this.ended && !this.disposed) this.chunks.push(Buffer.from(pcm)) }
  finish(): void {
    if (this.ended || this.disposed) return
    this.ended = true
    this.durationMs = Date.now() - this.startedAt
    this.pending = Buffer.concat(this.chunks)
    this.chunks = []
    void this.run()
  }
  retry(): void {
    if (!this.failed || this.retried || this.disposed) return
    this.retried = true
    void this.run()
  }
  dispose(): void { this.disposed = true; this.pending = null; this.chunks = [] }
  private async run(): Promise<void> {
    if (this.running || this.disposed || !this.pending) return
    this.running = true
    this.failed = false
    this.emit('finishing')
    try {
      if (this.pending.length < 8000) throw new Error('录音时间太短 / Recording too short')
      while (this.offset < this.pending.length) {
        const end = Math.min(this.offset + 60 * 32000, this.pending.length)
        const text = await this.transcribe(wav(this.pending.subarray(this.offset, end)))
        if (this.disposed) return
        this.text += text
        this.offset = end
        this.emit('finishing')
      }
      this.pending = null
      this.sentence(this.text)
      this.emit('done')
    } catch (error) {
      if (this.disposed) return
      this.failed = true
      if (this.retried) this.pending = null
      this.emit('failed', error instanceof Error ? error.message : 'Recognition failed')
    } finally { this.running = false }
  }
  private emit(phase: LiveUpdate['phase'], error?: string): void {
    if (!this.disposed) this.update({ id: this.id, text: this.text, draft: '', phase, error,
      canRetry: this.failed && !this.retried && Boolean(this.pending?.length) })
  }
}
