import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteBook,
  exportLibraryBackup,
  importBook,
  listLibrary,
  previewLibraryBackup,
  restoreLibraryBackup,
} from '@leitor/core'
import type { BackupPreview, LibraryBook } from '@leitor/core'
import { saveBackup } from '../native/saveBackup'
import { importPdf, openProtectedPdf } from '../pdf/importPdf'
import type { PdfSession } from '../pdf/importPdf'

export const DEMO_EPUB_URL = '/leitor-demo.epub'

type ImportStatus = 'queued' | 'importing' | 'complete' | 'failed' | 'cancelled'
type Job = 'import' | 'open' | 'delete' | 'export' | 'preview' | 'restore'

type ImportProgress = { page: number; total: number }

interface ImportItem {
  id: number
  name: string
  status: ImportStatus
  file?: File
  message?: string
  progress?: ImportProgress
}

type LibraryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; books: LibraryBook[] }

function messageFrom(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error) || !cause.message) return fallback
  if (cause.name === 'QuotaExceededError') return 'Espaço insuficiente para concluir a operação.'
  if (/central directory|corrupted zip|cannot find zip|encrypted zip/i.test(cause.message)) {
    return 'O arquivo EPUB está corrompido ou não pôde ser aberto.'
  }
  return cause.message
}

export function isPdfFile(file: File): boolean {
  return /\.pdf$/i.test(file.name) || (!/\.(epub|txt)$/i.test(file.name) && file.type === 'application/pdf')
}

