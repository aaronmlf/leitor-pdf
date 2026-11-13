import { useEffect, useId, useRef, useState } from 'react'
import type { BookmarkRecord, ChapterRecord, OutlineEntry } from '@leitor/core'
import type { BookMatch } from '../hooks/useBookSearch'
import { foldSearchText } from '../hooks/useBookSearch'
import type { useBookmarks } from '../hooks/useBookmarks'
import type { ReaderBook, useReader } from '../hooks/useReader'
import type { useReaderAppearance } from '../hooks/useReaderAppearance'

type ReaderState = ReturnType<typeof useReader>

function OutlineList({ items, navigate }: { items: OutlineEntry[]; navigate: (entry: OutlineEntry) => void }) {
  return (
    <ul className="reader-item-list reader-outline-list">
      {items.map((entry, index) => (
        <li key={index}>
          <button type="button" className="reader-list-action" onClick={() => navigate(entry)}>
            {entry.title}
          </button>
          {!!entry.children?.length && <OutlineList items={entry.children} navigate={navigate} />}
        </li>
      ))}
    </ul>
  )
}

export function ContentsPanel({
  book,
  chapterIndex,
  navigate,
}: {
  book: ReaderBook
  chapterIndex: number
  navigate: (chapterIndex: number, paragraphIndex?: number) => void
}) {
  const [page, setPage] = useState('')
  const [pageError, setPageError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const isPdf = book.format === 'pdf'
  const id = useId()
  const folded = foldSearchText(filter.trim())
  const chapters = book.chapters.filter(chapter => {
    if (!folded) return true
    return foldSearchText(chapter.title).includes(folded) || (
      isPdf && foldSearchText(chapter.pageLabel ?? '').includes(folded)
    )
  })

  return (
    <>
      {isPdf && (
        <form className="reader-panel-form" onSubmit={event => {
          event.preventDefault()
          const chapter = book.chapters.find(item => item.pageNumber === Number(page)) ??
            book.chapters.find(item => item.pageLabel?.toLowerCase() === page.trim().toLowerCase())
          if (!page.trim() || !chapter) {
            setPageError('Informe o número ou rótulo de uma página do PDF.')
            return
          }
          setPageError(null)
          navigate(chapter.chapterIndex)
        }}>
          <label htmlFor={id}>Ir à página</label>
          <div className="reader-inline-actions">
            <input id={id} type="text" value={page} onChange={event => setPage(event.target.value)} />
            <button type="submit" className="btn">Ir</button>
          </div>
          {pageError && <p className="reader-panel-error" role="alert">{pageError}</p>}
        </form>
      )}
      {!!book.outline?.length && (
        <nav className="reader-panel-section" aria-label="Sumário do livro">
          <OutlineList items={book.outline} navigate={entry => navigate(entry.chapterIndex, entry.paragraphIndex)} />
        </nav>
      )}
      <nav className="reader-panel-section" aria-label={isPdf ? 'Páginas do PDF' : 'Capítulos do livro'}>
        {!!book.outline?.length && <h3>{isPdf ? 'Páginas' : 'Capítulos'}</h3>}
        {book.chapters.length > 12 && (
          <label className="reader-field">
            {isPdf ? 'Filtrar páginas' : 'Filtrar capítulos'}
            <input type="search" value={filter} onChange={event => setFilter(event.target.value)} />
          </label>
        )}
        <ul className="reader-item-list">
          {chapters.map(chapter => (
            <li key={chapter.chapterIndex}>
              <button
                type="button"
                className="reader-list-action"
                aria-current={chapter.chapterIndex === chapterIndex ? 'location' : undefined}
                onClick={() => navigate(chapter.chapterIndex)}
              >
                {chapter.title}
                {chapter.pageLabel && chapter.pageLabel !== String(chapter.pageNumber) && (
                  <span className="muted">Rótulo {chapter.pageLabel}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {!chapters.length && <p className="muted">Nenhum resultado.</p>}
      </nav>
    </>
  )
}

export function SearchPanel({
  chapters, query, setQuery, matches, searching, activeIndex, navigate, previousLocation, returnToLocation, viewResult,
}: {
  chapters: ChapterRecord[]
  query: string
  setQuery: (query: string) => void
  matches: BookMatch[]
  searching: boolean
  activeIndex: number
  navigate: (index: number) => void
  previousLocation: boolean
  returnToLocation: () => void
  viewResult?: () => void
}) {
  const firstVisible = Math.max(0, Math.min(activeIndex - 5, matches.length - 12))
  const visible = matches.slice(firstVisible, firstVisible + 12)
  const count = matches.length
  return (
    <>
      <label className="reader-field">
        Palavra ou trecho
        <input
          type="search"
          data-panel-focus
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter' || count === 0) return
            event.preventDefault()
            navigate(activeIndex < 0 ? (event.shiftKey ? count - 1 : 0) :
              (activeIndex + (event.shiftKey ? -1 : 1) + count) % count)
          }}
        />
      </label>
      <div className="reader-inline-actions">
        <button
          type="button" className="btn" disabled={count === 0}
          onClick={() => navigate(activeIndex < 0 ? count - 1 : (activeIndex - 1 + count) % count)}
        >
          Anterior
        </button>
        <button
          type="button" className="btn" disabled={count === 0}
          onClick={() => navigate(activeIndex < 0 ? 0 : (activeIndex + 1) % count)}
        >
          Próximo
        </button>
      </div>
      {viewResult && <button type="button" className="btn reader-standalone-action" onClick={viewResult}>Ver no texto</button>}
      {previousLocation && (
        <button type="button" className="btn reader-standalone-action" onClick={returnToLocation}>
          Voltar à posição anterior à busca
        </button>
      )}
      {query.trim() && (
        <p role="status" className="muted">
          {searching ? 'Buscando no livro…' : count > 0
            ? activeIndex >= 0 ? `Resultado ${activeIndex + 1} de ${count}`
              : `${count} ${count === 1 ? 'resultado' : 'resultados'}`
            : 'Nenhum resultado.'}
        </p>
      )}
      <ul className="reader-item-list" aria-label="Resultados da busca">
        {visible.map((match, index) => {
          const resultIndex = firstVisible + index
          const before = Math.max(0, match.start - 35)
          const after = Math.min(match.paragraph.length, match.start + match.length + 65)
          return (
            <li key={resultIndex}>
              <button
                type="button"
                className="reader-list-action"
                aria-current={resultIndex === activeIndex ? 'location' : undefined}
                onClick={() => navigate(resultIndex)}
              >
                <span className="muted">{chapters[match.chapterIndex]?.title}</span>
                <span>
                  {before > 0 ? '…' : ''}{match.paragraph.slice(before, match.start)}
                  <mark>{match.paragraph.slice(match.start, match.start + match.length)}</mark>
                  {match.paragraph.slice(match.start + match.length, after)}{after < match.paragraph.length ? '…' : ''}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

export function BookmarksPanel({
  bookmarks, reader, protectedDocument, currentBookmark, add, navigate,
}: {
  bookmarks: ReturnType<typeof useBookmarks>
  reader: ReaderState
  protectedDocument: boolean
  currentBookmark?: BookmarkRecord
  add: () => void
  navigate: (bookmark: BookmarkRecord) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const id = useId()
  const formRef = useRef<HTMLInputElement>(null)
  const renameButtons = useRef(new Map<string, HTMLButtonElement>())
  useEffect(() => {
    if (editing) formRef.current?.focus()
  }, [editing])

  function closeEditor() {
    const bookmarkId = editing
    setEditing(null)
    if (bookmarkId) window.requestAnimationFrame(() => renameButtons.current.get(bookmarkId)?.focus())
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-primary reader-standalone-action"
        disabled={!reader.sentences[reader.sentenceIndex] || bookmarks.loading || bookmarks.saving || !!currentBookmark}
        onClick={add}
      >
        {currentBookmark ? 'Frase marcada' : 'Marcar frase atual'}
      </button>
      {bookmarks.error && (
        <div className="reader-panel-section">
          <p className="reader-panel-error" role="alert">{bookmarks.error}</p>
          <button type="button" className="btn reader-standalone-action" onClick={bookmarks.retry}>
            Tentar novamente
          </button>
        </div>
      )}
      {bookmarks.loading ? <p className="muted" role="status">Abrindo marcadores…</p>
        : !bookmarks.bookmarks.length && !bookmarks.error && <p className="muted">Nenhuma frase marcada.</p>}
      <ul className="reader-item-list" aria-label="Marcadores salvos">
        {bookmarks.bookmarks.map(bookmark => (
          <li key={bookmark.id} className="reader-bookmark">
            <button type="button" className="reader-list-action" onClick={() => navigate(bookmark)}>
              {bookmark.label}
              <span className="muted">{reader.book?.chapters[bookmark.chapterIndex]?.title}</span>
            </button>
            {editing === bookmark.id ? (
              <form className="reader-panel-form" onSubmit={event => {
                event.preventDefault()
                const name = label.trim()
                if (name) void bookmarks.rename(bookmark.id, name).then(saved => { if (saved) closeEditor() })
              }}>
                <label htmlFor={id}>Nome do marcador</label>
                <input id={id} ref={formRef} maxLength={120} required value={label} onChange={event => setLabel(event.target.value)} />
                <div className="reader-inline-actions">
                  <button type="submit" className="btn btn-primary" disabled={!label.trim() || bookmarks.saving}>Salvar</button>
                  <button type="button" className="btn" disabled={bookmarks.saving} onClick={closeEditor}>Cancelar</button>
                </div>
              </form>
            ) : (
              <div className="reader-inline-actions reader-marker-actions">
                {!protectedDocument && (
                  <button
                    type="button"
                    className="btn"
                    ref={node => {
                      if (node) renameButtons.current.set(bookmark.id, node)
                      else renameButtons.current.delete(bookmark.id)
                    }}
                    aria-label={`Renomear marcador: ${bookmark.label}`}
                    disabled={bookmarks.saving}
                    onClick={() => {
                      setLabel(bookmark.label)
                      setEditing(bookmark.id)
                    }}
                  >
                    Renomear
                  </button>
                )}
                <button
                  type="button" className="btn" disabled={bookmarks.saving}
                  aria-label={`Excluir marcador: ${bookmark.label}`}
                  onClick={() => void bookmarks.remove(bookmark.id)}
                >
                  Excluir
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}

export function AppearancePanel({ settings }: { settings: ReturnType<typeof useReaderAppearance> }) {
  const { appearance, update, loaded, error } = settings
  return (
    <>
      <label className="reader-field">
        Tema
        <select value={appearance.theme} disabled={!loaded} onChange={event => {
          const value = event.target.value as typeof appearance.theme
          update({ theme: value })
        }}>
          <option value="system">Do aparelho</option>
          <option value="light">Claro</option>
          <option value="dark">Escuro</option>
          <option value="sepia">Sépia</option>
        </select>
      </label>
      <label className="reader-field">
        Tamanho do texto
        <select value={appearance.textSize} disabled={!loaded} onChange={event => {
          const value = event.target.value as typeof appearance.textSize
          update({ textSize: value })
        }}>
          <option value="small">Pequeno</option>
          <option value="normal">Normal</option>
          <option value="large">Grande</option>
          <option value="extra-large">Muito grande</option>
        </select>
      </label>
      <label className="reader-field">
        Espaço entre linhas
        <select value={appearance.spacing} disabled={!loaded} onChange={event => {
          const value = event.target.value as typeof appearance.spacing
          update({ spacing: value })
        }}>
          <option value="compact">Compacto</option>
          <option value="normal">Normal</option>
          <option value="relaxed">Amplo</option>
        </select>
      </label>
      <label className="reader-check">
        <input type="checkbox" checked={appearance.follow} disabled={!loaded}
          onChange={event => update({ follow: event.target.checked })}
        />
        Acompanhar narração
      </label>
      {error && <p className="reader-panel-error" role="alert">{error}</p>}
    </>
  )
}

function sizeLabel(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1_048_576))} MB`
}

export function VoicesPanel({ reader }: { reader: ReaderState }) {
  const [query, setQuery] = useState('')
  const terms = foldSearchText(query.trim()).replace(/[_-]/g, ' ').split(/\s+/).filter(Boolean)
  const isPiper = reader.engineId === 'piper'
  const filteredVoices = reader.piperCandidates.filter(voice => {
    if (!terms.length) return voice.lang.toLowerCase().startsWith('pt') || reader.downloadedIds.includes(voice.id)
    const haystack = foldSearchText(`${voice.name} ${voice.lang} ${voice.quality} ${voice.id}`).replace(/[_-]/g, ' ')
    return terms.every(term => haystack.includes(term))
  })
  return (
    <>
      <label className="reader-field">
        Motor de voz
        <select value={reader.engineId} disabled={!reader.engineLoaded}
          onChange={event => reader.setEngine(event.target.value === 'piper' ? 'piper' : 'system')}>
          <option value="system">Voz do sistema</option>
          <option value="piper">Piper</option>
        </select>
      </label>
      <label className="reader-field">
        {isPiper ? 'Voz baixada' : 'Voz do sistema'}
        <select
          value={reader.voiceId ?? ''}
          disabled={reader.voicesLoading || !reader.hasVoices}
          onChange={event => reader.setVoice(event.target.value || null)}
        >
          <option value="">{isPiper ? 'Escolher voz…' : 'Padrão do aparelho'}</option>
          {reader.voices.map(voice => (
            <option key={voice.id} value={voice.id}>
              {voice.name} ({voice.lang}){'localService' in voice && voice.localService === false ? ' · online' : ''}
            </option>
          ))}
        </select>
      </label>
      {reader.voicesLoading && <p className="muted" role="status">Carregando vozes…</p>}
      {reader.voiceError && (
        <div className="reader-panel-section">
          <p className="reader-panel-error" role="alert">{reader.voiceError}</p>
          <button type="button" className="btn reader-standalone-action" onClick={reader.retryVoices}>Tentar novamente</button>
        </div>
      )}
      {!reader.engineSupported && (
        <p className="reader-panel-error">Este aparelho não oferece suporte a este motor de voz.</p>
      )}
      {!isPiper && !reader.voicesLoading && !reader.hasVoices && (
        <button type="button" className="btn reader-standalone-action" onClick={() => reader.setEngine('piper')}>Experimentar o Piper</button>
      )}
      {isPiper && (
        <>
          <p className="muted">A voz precisa de internet para o primeiro download. Depois, use o Piper offline.</p>
          <label className="reader-field">
            Buscar voz
            <input type="search" placeholder="Nome ou idioma" value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          {reader.sampleStatus && (
            <div className="reader-inline-actions">
              <p className="muted" role="status">{reader.sampleStatus}</p>
              <button type="button" className="btn" onClick={() => reader.stopSample()}>Parar amostra</button>
            </div>
          )}
          {!reader.voicesLoading && !reader.voiceError && reader.engineSupported && !filteredVoices.length && (
            <p className="muted">Nenhuma voz encontrada.</p>
          )}
          <ul className="reader-item-list" aria-label="Catálogo Piper" aria-busy={reader.voicesLoading}>
            {filteredVoices.map(voice => {
              const downloaded = reader.downloadedIds.includes(voice.id)
              const progress = reader.downloadProgress[voice.id]
              const error = reader.downloadErrors[voice.id]
              const selected = reader.voiceId === voice.id
              return (
                <li key={voice.id} className="reader-voice">
                  <div>
                    <strong>{voice.name}</strong>
                    <p className="muted">
                      {voice.lang} · {voice.quality}{voice.sizeBytes > 0 ? ` · ${sizeLabel(voice.sizeBytes)}` : ''}
                    </p>
                    {error && <p className="reader-panel-error" role="alert">Falha no download. {error}</p>}
                    {progress !== undefined && (
                      <progress aria-label={`Download de ${voice.name}`} max={1} value={progress ?? undefined} />
                    )}
                  </div>
                  <div className="reader-inline-actions">
                    {downloaded ? (
                      <>
                        <button type="button" className="btn" disabled={reader.voicesLoading}
                          onClick={() => reader.playSample(voice.id)} aria-label={`Ouvir amostra de ${voice.name}`}>
                          Amostra
                        </button>
                        <button type="button" className={selected ? 'btn' : 'btn btn-primary'}
                          disabled={selected || reader.voicesLoading} onClick={() => reader.setVoice(voice.id)}>
                          {selected ? 'Em uso' : 'Usar'}
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-primary"
                        disabled={progress !== undefined || reader.voicesLoading}
                        onClick={() => void reader.downloadVoice(voice.id)}>
                        {progress === null ? 'Baixando…' : progress !== undefined
                          ? `Baixando ${Math.round(progress * 100)}%` : error ? 'Tentar novamente' : 'Baixar'}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </>
  )
}
