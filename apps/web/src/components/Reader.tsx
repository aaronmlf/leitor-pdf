import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BookmarkRecord, Sentence } from '@leitor/core'
import { resolveReadingPosition } from '@leitor/core'
import { useBookSearch } from '../hooks/useBookSearch'
import { useBookmarks } from '../hooks/useBookmarks'
import { useReader } from '../hooks/useReader'
import type { Position, ReaderSource } from '../hooks/useReader'
import { useReaderAppearance } from '../hooks/useReaderAppearance'
import { useReaderOcr } from '../hooks/useReaderOcr'
import { AppearancePanel, BookmarksPanel, ContentsPanel, formatTimer, SearchPanel, TimerPanel, VoicesPanel } from './ReaderPanels'
import ReaderOcrPanel from './ReaderOcrPanel'
import './reader.css'

const panelLabels = {
  contents: 'Sumário',
  search: 'Buscar no livro',
  bookmarks: 'Marcadores',
  appearance: 'Aparência',
  voices: 'Voz',
  timer: 'Temporizador',
  ocr: 'Reconhecer texto',
}
type Panel = keyof typeof panelLabels

const rates = [0.75, 1, 1.25, 1.5, 1.75, 2]
const playbackLabels = {
  idle: '',
  preparing: 'Preparando áudio…',
  playing: 'Reproduzindo',
  paused: 'Pausado',
  finished: 'Fim do livro',
}

function groupSentences(sentences: Sentence[]) {
  const paragraphs = new Map<number, { text: string; index: number; offset: number }[]>()
  sentences.forEach(({ text, paragraphIndex }, index) => {
    const paragraph = paragraphs.get(paragraphIndex)
    const last = paragraph?.at(-1)
    const item = { text, index, offset: last ? last.offset + last.text.length + 1 : 0 }
    if (paragraph) paragraph.push(item)
    else paragraphs.set(paragraphIndex, [item])
  })
  return [...paragraphs.values()]
}

