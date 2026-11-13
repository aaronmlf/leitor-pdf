import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import type { LibraryBook } from '@leitor/core'
import { isPdfFile, useLibrary } from '../hooks/useLibrary'
import type { PdfSession } from '../pdf/importPdf'
import './library.css'

const acceptedBooks = '.epub,application/epub+zip,.txt,text/plain,.pdf,application/pdf'
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })
const formats = ['epub', 'txt', 'pdf'] as const
type BookFormat = typeof formats[number]
type Sort = 'activity' | 'title' | 'imported'

function searchable(value: string): string {
  return value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '')
}

function sizeLabel(bytes: number): string {
  return bytes < 1024 ** 2
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(bytes / 1024 ** 2)} MB`
}

function Cover({ blob }: { blob: Blob | null }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  return url
    ? <img className="cover" src={url} alt="" />
    : <span className="cover cover-fallback" aria-hidden>📖</span>
}

function LibraryDialog({ title, onClose, children }: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const id = useId()
  const ref = useRef<HTMLDialogElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.showModal()
    return () => {
      dialog.close()
      returnFocus.current?.focus({ preventScroll: true })
    }
  }, [])

  return (
    <dialog
      className="library-dialog"
      ref={ref}
      aria-labelledby={id}
      onCancel={event => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id={id}>{title}</h2>
      {children}
    </dialog>
  )
}

type PasswordRequest = {
  name: string
  incorrect: boolean
  finish: (password: string) => void
  cancel: () => void
}

function PasswordDialog({ request }: { request: PasswordRequest }) {
  const id = useId()
  return (
    <LibraryDialog title="Senha do PDF" onClose={request.cancel}>
      <p>{request.name}</p>
      <p>O original continua criptografado e a senha será pedida novamente ao reabrir.</p>
      {request.incorrect && <p className="notice notice-error" role="alert">Senha incorreta. Tente novamente.</p>}
      <form onSubmit={event => {
        event.preventDefault()
        const password = new FormData(event.currentTarget).get('password')
        if (typeof password === 'string') request.finish(password)
      }}>
        <label className="library-field" htmlFor={id}>Senha
          <input id={id} autoFocus required name="password" type="password" autoComplete="off" />
        </label>
        <div className="library-actions">
          <button className="btn" type="button" onClick={request.cancel}>Cancelar</button>
          <button className="btn btn-primary" type="submit">Desbloquear</button>
        </div>
      </form>
    </LibraryDialog>
  )
}

export default function Library({ onOpen, lastBookId }: {
  onOpen: (bookId: string, session?: PdfSession) => void
  lastBookId?: string
}) {
  const [password, setPassword] = useState<PasswordRequest | null>(null)
  const requestPassword = useCallback((name: string, incorrect: boolean, controller: AbortController) => {
    return new Promise<string | null>(resolve => {
      const { signal } = controller
      if (signal.aborted) {
        resolve(null)
        return
      }
      const cancel = () => finish(null)
      const finish = (value: string | null) => {
        signal.removeEventListener('abort', cancel)
        setPassword(null)
        resolve(value)
      }
      signal.addEventListener('abort', cancel, { once: true })
      setPassword({ name, incorrect, finish, cancel: () => controller.abort() })
    })
  }, [])
  const {
    library, reload, busy, error, status, imports, dismissImports, importFiles, importDemo, retryImport,
    cancelImport, openBook, openingPdf, cancelOpen, remove, backup, dismissBackup, exportBackup,
    previewBackup, restoreBackup,
  } = useLibrary(requestPassword, onOpen)
  const inputRef = useRef<HTMLInputElement>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)
  const restoreButtonRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const returnBookRef = useRef<HTMLButtonElement>(null)
  const returned = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [confirmBook, setConfirmBook] = useState<LibraryBook | null>(null)
  const [query, setQuery] = useState('')
  const [format, setFormat] = useState<BookFormat | 'all'>('all')
  const [sort, setSort] = useState<Sort>('activity')

  const books = library.status === 'ready' ? library.books : []
  const continueBook = books.reduce<LibraryBook | null>((recent, book) => {
    if (!book.progress) return recent
    return !recent?.progress || book.progress.updatedAt > recent.progress.updatedAt ? book : recent
  }, null)
  const availableFormats = formats.filter(value => books.some(book => book.format === value))
  const activeFormat = availableFormats.some(value => value === format) ? format : 'all'
  const terms = searchable(query.trim()).split(/\s+/).filter(Boolean)
  const visibleBooks = books.filter(book => {
    if (activeFormat !== 'all' && book.format !== activeFormat) return false
    const haystack = searchable(`${book.title} ${book.author}`)
    return terms.every(term => haystack.includes(term))
  }).sort((a, b) => {
    if (sort === 'title') return collator.compare(a.title, b.title)
    if (sort === 'imported') return b.addedAt - a.addedAt || collator.compare(a.title, b.title)
    return b.lastActivityAt - a.lastActivityAt || collator.compare(a.title, b.title)
  })

  useEffect(() => {
    if (!lastBookId || returned.current || library.status === 'loading') return
    returned.current = true
    const target = returnBookRef.current ?? headingRef.current
    target?.focus()
  }, [lastBookId, library.status])

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragging(false)
    if (!busy && !confirmBook && !backup && event.dataTransfer.files.length > 0) {
      importFiles(event.dataTransfer.files)
    }
  }

  const showPicker = () => inputRef.current?.click()
  const showBusyMessage = busy === 'export' || busy === 'preview' || busy === 'restore'
  const ready = library.status === 'ready'

  return (
    <main
      className={`page library${dragging ? ' dragging' : ''}`}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        if (!busy) setDragging(true)
      }}
      onDragLeave={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setDragging(false)
        }
      }}
      onDrop={handleDrop}
    >
      <div className="library-inner">
        <header className="page-header">
          <h1 ref={headingRef} tabIndex={-1}>Leitor</h1>
          {books.length > 0 && <button className="btn btn-primary" onClick={showPicker} disabled={!!busy}>Importar livro</button>}
        </header>

        <input ref={inputRef} type="file" accept={acceptedBooks} multiple hidden onChange={event => {
          if (event.target.files) importFiles(event.target.files)
          event.target.value = ''
        }} />
        <input ref={backupInputRef} type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden onChange={event => {
          const file = event.target.files?.[0]
          if (file) void previewBackup(file)
          event.target.value = ''
        }} />

        {!confirmBook && !backup && error && <p className="notice notice-error" role="alert">{error}</p>}
        {status && <p className="notice" role="status">{status}</p>}
        {!backup && showBusyMessage && (
          <p className="notice" role="status">
            {busy === 'export' ? 'Preparando backup…' : busy === 'preview' ? 'Verificando backup…' : 'Restaurando biblioteca…'}
          </p>
        )}
        {library.status === 'loading' && <p className="muted" role="status">Abrindo biblioteca…</p>}
        {library.status === 'error' && (
          <section className="library-block">
            <h2>Biblioteca indisponível</h2>
            <p className="notice notice-error" role="alert">{library.message}</p>
            <button className="btn" onClick={reload} disabled={!!busy}>Tentar novamente</button>
          </section>
        )}

        {imports.length > 0 && (
          <section className="library-block" aria-label="Importações">
            <div className="library-section-header">
              <h2>Importações</h2>
              {!busy && <button className="btn" onClick={dismissImports}>Fechar resultados</button>}
            </div>
            <ul className="library-imports">
              {imports.map(item => {
                const canCancel = item.status === 'importing' && item.file && isPdfFile(item.file)
                return (
                  <li key={item.id}>
                    <div className="library-import-text">
                      <strong>{item.name}</strong>
                      <div role={item.status === 'failed' ? 'alert' : 'status'}>
                        {item.status === 'queued' && 'Aguardando'}
                        {item.status === 'importing' && (item.progress ? 'Extraindo texto…' : 'Importando…')}
                        {item.status === 'complete' && 'Concluído'}
                        {item.status === 'failed' && <span className="library-import-error">{item.message}</span>}
                        {item.status === 'cancelled' && 'Cancelado'}
                      </div>
                      {item.progress && <PageProgress page={item.progress.page} total={item.progress.total} />}
                    </div>
                    {canCancel && <button className="btn" onClick={() => cancelImport(item.id)} aria-label={`Cancelar importação de ${item.name}`}>Cancelar</button>}
                    {(item.status === 'failed' || item.status === 'cancelled') && (
                      <button className="btn" onClick={() => retryImport(item)} disabled={!!busy} aria-label={`Tentar novamente a importação de ${item.name}`}>Tentar novamente</button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {openingPdf && (
          <section className="library-block" aria-label="Abertura de PDF">
            <p role="status">Abrindo “{openingPdf.name}”…</p>
            {openingPdf.progress && <PageProgress page={openingPdf.progress.page} total={openingPdf.progress.total} />}
            <button className="btn" onClick={cancelOpen}>Cancelar abertura</button>
          </section>
        )}

        {ready && books.length === 0 && (
          <section className="empty library-empty">
            <h2 className="empty-title">Sua biblioteca está vazia</h2>
            <button className="btn btn-primary" onClick={showPicker} disabled={!!busy}>Importar livro</button>
            <p className="muted">EPUB, TXT e PDF com texto selecionável.</p>
            <button className="btn" onClick={importDemo} disabled={!!busy}>Experimentar com o livro de demonstração</button>
          </section>
        )}

        {continueBook && (
          <section className="library-block library-continue">
            <h2>Continuar lendo</h2>
            <div className="library-continue-card">
              <Cover blob={continueBook.cover} />
              <div className="book-info">
                <strong className="book-title">{continueBook.title}</strong>
                {continueBook.positionLabel && <span className="muted">{continueBook.positionLabel}</span>}
                {continueBook.progressPercent !== null && <span className="muted">Cerca de {Math.round(continueBook.progressPercent)}% lido</span>}
              </div>
              <button className="btn btn-primary" onClick={() => openBook(continueBook)} disabled={!!busy} aria-label={`Continuar lendo ${continueBook.title}`}>Continuar</button>
            </div>
          </section>
        )}

        {books.length > 0 && (
          <section className="library-block">
            <h2>Meus livros</h2>
            <div className="library-filters">
              <label className="library-field">Buscar por título ou autor
                <input type="search" value={query} onChange={event => setQuery(event.target.value)} />
              </label>
              <label className="library-field">Formato
                <select value={activeFormat} onChange={event => setFormat(event.target.value as typeof format)}>
                  <option value="all">Todos</option>
                  {availableFormats.map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}
                </select>
              </label>
              <label className="library-field">Ordenar por
                <select value={sort} onChange={event => setSort(event.target.value as Sort)}>
                  <option value="activity">Atividade recente</option>
                  <option value="title">Título</option>
                  <option value="imported">Data de importação</option>
                </select>
              </label>
            </div>
            {visibleBooks.length === 0 ? <p className="muted" role="status">Nenhum livro encontrado.</p> : (
              <ul className="book-list">
                {visibleBooks.map(book => (
                  <li key={book.id} className="book-card">
                    <button ref={book.id === lastBookId ? returnBookRef : null} className="book-open" onClick={() => openBook(book)} disabled={!!busy}>
                      <Cover blob={book.cover} />
                      <span className="book-info">
                        <span className="book-title">{book.title}</span>
                        {book.author && <span className="book-author">{book.author}</span>}
                        <span className="book-meta">
                          {book.format && `${book.format.toUpperCase()} · `}
                          {book.chapterCount} {book.format === 'pdf'
                            ? book.chapterCount === 1 ? 'página' : 'páginas'
                            : book.chapterCount === 1 ? 'capítulo' : 'capítulos'}
                          {book.protected && ' · Com senha'}
                        </span>
                      </span>
                    </button>
                    <button className="icon-btn" title="Excluir" aria-label={`Excluir ${book.title}`} onClick={() => setConfirmBook(book)} disabled={!!busy}>🗑</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {ready && (
          <section className="library-block library-backup">
            <h2>Backup</h2>
            <div className="library-actions">
              <button className="btn" disabled={!!busy} onClick={() => void exportBackup()}>Exportar biblioteca</button>
              <button ref={restoreButtonRef} className="btn" disabled={!!busy} onClick={() => backupInputRef.current?.click()}>Restaurar biblioteca</button>
            </div>
            <p className="muted">Os livros ficam neste aparelho. O processamento da voz depende do motor escolhido. O Piper usa vozes baixadas.</p>
          </section>
        )}
        {((ready && books.length === 0) || dragging) && (
          <p className={`drop-hint library-drop${dragging ? ' active' : ''}`}>Solte arquivos EPUB, TXT ou PDF aqui.</p>
        )}
      </div>

      {confirmBook && (
        <LibraryDialog title="Excluir livro" onClose={() => { if (!busy) setConfirmBook(null) }}>
          <p>“{confirmBook.title}” será removido junto com a posição de leitura e os marcadores.</p>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <div className="library-actions">
            <button className="btn" autoFocus onClick={() => setConfirmBook(null)} disabled={!!busy}>Cancelar</button>
            <button className="btn btn-danger" disabled={!!busy} onClick={() => {
              void remove(confirmBook).then(success => {
                if (success) {
                  setConfirmBook(null)
                  requestAnimationFrame(() => headingRef.current?.focus())
                }
              })
            }}>{busy ? 'Excluindo…' : 'Excluir livro'}</button>
          </div>
        </LibraryDialog>
      )}
      {backup && (
        <LibraryDialog title="Restaurar biblioteca" onClose={() => { if (!busy) dismissBackup() }}>
          <p>{backup.file.name}</p>
          <dl className="library-backup-summary">
            <div><dt>Livros no backup</dt><dd>{backup.summary.books}</dd></div>
            <div><dt>Livros novos</dt><dd>{backup.summary.newBooks}</dd></div>
            <div><dt>Livros a mesclar</dt><dd>{backup.summary.existingBooks}</dd></div>
            <div><dt>Marcadores</dt><dd>{backup.summary.bookmarks}</dd></div>
            <div><dt>Espaço estimado</dt><dd>{sizeLabel(backup.summary.requiredBytes)}</dd></div>
          </dl>
          <p>A mesclagem preserva a posição mais recente de cada livro e os marcadores distintos.</p>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <div className="library-actions">
            <button className="btn" autoFocus disabled={!!busy} onClick={dismissBackup}>Cancelar</button>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => {
              void restoreBackup().then(success => {
                if (success) requestAnimationFrame(() => restoreButtonRef.current?.focus())
              })
            }}>
              {busy ? 'Restaurando…' : 'Mesclar com minha biblioteca'}
            </button>
          </div>
        </LibraryDialog>
      )}
      {password && <PasswordDialog request={password} />}
    </main>
  )
}

function PageProgress({ page, total }: { page: number; total: number }) {
  const label = `Preparando página ${page} de ${total}`
  return (
    <div className="library-progress">
      <progress value={page} max={total} aria-label="Páginas processadas" />
      <span>{label}</span>
    </div>
  )
}
