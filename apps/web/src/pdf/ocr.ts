import { getBookMeta, loadChapters, loadOriginalFile, saveOcrPage } from '@leitor/core'
import type { ChapterRecord } from '@leitor/core'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import type { Worker as OcrWorker } from 'tesseract.js'
import { withPdfDocument } from './importPdf'
import { extractParagraphs, layoutPage } from './layout'

interface OcrProgress {
  pageNumber: number
  completed: number
  total: number
  stage: 'preparing' | 'rendering' | 'recognizing'
  fraction: number
}

interface OcrOptions {
  signal: AbortSignal
  replace?: boolean
  onProgress?: (progress: OcrProgress) => void
  onPage?: (chapter: ChapterRecord) => void
}

const language = 'por'
let running = false

async function renderPage(document: PDFDocumentProxy, number: number, longestEdge: number, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted()
  const page = await document.getPage(number)
  const dimensions = page.getViewport({ scale: 1 })
  const scale = Math.min(longestEdge / Math.max(dimensions.width, dimensions.height), 4)
  const viewport = page.getViewport({ scale })
  const canvas = window.document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))
  try {
    signal?.throwIfAborted()
    const render = page.render({ canvas, viewport, background: '#fff' })
    const cancel = () => render.cancel()
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      await render.promise
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
    signal?.throwIfAborted()
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Não foi possível preparar a imagem desta página.'))
    }))
  } finally {
    canvas.width = 0
    canvas.height = 0
    page.cleanup()
  }
}

async function originalPdf(bookId: string): Promise<Blob> {
  const [book, file] = await Promise.all([getBookMeta(bookId), loadOriginalFile(bookId)])
  if (!file || book?.format !== 'pdf') throw new Error('O arquivo original deste PDF não está disponível.')
  if (book.protected) throw new Error('O reconhecimento está disponível para PDFs sem senha.')
  return file
}

export async function previewPdfPage(bookId: string, pageNumber: number, signal?: AbortSignal): Promise<Blob> {
  const file = await originalPdf(bookId)
  return withPdfDocument(file, { signal }, document => renderPage(document, pageNumber, 1500, signal))
}

function toParagraphs(text: string): string[] {
  return text.replaceAll('\r', '').trim().split(/\n[\t ]*\n+/).flatMap(section => {
    const paragraph = section.replace(/\s+/g, ' ').trim()
    return /[\p{L}\p{N}]/u.test(paragraph) ? [paragraph] : []
  })
}

function orderRecognizedText(text: string, tsv: string | null): string[] {
  if (!tsv) return toParagraphs(text)
  const [, page] = tsv.split('\n', 2)
  const [, , , , , , , , width, height] = page?.split('\t').map(Number) ?? []
  if (!width || !height) return toParagraphs(text)
  const words: TextItem[] = []
  for (const row of tsv.split('\n')) {
    const [level, , , , , , left, top, wordWidth, wordHeight, , word] = row.split('\t')
    if (level !== '5' || !word?.trim()) continue
    const size = Number(wordHeight)
    const x = Number(left)
    const y = height - Number(top) - size
    words.push({
      str: word, dir: 'ltr', width: Number(wordWidth), height: size,
      transform: [size, 0, 0, size, x, y], fontName: '', hasEOL: false,
    })
  }
  // As coordenadas dos termos separam colunas que o texto linear do motor
  // pode juntar quando as linhas têm alturas semelhantes.
  const ordered = extractParagraphs([layoutPage(words, [0, 0, width, height], 0)])[0]
  return ordered?.length ? ordered.flatMap(toParagraphs) : toParagraphs(text)
}

export async function runPdfOcr(bookId: string, pages: number[], options: OcrOptions) {
  const { signal, replace = false, onPage, onProgress } = options
  signal.throwIfAborted()
  if (running) throw new Error('Já há um reconhecimento em andamento.')
  running = true
  let worker: OcrWorker | undefined
  let workerFailed = false
  let cancelCurrent: ((error: unknown) => void) | undefined
  const onAbort = () => {
    cancelCurrent?.(signal.reason)
    void worker?.terminate()
  }
  signal.addEventListener('abort', onAbort, { once: true })

  function waitFor<T>(operation: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      cancelCurrent = reject
      if (signal.aborted) reject(signal.reason)
      void operation.then(resolve, reject)
    }).finally(() => { cancelCurrent = undefined })
  }

  try {
    const [file, chapters] = await Promise.all([originalPdf(bookId), loadChapters(bookId)])
    const requested = new Set(pages)
    const pending = chapters.filter(chapter => chapter.pageNumber && requested.has(chapter.pageNumber) && (
      replace ? !chapter.paragraphs.length || Boolean(chapter.ocr) :
        !chapter.paragraphs.length && chapter.ocr?.status !== 'empty'
    ))
    const counts = { recognized: 0, empty: 0, failed: 0 }
    if (!pending.length) return counts

    let completed = 0
    let pageNumber = pending[0]!.pageNumber!
    let stage: OcrProgress['stage'] = 'preparing'
    let lastFraction = -1
    const report = (fraction: number) => {
      if (fraction !== 1 && fraction - lastFraction < 0.025) return
      lastFraction = fraction
      onProgress?.({ pageNumber, completed, total: pending.length, stage, fraction })
    }
    const setStage = (next: OcrProgress['stage']) => {
      stage = next
      lastFraction = -1
      report(0)
    }
    setStage('preparing')
    const { default: { createWorker, OEM, PSM } } = await import('tesseract.js/dist/tesseract.esm.min.js')
    signal.throwIfAborted()
    const directory = new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href).href
    const starting = createWorker(language, OEM.LSTM_ONLY, {
      workerPath: `${directory}worker.min.js`,
      corePath: directory,
      langPath: directory.slice(0, -1),
      workerBlobURL: false,
      gzip: false,
      cacheMethod: 'none',
      logger: ({ progress, status }) => {
        if (stage === 'recognizing' && status === 'recognizing text') report(progress)
      },
      errorHandler: (cause: unknown) => {
        workerFailed = true
        cancelCurrent?.(cause instanceof Error ? cause : new Error(String(cause)))
      },
    }).then(async ready => {
      if (signal.aborted || workerFailed) await ready.terminate()
      return ready
    })
    worker = await waitFor(starting)
    await waitFor(worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: '200' }))
    const engine = worker
    await withPdfDocument(file, { signal }, async document => {
      for (const chapter of pending) {
        signal.throwIfAborted()
        pageNumber = chapter.pageNumber!
        let paragraphs: string[] | undefined
        try {
          setStage('rendering')
          const image = await renderPage(document, pageNumber, 2400, signal)
          signal.throwIfAborted()
          setStage('recognizing')
          const { data } = await waitFor(engine.recognize(image, { rotateAuto: true }, { text: true, tsv: true }))
          paragraphs = orderRecognizedText(data.text, data.tsv)
        } catch (error) {
          signal.throwIfAborted()
          if (workerFailed) throw error
        }
        const result = paragraphs === undefined ? { status: 'failed' as const, language } :
          paragraphs.length ? { status: 'recognized' as const, language, paragraphs } : { status: 'empty' as const, language }
        const saved = await saveOcrPage(bookId, pageNumber, result, { signal, replace })
        counts[result.status]++
        completed++
        report(1)
        onPage?.(saved)
      }
    })
    return counts
  } finally {
    signal.removeEventListener('abort', onAbort)
    running = false
    await worker?.terminate()
  }
}
