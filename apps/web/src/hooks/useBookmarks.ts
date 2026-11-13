import { useEffect, useRef, useState } from 'react'
import { addBookmark, deleteBookmark, listBookmarks, renameBookmark } from '@leitor/core'
import type { BookmarkRecord } from '@leitor/core'

export function useBookmarks(bookId: string) {
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const savingRef = useRef(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void listBookmarks(bookId).then(
      list => { if (active) setBookmarks(list) },
      () => { if (active) setError('Não foi possível abrir os marcadores.') },
    ).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [bookId, loadAttempt])

  async function changeBookmarks(change: () => Promise<unknown>) {
    if (loading || savingRef.current) return false
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      await change()
      setBookmarks(await listBookmarks(bookId))
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar os marcadores.')
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return {
    bookmarks,
    loading,
    saving,
    error,
    retry: () => setLoadAttempt(attempt => attempt + 1),
    add: (chapter: number, sentence: number, text: string) =>
      changeBookmarks(() => addBookmark(bookId, chapter, sentence, text)),
    remove: (id: string) => changeBookmarks(() => deleteBookmark(id)),
    rename: (id: string, label: string) => changeBookmarks(() => renameBookmark(id, label)),
  }
}
