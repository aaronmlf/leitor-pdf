import { useCallback, useEffect, useRef, useState } from 'react'
import { setBackgroundAudioTimer } from '../native/backgroundAudio'

export type TimerMinutes = 15 | 30 | 60
type Timer = { kind: 'time'; deadline: number } | { kind: 'chapter'; chapterIndex: number }

export function useSleepTimer(onEnd: (afterChapter: boolean) => void) {
  const [timer, setTimer] = useState<Timer | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const current = useRef<Timer | null>(null)

  const set = useCallback((next: Timer | null) => {
    current.current = next
    setTimer(next)
    if (next?.kind === 'time') setRemaining(Math.max(0, Math.ceil((next.deadline - Date.now()) / 1000)))
    void setBackgroundAudioTimer(next?.kind === 'time' ? next.deadline : null)
  }, [])

  const expire = useCallback(() => {
    const active = current.current
    if (!active) return
    set(null)
    onEnd(active.kind === 'chapter')
    setNotice('A narração foi pausada pelo temporizador.')
  }, [onEnd, set])

  useEffect(() => {
    if (timer?.kind !== 'time') return
    const activeTimer = timer
    function tick() {
      if (current.current !== activeTimer) return
      const seconds = Math.ceil((activeTimer.deadline - Date.now()) / 1000)
      if (seconds <= 0) expire()
      else setRemaining(seconds)
    }
    const ticker = window.setInterval(tick, 1000)
    const timeout = window.setTimeout(tick, Math.max(0, timer.deadline - Date.now()))
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(ticker)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [expire, timer])

  useEffect(() => () => { void setBackgroundAudioTimer(null) }, [])

  const cancel = useCallback(() => {
    set(null)
    setNotice('Temporizador cancelado.')
  }, [set])

  const clear = useCallback(() => {
    if (!current.current) return
    set(null)
    setNotice(null)
  }, [set])

  const startForMinutes = useCallback((minutes: TimerMinutes) => {
    set({ kind: 'time', deadline: Date.now() + minutes * 60 * 1000 })
    setNotice(null)
  }, [set])

  const startForChapter = useCallback((chapterIndex: number) => {
    set({ kind: 'chapter', chapterIndex })
    setNotice(null)
  }, [set])

  const checkChapterEnd = useCallback((chapterIndex: number): boolean => {
    const active = current.current
    if (active?.kind !== 'chapter' || active.chapterIndex !== chapterIndex) return false
    expire()
    return true
  }, [expire])

  const onChapterJump = useCallback((chapterIndex: number) => {
    const active = current.current
    if (active?.kind === 'chapter' && active.chapterIndex !== chapterIndex) cancel()
  }, [cancel])

  const syncNative = useCallback(() => {
    const active = current.current
    void setBackgroundAudioTimer(active?.kind === 'time' ? active.deadline : null)
  }, [])

  const expireIfDue = useCallback((nativeDeadline?: number) => {
    const active = current.current
    if (active?.kind !== 'time') return
    if (nativeDeadline === undefined ? active.deadline <= Date.now() : active.deadline === nativeDeadline) expire()
  }, [expire])

  return {
    timer, remaining, notice, cancel, startForMinutes, startForChapter, checkChapterEnd, onChapterJump,
    syncNative, expireIfDue, clear,
  }
}
