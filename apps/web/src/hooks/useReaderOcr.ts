import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChapterRecord } from '@leitor/core'
import type { runPdfOcr } from '../pdf/ocr'

type Progress = Parameters<NonNullable<Parameters<typeof runPdfOcr>[2]['onProgress']>>[0]
type Result = Awaited<ReturnType<typeof runPdfOcr>>

export function useReaderOcr(bookId: string, onPage: (chapter: ChapterRecord) => void, stopAudio: () => void) {
  const taskRef = useRef<AbortController | null>(null)
  const [running, setRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(false)

  useEffect(() => () => {
    taskRef.current?.abort()
    taskRef.current = null
  }, [bookId])

  const start = useCallback((pages: number[], replace = false) => {
    if (!pages.length || taskRef.current) return
    const task = new AbortController()
    taskRef.current = task
    stopAudio()
    setProgress(null)
    setResult(null)
    setError(null)
    setCancelled(false)
    setRunning(true)
    setCancelling(false)

    void import('../pdf/ocr').then(({ runPdfOcr }) => runPdfOcr(bookId, pages, {
      signal: task.signal,
      replace,
      onProgress: progress => { if (taskRef.current === task) setProgress(progress) },
      onPage: chapter => { if (taskRef.current === task) onPage(chapter) },
    })).then(result => {
      if (taskRef.current === task) setResult(result)
    }).catch((error: unknown) => {
      if (taskRef.current !== task) return
      if (task.signal.aborted) setCancelled(true)
      else setError(error instanceof Error ? error.message : 'Não foi possível reconhecer o texto.')
    }).finally(() => {
      if (taskRef.current !== task) return
      taskRef.current = null
      setRunning(false)
      setCancelling(false)
    })
  }, [bookId, onPage, stopAudio])

  const cancel = useCallback(() => {
    if (!taskRef.current) return
    setCancelling(true)
    taskRef.current.abort()
  }, [])

  return { start, cancel, running, cancelling, progress, result, error, cancelled }
}
