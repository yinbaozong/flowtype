import { useEffect } from 'react'
import { AudioCapture } from './audio-capture'

export function Capture(): null {
  useEffect(() => {
    const capture = new AudioCapture({
      frame: (id, pcm, level) => { window.flowApi.sendPcm(id, pcm); window.flowApi.sendAudioLevel(level) },
      started: id => window.flowApi.reportCaptureStarted(id),
      finished: id => window.flowApi.finishPcm(id),
      ready: ready => window.flowApi.reportCaptureStatus(ready)
    })
    let pending = Promise.resolve()
    const unsubscribe = window.flowApi.onCapture(command => {
      pending = pending.then(async () => {
        if (command.type === 'prepare') await capture.prepare()
        else if (command.type === 'standby') await capture.standby()
        else if (command.type === 'release') await capture.release()
        else if (command.type === 'start') await capture.start(command.id)
        else await capture.stop(command.id)
      }).catch(async error => {
        await capture.release()
        if (command.type === 'start' || command.type === 'stop') {
          await window.flowApi.reportRecordingError(error instanceof Error ? error.message : 'Microphone failed', command.id)
          window.flowApi.finishPcm(command.id)
        }
      })
    })
    window.flowApi.reportCaptureReady()
    return () => { unsubscribe(); void capture.release() }
  }, [])
  return null
}
