interface RecordingResult {
  audio: Uint8Array
  durationMs: number
  mimeType: string
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function downsample(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return input
  const ratio = sourceRate / targetRate
  const output = new Float32Array(Math.round(input.length / ratio))
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.round(index * ratio)
    const end = Math.min(Math.round((index + 1) * ratio), input.length)
    let sum = 0
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) sum += input[sourceIndex]
    output[index] = sum / Math.max(1, end - start)
  }
  return output
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeString = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += 2
  }
  return new Uint8Array(buffer)
}

export class AudioRecorder {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private silentGain: GainNode | null = null
  private chunks: Float32Array[] = []
  private startedAt = 0
  private peakLevel = 0

  async prepare(): Promise<void> {
    await this.ensureAudio()
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = false
    })
  }

  async start(onLevel: (level: number) => void): Promise<void> {
    if (this.processor) return
    this.chunks = []
    this.startedAt = Date.now()
    this.peakLevel = 0
    await this.ensureAudio()
    const context = this.context
    const source = this.source
    if (!context || !source) throw new Error('无法初始化麦克风')
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = true
    })
    await context.resume()
    this.processor = context.createScriptProcessor(1024, 1, 1)
    this.silentGain = context.createGain()
    this.silentGain.gain.value = 0
    this.processor.onaudioprocess = (event) => {
      const samples = event.inputBuffer.getChannelData(0)
      this.chunks.push(new Float32Array(samples))
      let sum = 0
      for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index]
      const level = Math.sqrt(sum / samples.length)
      this.peakLevel = Math.max(this.peakLevel, level)
      onLevel(Math.min(1, level * 20))
    }
    source.connect(this.processor)
    this.processor.connect(this.silentGain)
    this.silentGain.connect(context.destination)
  }

  async stop(): Promise<RecordingResult> {
    if (!this.context) throw new Error('录音尚未开始')
    const sourceRate = this.context.sampleRate
    const durationMs = Date.now() - this.startedAt
    const chunks = this.chunks
    const peakLevel = this.peakLevel
    await this.finishCapture()
    if (!chunks.length || durationMs < 250) throw new Error('录音时间太短，请按住快捷键后再说话')
    if (peakLevel < 0.0015) throw new Error('没有检测到麦克风声音，请检查 Windows 麦克风输入设备')
    const samples = downsample(mergeChunks(chunks), sourceRate, 16000)
    return { audio: encodeWav(samples, 16000), durationMs, mimeType: 'audio/wav' }
  }

  async cancel(): Promise<void> {
    this.chunks = []
    await this.finishCapture()
  }

  private async ensureAudio(): Promise<void> {
    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
    }
    if (!this.context) this.context = new AudioContext()
    if (!this.source) this.source = this.context.createMediaStreamSource(this.stream)
  }

  private async finishCapture(): Promise<void> {
    this.processor?.disconnect()
    this.silentGain?.disconnect()
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = false
    })
    this.processor = null
    this.silentGain = null
  }
}
