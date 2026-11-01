import { useEffect, useMemo, useState } from 'react'
import type { OverlayState } from '../../shared/types'

export function Overlay(): React.JSX.Element {
  const previewRecording = window.location.hash === '#overlay-recording'
  const [state, setState] = useState<OverlayState>(
    previewRecording ? { mode: 'recording', message: '正在聆听' } : { mode: 'idle' }
  )
  const [level, setLevel] = useState(previewRecording ? 0.72 : 0.08)
  const [phase, setPhase] = useState(0)

  useEffect(() => window.flowApi.onOverlayState(setState), [])
  useEffect(() => window.flowApi.onAudioLevel(setLevel), [])
  useEffect(() => {
    window.flowApi.reportOverlayHeartbeat()
    const timer = window.setInterval(() => window.flowApi.reportOverlayHeartbeat(), 2_000)
    return () => window.clearInterval(timer)
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
    return <div className="idle-pill" aria-label="拖动 FlowType 悬浮条"><span /></div>
  }

  return (
    <div className={`flow-bar flow-bar--${state.mode}`}>
      <div className="waveform" aria-hidden="true">
        {bars.map((height, index) => (
          <i key={index} style={{ height: `${Math.max(2, height * 24)}px` }} />
        ))}
      </div>
    </div>
  )
}
