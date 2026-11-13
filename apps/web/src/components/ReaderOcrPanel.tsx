import { useEffect, useState } from 'react'
import type { ReaderBook } from '../hooks/useReader'
import type { useReaderOcr } from '../hooks/useReaderOcr'
import { ocrPackage } from '../pdf/ocrPackage'

const stageLabels = {
  preparing: 'Preparando reconhecimento',
  rendering: 'Preparando imagem',
  recognizing: 'Reconhecendo texto',
}

export default function ReaderOcrPanel({ book, chapterIndex, ocr }: {
  book: ReaderBook
  chapterIndex: number
  ocr: ReturnType<typeof useReaderOcr>
}) {
  const page = book.chapters[chapterIndex]
  const pageNumber = page?.pageNumber ?? chapterIndex + 1
  const pendingPages = book.chapters.flatMap(item => !item.paragraphs.length && item.ocr?.status !== 'empty' && item.pageNumber
    ? [item.pageNumber] : [])
  const [mode, setMode] = useState<'current' | 'range' | 'all'>('current')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [replace, setReplace] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const canRecognizeCurrent = !!page && (!page.paragraphs.length || !!page.ocr)
  const mustReplace = page?.ocr?.status === 'recognized' || page?.ocr?.status === 'empty'

  useEffect(() => {
    if (!preview) return
    const request = new AbortController()
    let url: string | null = null
    setPreviewUrl(null)
    setPreviewError(null)
    void import('../pdf/ocr').then(({ previewPdfPage }) => previewPdfPage(book.id, pageNumber, request.signal)).then(blob => {
      if (request.signal.aborted) return
      url = URL.createObjectURL(blob)
      setPreviewUrl(url)
    }).catch((error: unknown) => {
      if (!request.signal.aborted) setPreviewError(error instanceof Error ? error.message : 'Imagem indisponível.')
    })
    return () => {
      request.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [book.id, pageNumber, preview])

  function run() {
    setFormError(null)
    if (mode === 'current') {
      if (canRecognizeCurrent) ocr.start([pageNumber], !!mustReplace && replace)
    } else if (mode === 'all') {
      ocr.start(pendingPages)
    } else {
      const start = Number(first)
      const end = Number(last)
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > book.chapters.length) {
        setFormError(`Informe um intervalo entre 1 e ${book.chapters.length}.`)
        return
      }
      const pages = pendingPages.filter(number => number >= start && number <= end)
      if (!pages.length) setFormError('Nenhuma página pendente no intervalo.')
      else ocr.start(pages)
    }
  }

  return (
    <>
      <p className="muted">
        Reconhecimento local em {ocrPackage.languageLabel}, com o modelo incluído ({(ocrPackage.downloadBytes / 1_000_000).toFixed(1).replace('.', ',')} MB).
        Compare com a página original se houver erros de reconhecimento.
      </p>
      <form className="reader-panel-form" onSubmit={event => { event.preventDefault(); run() }}>
        <label className="reader-field">
          Páginas a reconhecer
          <select value={mode} disabled={ocr.running} onChange={event => {
            setMode(event.target.value === 'range' ? 'range' : event.target.value === 'all' ? 'all' : 'current')
            setFormError(null)
            setReplace(false)
          }}>
            <option value="current">Página atual ({pageNumber})</option>
            <option value="range">Intervalo de páginas pendentes</option>
            <option value="all">Todas as páginas pendentes ({pendingPages.length})</option>
          </select>
        </label>
        {mode === 'range' && (
          <div className="reader-ocr-range">
            <label className="reader-field">Primeira página
              <input type="number" min="1" max={book.chapters.length} value={first} required disabled={ocr.running}
                onChange={event => setFirst(event.target.value)} />
            </label>
            <label className="reader-field">Última página
              <input type="number" min="1" max={book.chapters.length} value={last} required disabled={ocr.running}
                onChange={event => setLast(event.target.value)} />
            </label>
          </div>
        )}
        {mode === 'current' && mustReplace && (
          <label className="reader-check">
            <input type="checkbox" checked={replace} disabled={ocr.running} onChange={event => setReplace(event.target.checked)} />
            {page?.ocr?.status === 'recognized' ? 'Substituir texto reconhecido' : 'Tentar de novo nesta página'}
          </label>
        )}
        {mode === 'current' && !canRecognizeCurrent && <p className="muted">A página atual já tem texto digital.</p>}
        {formError && <p className="reader-panel-error" role="alert">{formError}</p>}
        <div className="reader-inline-actions">
          {ocr.running ? (
            <button type="button" className="btn" disabled={ocr.cancelling} onClick={ocr.cancel}>
              {ocr.cancelling ? 'Cancelando…' : 'Cancelar reconhecimento'}
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={mode === 'current'
              ? !canRecognizeCurrent || (!!mustReplace && !replace) : !pendingPages.length}>
              Reconhecer texto
            </button>
          )}
        </div>
      </form>
      {ocr.running && (
        <div className="reader-panel-section">
          <p role="status">{ocr.progress ? `${stageLabels[ocr.progress.stage]} · página ${ocr.progress.pageNumber}` : 'Preparando reconhecimento…'}</p>
          <progress aria-label="Páginas processadas" max={ocr.progress?.total ?? 1} value={ocr.progress?.completed} />
          {ocr.progress?.stage === 'recognizing' && <progress aria-label="Reconhecimento da página" max={1} value={ocr.progress.fraction} />}
        </div>
      )}
      {ocr.result && <p role="status">Páginas com texto {ocr.result.recognized} · sem texto {ocr.result.empty} · falhas {ocr.result.failed}.</p>}
      {ocr.cancelled && <p role="status">Reconhecimento cancelado. Você pode continuar pelas páginas pendentes.</p>}
      {ocr.error && <p className="reader-panel-error" role="alert">{ocr.error}</p>}
      <button type="button" className="btn reader-standalone-action" aria-expanded={preview} onClick={() => setPreview(open => !open)}>
        {preview ? 'Ocultar página original' : 'Ver página original'}
      </button>
      {preview && (
        <div className="reader-panel-section">
          {previewUrl ? <img className="reader-ocr-image" src={previewUrl} alt={`Imagem da página ${pageNumber} do PDF`} /> :
            previewError ? <p className="reader-panel-error" role="alert">{previewError}</p> : <p role="status">Abrindo imagem…</p>}
        </div>
      )}
    </>
  )
}