export default function Reader({
  bookId,
  bookOverride,
  onBack,
}: {
  bookId: string
  bookOverride?: ReaderSource
  onBack: () => void
}) {
  const reader = useReader(bookId, bookOverride)
  const settings = useReaderAppearance()
  const bookmarks = useBookmarks(bookId)
  const ocr = useReaderOcr(bookId, reader.applyOcrPage, reader.stopReading)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [query, setQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(-1)
  const [searchOrigin, setSearchOrigin] = useState<Position | null>(null)
  const [manualScroll, setManualScroll] = useState(false)
  const [scrollRequest, setScrollRequest] = useState(0)
  const [bookmarkStatus, setBookmarkStatus] = useState<string | null>(null)
  const [navigationNotice, setNavigationNotice] = useState<string | null>(null)
  const { matches, searching } = useBookSearch(reader.book?.chapters, query)
  const panelRef = useRef<HTMLElement>(null)
  const panelTrigger = useRef<HTMLButtonElement | null>(null)
  const contentRef = useRef<HTMLElement>(null)
  const currentSentenceRef = useRef<HTMLSpanElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const quickMarkerRef = useRef<HTMLButtonElement>(null)
  const lastScrollRequest = useRef(0)
  const focusReading = useRef(false)
  const restoreFocus = useRef(false)
  const paragraphs = useMemo(() => groupSentences(reader.sentences), [reader.sentences])
  const resolvedBookmarks = useMemo(() => {
    const chapters = reader.book?.chapters
    return chapters ? bookmarks.bookmarks.map(bookmark => ({
      bookmark,
      location: resolveReadingPosition(chapters, bookmark),
    })) : []
  }, [bookmarks.bookmarks, reader.book])
  const currentBookmark = resolvedBookmarks.find(({ location }) =>
    location.chapterIndex === reader.chapterIndex && location.sentenceIndex === reader.sentenceIndex,
  )?.bookmark

  useEffect(() => {
    if (!bookmarkStatus) return
    const timer = window.setTimeout(() => setBookmarkStatus(null), 2600)
    return () => window.clearTimeout(timer)
  }, [bookmarkStatus])

  const openedBookId = reader.book?.id
  useEffect(() => {
    if (openedBookId) titleRef.current?.focus()
  }, [openedBookId])

  useLayoutEffect(() => {
    if (panel) {
      const target = panelRef.current?.querySelector<HTMLElement>('[data-panel-focus]') ?? panelRef.current
      target?.focus()
    } else if (restoreFocus.current) {
      restoreFocus.current = false
      const trigger = panelTrigger.current
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
      else titleRef.current?.focus({ preventScroll: true })
    }
  }, [panel])

  useLayoutEffect(() => {
    if (focusReading.current && !panel) {
      focusReading.current = false
      const target = currentSentenceRef.current ?? contentRef.current
      target?.focus({ preventScroll: true })
    }
    const explicit = lastScrollRequest.current !== scrollRequest
    const content = contentRef.current
    if (!content || (panel && content.offsetParent === null)) return
    lastScrollRequest.current = scrollRequest
    if (!explicit && (!settings.appearance.follow || manualScroll)) return
    const current = currentSentenceRef.current
    if (current) {
      const viewport = content.getBoundingClientRect()
      const line = current.getBoundingClientRect()
      if (explicit || line.top < viewport.top + 18 || line.bottom > viewport.bottom - 18) {
        content.scrollBy({ top: line.top + line.height / 2 - viewport.top - viewport.height / 2, behavior: 'instant' })
      }
    }
    else if (explicit) content.scrollTop = 0
  }, [
    manualScroll, panel, reader.chapterIndex, reader.sentenceIndex, scrollRequest,
    settings.appearance.follow, settings.appearance.textSize, settings.appearance.spacing,
  ])

  function showPanel(next: Panel, trigger: HTMLButtonElement) {
    if (next === panel) {
      closePanel()
      return
    }
    if (panel === 'voices' && reader.sampleStatus) reader.stopSample()
    panelTrigger.current = trigger
    setPanel(next)
  }

  function closePanel(focusDestination = false) {
    if (panel === 'voices' && reader.sampleStatus) reader.stopSample()
    restoreFocus.current = !focusDestination
    focusReading.current = focusDestination
    setPanel(null)
  }

  function centerSentence() {
    setManualScroll(false)
    setScrollRequest(request => request + 1)
  }

  function navigateTo(chapterIndex: number, paragraphIndex?: number) {
    setSearchOrigin(null)
    setNavigationNotice(null)
    if (paragraphIndex === undefined) reader.gotoChapter(chapterIndex)
    else reader.gotoParagraph(chapterIndex, paragraphIndex)
    centerSentence()
    closePanel(true)
  }

  function navigateBookmark(bookmark: BookmarkRecord) {
    const location = resolvedBookmarks.find(item => item.bookmark.id === bookmark.id)?.location
    if (!location) return
    setSearchOrigin(null)
    reader.seek(location.chapterIndex, location.sentenceIndex)
    setNavigationNotice(location.approximate ? 'O marcador foi aberto na posição mais próxima.' : null)
    centerSentence()
    closePanel(true)
  }

  function navigateMatch(index: number) {
    const result = matches[index]
    if (!result) return
    if (!searchOrigin) setSearchOrigin({
      chapterIndex: reader.chapterIndex,
      sentenceIndex: reader.sentenceIndex,
    })
    if (reader.playing) reader.pause()
    setMatchIndex(index)
    reader.seek(result.chapterIndex, result.sentenceIndex, false)
    setNavigationNotice(null)
    centerSentence()
  }

  function returnToSearchOrigin() {
    if (!searchOrigin) return
    if (reader.playing) reader.pause()
    reader.seek(searchOrigin.chapterIndex, searchOrigin.sentenceIndex, false)
    setSearchOrigin(null)
    setMatchIndex(-1)
    centerSentence()
    if (panel) closePanel(true)
    else focusReading.current = true
  }

  function addCurrentBookmark() {
    const sentence = reader.sentences[reader.sentenceIndex]
    if (!sentence || currentBookmark) return
    const text = sentence.text
    const label = bookOverride
      ? `Página ${reader.book?.chapters[reader.chapterIndex]?.pageNumber ?? reader.chapterIndex + 1} · frase ${reader.sentenceIndex + 1}`
      : text.length > 120 ? `${text.slice(0, 117).trimEnd()}…` : text
    void bookmarks.add(reader.chapterIndex, reader.sentenceIndex, label).then(saved => {
      if (saved) setBookmarkStatus('Marcador salvo.')
      else if (panel !== 'bookmarks') showBookmarksError()
    })
  }

  function showBookmarksError() {
    const trigger = quickMarkerRef.current
    if (trigger) showPanel('bookmarks', trigger)
  }

  function moveSentence(direction: -1 | 1, focus = false) {
    if (direction === -1) reader.prevSentence()
    else reader.nextSentence()
    if (focus) focusReading.current = true
    setSearchOrigin(null)
    setMatchIndex(-1)
    setNavigationNotice(null)
    centerSentence()
  }

  function chooseSentence(index: number) {
    reader.seek(reader.chapterIndex, index)
    setSearchOrigin(null)
    setMatchIndex(-1)
    setNavigationNotice(null)
    centerSentence()
  }

  if (!reader.book) {
    return (
      <main className="page">
        {reader.bookError ? (
          <>
            <p className="notice notice-error" role="alert">{reader.bookError}</p>
            <button type="button" className="btn" onClick={reader.retryBook}>Tentar novamente</button>{' '}
            <button type="button" className="btn" onClick={onBack}>Voltar para a biblioteca</button>
          </>
        ) : <p className="muted" role="status">Abrindo livro…</p>}
      </main>
    )
  }

  const { book } = reader
  const chapter = book.chapters[reader.chapterIndex]
  const isPdf = book.format === 'pdf'
  const canOcr = isPdf && !book.protected
  const chapterPosition = isPdf ? chapter?.pageNumber ?? reader.chapterIndex + 1 : reader.chapterIndex + 1
  const section = chapter ? `${isPdf ? 'Página' : 'Capítulo'} ${chapterPosition} de ${book.chapters.length}` : ''
  const activeMatch = matches[matchIndex]
  const setupMessage = ocr.running ? null : !reader.hasReadableText ? 'Este documento não tem texto para narrar.'
    : reader.voicesLoading ? 'Carregando vozes…'
    : !reader.engineSupported || reader.voiceError ? 'A voz selecionada está indisponível.'
    : !reader.hasVoices && reader.engineId === 'system' ? 'Nenhuma voz do sistema foi encontrada.'
    : reader.engineId === 'piper' && !reader.voiceId ? 'Baixe e escolha uma voz do Piper.'
    : null
  const playLabel = reader.playback === 'preparing' ? 'Cancelar reprodução'
    : reader.playback === 'playing' ? 'Pausar' : 'Ouvir'

  return (
    <div
      className="reader reader-workspace"
      data-theme={settings.appearance.theme}
      data-text-size={settings.appearance.textSize}
      data-spacing={settings.appearance.spacing}
      onKeyDown={event => {
        if (event.key !== 'Escape' || !panel) return
        event.preventDefault()
        closePanel()
      }}
    >
      <header className="reader-toolbar">
        <button type="button" className="btn reader-back" onClick={onBack} aria-label="Voltar para a biblioteca">
          <span aria-hidden="true">←</span>
        </button>
        <div className="reader-identification">
          <h1 ref={titleRef} tabIndex={-1} title={book.title}>{book.title}</h1>
          {section && <p className="muted">{section}</p>}
        </div>
        <nav className="reader-tools" aria-label="Ferramentas de leitura">
          {(Object.keys(panelLabels) as Panel[]).filter(item => item !== 'ocr' || canOcr).map(item => (
            <button
              type="button"
              key={item}
              className="btn"
              aria-label={panelLabels[item]}
              aria-expanded={panel === item}
              aria-controls={panel === item ? 'reader-panel' : undefined}
              onClick={event => showPanel(item, event.currentTarget)}
            >
              {item === 'search' ? 'Buscar' : item === 'ocr' ? 'OCR' : panelLabels[item]}
            </button>
          ))}
        </nav>
      </header>

      <div className="reader-workspace-body" data-panel-open={panel ? '' : undefined}>
        <main
          className="reader-content"
          aria-label="Texto do livro"
          ref={contentRef}
          tabIndex={-1}
          onWheel={() => { if (reader.playing) setManualScroll(true) }}
          onTouchMove={() => { if (reader.playing) setManualScroll(true) }}
        >
          <article className="prose">
            {chapter && <h2>{chapter.title}</h2>}
            {chapter && paragraphs.length > 0 ? (
              <div
                role="group"
                aria-label="Frases do trecho. Use as setas esquerda e direita para mudar de frase."
                onKeyDown={event => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
                  event.preventDefault()
                  moveSentence(event.key === 'ArrowLeft' ? -1 : 1, true)
                }}
              >
                {paragraphs.map(paragraph => {
                  const containsMatch = activeMatch?.chapterIndex === reader.chapterIndex &&
                    paragraph.some(sentence => sentence.index === activeMatch.sentenceIndex)
                  return (
                    <p key={paragraph[0]?.index}>
                      {paragraph.map(({ text, index, offset }) => {
                        const current = index === reader.sentenceIndex
                        const from = containsMatch ? Math.max(0, activeMatch.start - offset) : 0
                        const to = containsMatch ? Math.min(text.length, activeMatch.start + activeMatch.length - offset) : 0
                        return (
                          <Fragment key={index}>
                            <span
                              ref={current ? currentSentenceRef : undefined}
                              role="button"
                              className="sentence"
                              tabIndex={current ? 0 : -1}
                              aria-current={current ? 'location' : undefined}
                              data-current={current ? '' : undefined}
                              onClick={() => chooseSentence(index)}
                              onKeyDown={event => {
                                if (event.key !== 'Enter' && event.key !== ' ') return
                                event.preventDefault()
                                chooseSentence(index)
                              }}
                            >
                              {to > from ? (
                                <>{text.slice(0, from)}<mark>{text.slice(from, to)}</mark>{text.slice(to)}</>
                              ) : text}
                            </span>{' '}
                          </Fragment>
                        )
                      })}
                    </p>
                  )
                })}
              </div>
            ) : (
              <div className="reader-panel-section">
                <p className="muted">{isPdf ? 'Esta página não tem texto selecionável.' : 'Este trecho não tem texto legível.'}</p>
                {isPdf && chapter?.ocr?.status === 'empty' && <p className="muted">O reconhecimento não encontrou texto.</p>}
                {isPdf && chapter?.ocr?.status === 'failed' && <p className="muted">Não foi possível reconhecer o texto desta página.</p>}
                {isPdf && book.protected && <p className="muted">O reconhecimento não está disponível neste PDF protegido.</p>}
                {canOcr && (
                  <button type="button" className="btn reader-standalone-action" onClick={event => showPanel('ocr', event.currentTarget)}>
                    {ocr.running ? 'Ver reconhecimento' : 'Reconhecer texto da página'}
                  </button>
                )}
              </div>
            )}
            {chapter?.ocr?.status === 'recognized' && <p className="reader-message">Texto reconhecido da imagem da página.</p>}
            {reader.positionNotice && <p className="reader-message" role="status">{reader.positionNotice}</p>}
            {navigationNotice && <p className="reader-message" role="status">{navigationNotice}</p>}
          </article>
        </main>

        {panel && (
          <section className="reader-panel" id="reader-panel" aria-labelledby="reader-panel-title" ref={panelRef} tabIndex={-1}>
            <header className="reader-panel-heading">
              <h2 id="reader-panel-title">{panelLabels[panel]}</h2>
              <button type="button" className="btn" onClick={() => closePanel()}>Fechar</button>
            </header>
            {panel === 'contents' && <ContentsPanel book={book} chapterIndex={reader.chapterIndex} navigate={navigateTo} />}
            {panel === 'search' && (
              <SearchPanel
                chapters={book.chapters}
                query={query}
                setQuery={value => { setQuery(value); setMatchIndex(-1) }}
                matches={matches}
                searching={searching}
                activeIndex={matchIndex}
                navigate={navigateMatch}
                previousLocation={!!searchOrigin}
                returnToLocation={returnToSearchOrigin}
                viewResult={activeMatch ? () => closePanel(true) : undefined}
              />
            )}
            {panel === 'bookmarks' && (
              <BookmarksPanel bookmarks={bookmarks} reader={reader} protectedDocument={!!bookOverride}
                currentBookmark={currentBookmark} add={addCurrentBookmark} navigate={navigateBookmark}
              />
            )}
            {panel === 'appearance' && <AppearancePanel settings={settings} />}
            {panel === 'voices' && <VoicesPanel reader={reader} />}
            {panel === 'timer' && <TimerPanel reader={reader} />}
            {panel === 'ocr' && canOcr && <ReaderOcrPanel book={book} chapterIndex={reader.chapterIndex} ocr={ocr} />}
          </section>
        )}
      </div>

      <footer className="reader-player">
        {reader.speechError && (
          <div className="reader-feedback">
            <p className="reader-panel-error" role="alert">{reader.speechError}</p>
            {reader.canPlay && !ocr.running && <button type="button" className="btn" onClick={reader.play}>Tentar ouvir</button>}
          </div>
        )}
        {reader.progressError && (
          <div className="reader-feedback">
            <p className="reader-panel-error" role="alert">{reader.progressError}</p>
            <button type="button" className="btn" onClick={reader.retryProgress}>Salvar posição</button>
          </div>
        )}
        {setupMessage && (
          <div className="reader-feedback">
            <p className="muted" role="status">{setupMessage}</p>
            {reader.hasReadableText && !reader.voicesLoading && (
              <button type="button" className="btn" onClick={event => showPanel('voices', event.currentTarget)}>
                Escolher voz
              </button>
            )}
            {!reader.hasReadableText && canOcr && (
              <button type="button" className="btn" onClick={event => showPanel('ocr', event.currentTarget)}>
                Reconhecer texto do PDF
              </button>
            )}
          </div>
        )}
        {ocr.running && panel !== 'ocr' && (
          <div className="reader-feedback">
            <p className="muted" role="status">Reconhecendo texto do PDF…</p>
            <button type="button" className="btn" onClick={event => showPanel('ocr', event.currentTarget)}>
              Ver progresso
            </button>
          </div>
        )}
        <div className="reader-controls">
          <button type="button" className="icon-btn big" disabled={!reader.canGoPrevious} onClick={() => moveSentence(-1)} aria-label="Frase anterior">
            <span aria-hidden="true">⏮</span>
          </button>
          <button
            type="button"
            className="play-btn"
            onClick={reader.togglePlay}
            disabled={ocr.running || ((!reader.canPlay || !reader.hasReadableText) && !reader.playing)}
            aria-label={playLabel}
            title={playLabel}
          >
            <span aria-hidden="true">{reader.playback === 'preparing' ? '■' : reader.playing ? '⏸' : '▶'}</span>
          </button>
          <button type="button" className="icon-btn big" disabled={!reader.canGoNext} onClick={() => moveSentence(1)} aria-label="Próxima frase">
            <span aria-hidden="true">⏭</span>
          </button>
          <select
            className="rate-select"
            aria-label="Velocidade da narração"
            value={reader.rate}
            onChange={event => reader.setRate(Number(event.target.value))}
          >
            {[...new Set([...rates, reader.rate])].sort((a, b) => a - b).map(value => (
              <option key={value} value={value}>{value}×</option>
            ))}
          </select>
          <button
            type="button"
            className="icon-btn reader-quick-marker"
            ref={quickMarkerRef}
            aria-label={currentBookmark ? 'Frase marcada' : 'Marcar frase atual'}
            title={currentBookmark ? 'Frase marcada' : 'Marcar frase atual'}
            disabled={!reader.sentences[reader.sentenceIndex] || bookmarks.loading || bookmarks.saving || !!currentBookmark}
            onClick={addCurrentBookmark}
          >
            <span aria-hidden="true">{currentBookmark ? '★' : '☆'}</span>
          </button>
        </div>
        <div className="reader-playback-status">
          <p role="status">{playbackLabels[reader.playback]}{reader.playback === 'playing' && reader.activeVoice ? ` · ${reader.activeVoice.name}` : ''}</p>
          {reader.sleep.notice && <p role="status">{reader.sleep.notice}</p>}
          {reader.sleep.timer && (
            <button type="button" className="btn" onClick={event => showPanel('timer', event.currentTarget)}>
              {reader.sleep.timer.kind === 'time' ? <>Temporizador <span role="timer">{formatTimer(reader.sleep.remaining)}</span></>
                : isPdf ? 'Temporizador · fim da página' : 'Temporizador · fim do capítulo'}
            </button>
          )}
          {(manualScroll || !settings.appearance.follow) && (
            <button type="button" className="btn" onClick={centerSentence}>Voltar à frase atual</button>
          )}
          {searchOrigin && panel !== 'search' && (
            <button type="button" className="btn" onClick={returnToSearchOrigin}>Voltar à posição anterior à busca</button>
          )}
          {bookmarkStatus && <span role="status">{bookmarkStatus}</span>}
        </div>
      </footer>
    </div>
  )
}