export function useLibrary(
  requestPassword: (name: string, incorrect: boolean, controller: AbortController) => Promise<string | null>,
  onOpen: (id: string, session?: PdfSession) => void,
) {
  const [library, setLibrary] = useState<LibraryState>({ status: 'loading' })
  const [busy, setBusy] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [imports, setImports] = useState<ImportItem[]>([])
  const [backup, setBackup] = useState<{ file: File; summary: BackupPreview } | null>(null)
  const [openingPdf, setOpeningPdf] = useState<{ name: string; progress?: ImportProgress } | null>(null)
  const nextImportId = useRef(0)
  const jobRef = useRef<Job | null>(null)
  const activeImport = useRef<{ id: number; controller: AbortController } | null>(null)
  const openingController = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const refreshVersion = useRef(0)

  const refresh = useCallback(async (showLoading = false) => {
    const version = ++refreshVersion.current
    if (showLoading) setLibrary({ status: 'loading' })
    try {
      const books = await listLibrary()
      if (mounted.current && version === refreshVersion.current) setLibrary({ status: 'ready', books })
    } catch (cause) {
      const message = messageFrom(cause, 'Tente novamente.')
      if (mounted.current && version === refreshVersion.current) setLibrary({ status: 'error', message })
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => {
      mounted.current = false
      activeImport.current?.controller.abort()
      openingController.current?.abort()
    }
  }, [refresh])

  const run = useCallback(async (job: Job, operation: () => Promise<void>) => {
    if (jobRef.current) return false
    jobRef.current = job
    setBusy(job)
    setError(null)
    setStatus(null)
    try {
      await operation()
      return true
    } catch (cause) {
      if (mounted.current) setError(messageFrom(cause, 'A operação falhou. Tente novamente.'))
      return false
    } finally {
      jobRef.current = null
      if (mounted.current) setBusy(null)
    }
  }, [])

  const updateImport = useCallback((id: number, changes: Partial<ImportItem>) => {
    setImports(items => items.map(item => item.id === id ? { ...item, ...changes } : item))
  }, [])

  const processImports = useCallback(async (items: ImportItem[]) => {
    for (const item of items) {
      if (!mounted.current) break
      const controller = new AbortController()
      activeImport.current = { id: item.id, controller }
      updateImport(item.id, { status: 'importing', message: undefined, progress: undefined })
      try {
        const file = item.file
        if (!file) {
          const response = await fetch(DEMO_EPUB_URL, { signal: controller.signal })
          if (!response.ok) throw new Error('Livro de demonstração não encontrado.')
          await importBook(await response.blob(), item.name)
        } else if (isPdfFile(file)) {
          await importPdf(file, {
            signal: controller.signal,
            onProgress: (page, total) => updateImport(item.id, { progress: { page, total } }),
            onPassword: incorrect => requestPassword(item.name, incorrect, controller),
          })
        } else if (/\.(epub|txt)$/i.test(file.name) || ['application/epub+zip', 'text/plain'].includes(file.type)) {
          await importBook(file, file.name)
        } else {
          throw new Error('Formato não suportado. Use EPUB, TXT ou PDF.')
        }
        updateImport(item.id, { status: 'complete', file: undefined, progress: undefined })
      } catch (cause) {
        const cancelled = controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')
        updateImport(item.id, {
          status: cancelled ? 'cancelled' : 'failed',
          message: cancelled ? undefined : messageFrom(cause, 'Falha ao importar.'),
          progress: undefined,
        })
      } finally {
        activeImport.current = null
      }
    }
    if (mounted.current) await refresh()
  }, [refresh, requestPassword, updateImport])

  const importFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files)
    if (list.length === 0) return
    void run('import', async () => {
      const items = list.map(file => ({ id: ++nextImportId.current, name: file.name, status: 'queued' as const, file }))
      setImports(items)
      await processImports(items)
    })
  }, [processImports, run])

  const importDemo = useCallback(() => {
    void run('import', async () => {
      const item = { id: ++nextImportId.current, name: 'Livro de demonstração', status: 'queued' as const }
      setImports([item])
      await processImports([item])
    })
  }, [processImports, run])

  const retryImport = useCallback((item: ImportItem) => {
    void run('import', () => processImports([item]))
  }, [processImports, run])

  const cancelImport = useCallback((id: number) => {
    if (activeImport.current?.id === id) activeImport.current.controller.abort()
  }, [])

  const openBook = useCallback((book: LibraryBook) => {
    if (jobRef.current) return
    if (!book.protected) {
      onOpen(book.id)
      return
    }

    void run('open', async () => {
      const controller = new AbortController()
      openingController.current = controller
      setOpeningPdf({ name: book.title })
      try {
        const session = await openProtectedPdf(book, {
          signal: controller.signal,
          onPassword: incorrect => requestPassword(book.title, incorrect, controller),
          onProgress: (page, total) => setOpeningPdf({ name: book.title, progress: { page, total } }),
        })
        if (!controller.signal.aborted && mounted.current) onOpen(book.id, session)
      } catch (cause) {
        if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) {
          setStatus('Abertura do PDF cancelada.')
        } else {
          throw cause
        }
      } finally {
        openingController.current = null
        setOpeningPdf(null)
      }
    })
  }, [onOpen, requestPassword, run])

  const remove = useCallback((book: LibraryBook) => run('delete', async () => {
    await deleteBook(book.id)
    setStatus(`“${book.title}” foi excluído.`)
    await refresh()
  }), [refresh, run])

  const exportBackup = useCallback(() => run('export', async () => {
    const zip = await exportLibraryBackup()
    const date = new Intl.DateTimeFormat('sv-SE').format(new Date())
    const saved = await saveBackup(zip, `leitor-biblioteca-${date}.zip`)
    setStatus(saved ? 'Exportação da biblioteca concluída.' : 'Exportação cancelada.')
  }), [run])

  const previewBackup = useCallback((file: File) => run('preview', async () => {
    setBackup(null)
    setBackup({ file, summary: await previewLibraryBackup(file) })
  }), [run])

  const restoreBackup = useCallback(() => {
    if (!backup) return Promise.resolve(false)
    return run('restore', async () => {
      const result = await restoreLibraryBackup(backup.file)
      setBackup(null)
      setStatus(`Biblioteca restaurada. ${result.importedBooks} novos e ${result.mergedBooks} mesclados.`)
      await refresh()
    })
  }, [backup, refresh, run])

  return {
    library,
    reload: () => refresh(true),
    busy,
    error,
    status,
    imports,
    dismissImports: () => setImports([]),
    importFiles,
    importDemo,
    retryImport,
    cancelImport,
    openBook,
    openingPdf,
    cancelOpen: () => openingController.current?.abort(),
    remove,
    backup,
    dismissBackup: () => setBackup(null),
    exportBackup,
    previewBackup,
    restoreBackup,
  }
}
