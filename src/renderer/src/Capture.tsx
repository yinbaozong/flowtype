import { useEffect } from 'react'

const processorSource = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.chunk = []; this.sum = 0; this.count = 0; this.position = 0;
    this.port.onmessage = () => { this.flush(); this.port.postMessage({ done: true }); }; }
  flush() { if (this.chunk.length) { this.port.postMessage({ pcm: new Int16Array(this.chunk) }); this.chunk = []; } }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) for (const value of input) {
      this.sum += value; this.count++; this.position += 16000;
      if (this.position >= sampleRate) {
        this.position -= sampleRate;
        this.chunk.push(Math.round(Math.max(-1, Math.min(1, this.sum / this.count)) * 32767));
        this.sum = 0; this.count = 0;
        if (this.chunk.length === 1600) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);`

export function Capture(): null {
  useEffect(() => {
    let context: AudioContext | null = null
    let stream: MediaStream | null = null
    let node: AudioWorkletNode | null = null
    let pending = Promise.resolve()
    let active = ''
    const release = async (): Promise<void> => {
      node?.disconnect()
      node = null
      stream?.getTracks().forEach(track => track.stop())
      stream = null
      await context?.close().catch(() => undefined)
      context = null
    }
    const unsubscribe = window.flowApi.onCapture(command => {
      pending = pending.then(async () => {
        if (command.type === 'start') {
          await release()
          active = command.id
          let expired = false
          let timeout = 0
          try {
            stream = await Promise.race([
              navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(value => {
                if (expired) { value.getTracks().forEach(track => track.stop()); throw new Error('Microphone request expired') }
                return value
              }),
              new Promise<never>((_resolve, reject) => { timeout = window.setTimeout(() => { expired = true; reject(new Error('麦克风启动超时 / Microphone timed out')) }, 8000) })
            ])
          } finally { clearTimeout(timeout) }
          context = new AudioContext()
          const url = URL.createObjectURL(new Blob([processorSource], { type: 'text/javascript' }))
          try { await context.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
          node = new AudioWorkletNode(context, 'pcm-capture')
          const id = active
          node.port.onmessage = event => {
            if (event.data.pcm) {
              const samples = event.data.pcm as Int16Array
              window.flowApi.sendPcm(id, new Uint8Array(samples.buffer))
              let peak = 0
              for (const value of samples) peak = Math.max(peak, Math.abs(value) / 32768)
              window.flowApi.sendAudioLevel(Math.min(1, peak * 5))
            }
          }
          const gain = context.createGain()
          gain.gain.value = 0
          context.createMediaStreamSource(stream).connect(node).connect(gain).connect(context.destination)
          await context.resume()
        } else if (active === command.id) {
          const captureNode = node
          if (captureNode) await new Promise<void>(resolve => {
            const timer = window.setTimeout(resolve, 500)
            captureNode.port.addEventListener('message', event => { if (event.data.done) { clearTimeout(timer); resolve() } }, { once: false })
            captureNode.port.postMessage('flush')
          })
          await release()
          window.flowApi.finishPcm(command.id)
          active = ''
        }
      }).catch(async error => {
        await release()
        await window.flowApi.reportRecordingError(error instanceof Error ? error.message : 'Microphone failed')
        window.flowApi.finishPcm(command.id)
      })
    })
    window.flowApi.reportCaptureReady()
    return () => { unsubscribe(); void release() }
  }, [])
  return null
}
