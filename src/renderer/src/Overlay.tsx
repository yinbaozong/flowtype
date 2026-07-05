import { useEffect, useMemo, useRef, useState } from 'react'
import type { OverlayState } from '../../shared/types'
import { AudioRecorder } from './audio'

export function Overlay(): React.JSX.Element {
  const previewRecording = window.location.hash === '#overlay-recording'
  const [state, setState] = useState<OverlayState>(
    previewRecording ? { mode: 'recording', message: '正在聆听' } : { mode: 'idle' }
  )
  const [level, setLevel] = useState(previewRecording ? 0.72 : 0.08)
  const [phase, setPhase] = useState(0)
  const recorder = useRef(new AudioRecorder())
  const dragging = useRef(false)
  const dragProps = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>): void => {
      dragging.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
      window.flowApi.startOverlayDrag(event.screenX, event.screenY)
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>): void => {
      if (dragging.current) window.flowApi.moveOverlayDrag(event.screenX, event.screenY)
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>): void => {
      dragging.current = false
      event.currentTarget.releasePointerCapture(event.pointerId)
      window.flowApi.endOverlayDrag()
    },
    onPointerCancel: (): void => {
      dragging.current = false
      window.flowApi.endOverlayDrag()
    }
  }

  useEffect(() => window.flowApi.onOverlayState(setState), [])
  useEffect(() => window.flowApi.onAudioLevel(setLevel), [])
  useEffect(() => {
    void recorder.current.prepare().catch(() => undefined)
  }, [])
  useEffect(() => {
    if (state.mode !== 'recording') return
    let frame = 0
    let animation = 0
    const animate = (): void => {
      frame += 0.16
      setPhase(frame)
      animation = requestAnimationFrame(animate)
    }
    animation = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animation)
  }, [state.mode])
  useEffect(
    () =>
      window.flowApi.onRecordingCommand((command) => {
        if (command === 'start') {
          void recorder.current.start((audioLevel) => window.flowApi.sendAudioLevel(audioLevel)).catch((error: unknown) => {
            const message =
              error instanceof DOMException && error.name === 'NotAllowedError'
                ? '请允许 FlowType 使用麦克风'
                : error instanceof Error
                  ? error.message
                  : '无法启动麦克风'
            return window.flowApi.reportRecordingError(message)
          })
        } else if (command === 'stop') {
          void recorder.current
            .stop()
            .then(window.flowApi.transcribe)
            .catch((error: unknown) =>
              window.flowApi.reportRecordingError(error instanceof Error ? error.message : '录音处理失败')
            )
        } else {
          void recorder.current.cancel()
        }
      }),
    []
  )

  const bars = useMemo(
    () =>
      Array.from({ length: 15 }, (_, index) => {
        const distance = Math.abs(index - 7) / 7
        const rhythm = 0.58 + Math.sin(index * 1.35 + phase) * 0.24 + Math.sin(index * 0.52 - phase * 1.6) * 0.15
        const breathing = 0.24 + (Math.sin(phase * 0.72 + index * 0.42) + 1) * 0.08
        return Math.max(0.2, (breathing + level * 0.82) * (1.16 - distance * 0.38) * rhythm)
      }),
    [level, phase]
  )

  if (state.mode === 'idle') {
    return <div className="idle-pill" aria-label="拖动 FlowType 悬浮条" {...dragProps}><span /></div>
  }

  return (
    <div className={`flow-bar flow-bar--${state.mode}`} {...dragProps}>
      <div className="waveform" aria-hidden="true">
        {bars.map((height, index) => (
          <i key={index} style={{ height: `${Math.max(2, height * 24)}px` }} />
        ))}
      </div>
    </div>
  )
}
