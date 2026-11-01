export interface CaptureHooks {
  frame(id: string, pcm: Uint8Array, level: number): void
  started(id: string): void
  finished(id: string): void
  ready(value: boolean): void
}

const processorSource = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.id = null; this.chunk = []; this.sum = 0; this.count = 0; this.position = 0;
    this.port.onmessage = ({data}) => {
      if (data.type === 'start') {
        this.id = data.id; this.chunk = []; this.sum = 0; this.count = 0; this.position = 0;
        this.port.postMessage({ started: this.id });
      } else if (data.type === 'stop' && this.id === data.id) {
        this.flush(); this.id = null; this.port.postMessage({ done: data.id });
      }
    };
  }
  flush() { if (this.chunk.length) { this.port.postMessage({ id: this.id, pcm: new Int16Array(this.chunk) }); this.chunk = []; } }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (this.id && input) for (const value of input) {
      this.sum += value; this.count++; this.position += 16000;
      if (this.position >= sampleRate) {
        this.position -= sampleRate;
        this.chunk.push(Math.round(Math.max(-1, Math.min(1, this.sum / this.count)) * 32767));
        this.sum = 0; this.count = 0;
        if (this.chunk.length === 320) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);`

export class AudioCapture {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processorLoading: Promise<void> | null = null
  private preparation: Promise<void> | null = null
  private generation = 0
  private active: string | null = null
  private stopped: (() => void) | null = null
  constructor(private hooks: CaptureHooks) {}

  preload(): Promise<void> {
    if (this.context?.state !== 'closed' && this.node) return Promise.resolve()
    if (this.processorLoading) return this.processorLoading
    const generation = this.generation
    const load = this.createProcessor(generation)
    this.processorLoading = load
    void load.finally(() => { if (this.processorLoading === load) this.processorLoading = null }).catch(() => undefined)
    return load
  }

  private async createProcessor(generation: number): Promise<void> {
    const context = new AudioContext({ latencyHint: 'interactive' })
    try {
      const url = URL.createObjectURL(new Blob([processorSource], { type: 'text/javascript' }))
      try { await context.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
      if (generation !== this.generation) throw new Error('Audio preparation canceled')
      const node = new AudioWorkletNode(context, 'pcm-capture')
      node.port.onmessage = event => {
        if (event.data.started && event.data.started === this.active) this.hooks.started(event.data.started)
        if (event.data.id === this.active && event.data.pcm) {
          const samples = event.data.pcm as Int16Array
          let peak = 0
          for (const value of samples) peak = Math.max(peak, Math.abs(value) / 32768)
          this.hooks.frame(this.active!, new Uint8Array(samples.buffer), Math.min(1, peak * 5))
        }
        if (event.data.done === this.active) this.stopped?.()
      }
      const gain = context.createGain()
      gain.gain.value = 0
      node.connect(gain).connect(context.destination)
      await context.resume()
      if (generation !== this.generation) throw new Error('Audio preparation canceled')
      this.context = context; this.node = node
    } catch (error) { await context.close().catch(() => undefined); throw error }
  }

  async standby(): Promise<void> {
    ++this.generation
    this.preparation = null
    this.source?.disconnect(); this.source = null
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null
    this.hooks.ready(false)
    await this.preload()
  }

  prepare(): Promise<void> {
    if (this.preparation) return this.preparation
    if (this.stream?.getAudioTracks()[0]?.readyState === 'live' && this.context?.state !== 'closed' && this.node) return Promise.resolve()
    const generation = ++this.generation
    const prepare = this.initialize(generation)
    this.preparation = prepare
    void prepare.finally(() => { if (this.preparation === prepare) this.preparation = null }).catch(() => undefined)
    return prepare
  }

  private async initialize(generation: number): Promise<void> {
    this.source?.disconnect(); this.source = null
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null
    let expired = false
    let timer = 0
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    try {
      stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(value => {
          if (expired || generation !== this.generation) { value.getTracks().forEach(track => track.stop()); throw new Error('Microphone request expired') }
          return value
        }),
        new Promise<never>((_resolve, reject) => { timer = window.setTimeout(() => { expired = true; reject(new Error('麦克风启动超时 / Microphone timed out')) }, 8000) })
      ])
      stream.getAudioTracks().forEach(track => { track.enabled = false })
      await this.preload()
      context = this.context
      if (generation !== this.generation) throw new Error('Microphone preparation canceled')
      if (!context || !this.node) throw new Error('Audio processor unavailable')
      this.source = context.createMediaStreamSource(stream)
      this.source.connect(this.node)
      await context.resume()
      if (generation !== this.generation) throw new Error('Microphone preparation canceled')
      this.stream = stream
      this.hooks.ready(true)
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop())
      await context?.close().catch(() => undefined)
      this.hooks.ready(false)
      throw error
    } finally { clearTimeout(timer) }
  }

  async start(id: string): Promise<void> {
    await this.prepare()
    if (!this.node || !this.context || !this.stream) throw new Error('Microphone unavailable')
    await this.context.resume()
    this.active = id
    this.node.port.postMessage({ type: 'start', id })
    this.stream.getAudioTracks().forEach(track => { track.enabled = true })
  }

  async stop(id: string): Promise<void> {
    if (this.active !== id || !this.node) { this.hooks.finished(id); return }
    let timeout = false
    await new Promise<void>(resolve => {
      const timer = window.setTimeout(() => { timeout = true; resolve() }, 500)
      this.stopped = () => { clearTimeout(timer); resolve() }
      this.node!.port.postMessage({ type: 'stop', id })
    })
    this.stopped = null
    this.active = null
    this.stream?.getAudioTracks().forEach(track => { track.enabled = false })
    if (timeout) await this.release()
    this.hooks.finished(id)
  }

  async release(): Promise<void> {
    ++this.generation
    this.preparation = null
    this.processorLoading = null
    this.active = null
    this.stopped?.()
    this.stopped = null
    this.hooks.ready(false)
    await this.closeResources()
  }

  private async closeResources(): Promise<void> {
    const context = this.context
    this.node?.disconnect()
    this.source?.disconnect(); this.source = null
    this.stream?.getTracks().forEach(track => track.stop())
    this.stream = null; this.context = null; this.node = null
    if (context?.state !== 'closed') await context?.close().catch(() => undefined)
  }
}
