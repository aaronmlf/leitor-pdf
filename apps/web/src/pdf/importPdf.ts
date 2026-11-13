import { loadOriginalFile, saveImportedBook } from '@leitor/core'
import type { BookRecord, ChapterRecord, OutlineEntry, ParsedBook, ParsedChapter } from '@leitor/core'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import { extractParagraphs, layoutPage } from './layout'
import type { PdfPageLayout } from './layout'

export interface PdfImportOptions {
  signal?: AbortSignal
  onProgress?: (currentPage: number, totalPages: number) => void
  onPassword?: (incorrect: boolean) => Promise<string | null>
}

export interface PdfSession {
  book: BookRecord
  chapters: ChapterRecord[]
}

type PdfOutlineNode = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>[number]

async function readOutline(document: PDFDocumentProxy, items: PdfOutlineNode[], depth = 0): Promise<OutlineEntry[]> {
  if (depth >= 20) return []
  const outline: OutlineEntry[] = []
  for (const item of items) {
    const children = await readOutline(document, item.items, depth + 1)
    let chapterIndex = -1
    try {
      const target = typeof item.dest === 'string' ? await document.getDestination(item.dest) : item.dest
      const destination: unknown = target?.[0]
      if (typeof destination === 'number') chapterIndex = destination
      else if (destination && typeof destination === 'object' && 'num' in destination && 'gen' in destination &&
        typeof destination.num === 'number' && typeof destination.gen === 'number') {
        chapterIndex = await document.getPageIndex({ num: destination.num, gen: destination.gen })
      }
    } catch {
      // Uma entrada de sumário inválida não impede a leitura das páginas.
    }
    const title = item.title.trim()
    if (title && Number.isInteger(chapterIndex) && chapterIndex >= 0 && chapterIndex < document.numPages) {
      outline.push({ title, chapterIndex, ...(children.length ? { children } : {}) })
    } else {
      outline.push(...children)
    }
  }
  return outline
}

function field(metadata: object, name: string): string {
  const value: unknown = Reflect.get(metadata, name)
  return typeof value === 'string' ? value.trim() : ''
}

function abortPdf(): DOMException {
  return new DOMException('A importação do PDF foi cancelada.', 'AbortError')
}

export async function withPdfDocument<T>(
  file: Blob,
  options: PdfImportOptions,
  useDocument: (document: PDFDocumentProxy, askedForPassword: boolean) => Promise<T>,
): Promise<T> {
  const { signal, onPassword } = options
  signal?.throwIfAborted()
  const [{ getDocument, GlobalWorkerOptions, PasswordResponses }, { default: workerUrl }, data] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    file.arrayBuffer(),
  ])
  signal?.throwIfAborted()
  GlobalWorkerOptions.workerSrc = workerUrl
  const assets = new URL(`${import.meta.env.BASE_URL}pdf-assets/`, window.location.href)
  const task = getDocument({
    data,
    cMapUrl: new URL('cmaps/', assets).href,
    standardFontDataUrl: new URL('standard_fonts/', assets).href,
    wasmUrl: new URL('wasm/', assets).href,
    iccUrl: new URL('iccs/', assets).href,
    useWorkerFetch: true,
    stopAtErrors: true,
  })
  let askedForPassword = false
  task.onPassword = (update: (password: string | Error) => void, reason: number) => {
    askedForPassword = true
    if (!onPassword) {
      update(new Error('Este PDF exige senha.'))
      return
    }
    void onPassword(reason === PasswordResponses.INCORRECT_PASSWORD).then(password => {
      if (signal?.aborted) return
      update(password === null ? abortPdf() : password)
    }, () => {
      if (!signal?.aborted) update(abortPdf())
    })
  }
  let destroying: Promise<void> | undefined
  const close = () => destroying ??= task.destroy().catch(() => undefined)
  const onAbort = () => { void close() }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const document = await task.promise
    signal?.throwIfAborted()
    return await useDocument(document, askedForPassword)
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw abortPdf()
    if (error instanceof Error && (error.name === 'InvalidPDFException' || error.name === 'FormatError')) {
      throw new Error('O PDF está danificado ou contém uma estrutura que o Leitor não conseguiu abrir.')
    }
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
    await close()
  }
}

async function parsePdf(file: Blob, options: PdfImportOptions): Promise<ParsedBook> {
  const { signal, onProgress } = options
  return withPdfDocument(file, options, async (document, askedForPassword) => {
    const [metadata, labels, entries] = await Promise.all([
      document.getMetadata(),
      document.getPageLabels().catch(() => null),
      document.getOutline().catch(() => null),
    ])
    const layouts: PdfPageLayout[] = []
    onProgress?.(0, document.numPages)
    for (let number = 1; number <= document.numPages; number++) {
      signal?.throwIfAborted()
      const page = await document.getPage(number)
      const content = await page.getTextContent()
      const items = content.items.filter((item): item is TextItem => 'str' in item)
      layouts.push(layoutPage(items, page.view, page.rotate))
      page.cleanup()
      onProgress?.(number, document.numPages)
      // Cada página aguarda o worker, permitindo pintar progresso e cancelar.
    }
    const chapters = extractParagraphs(layouts).map((paragraphs, index): ParsedChapter => {
      const pageNumber = index + 1
      const pageLabel = labels?.[index]
      return { title: `Página ${pageNumber}`, pageNumber, pageLabel, sourceId: `page:${pageNumber}`, paragraphs }
    })
    const outline = entries?.length ? await readOutline(document, entries) : undefined
    signal?.throwIfAborted()
    return {
      title: field(metadata.info, 'Title'),
      author: field(metadata.info, 'Author'),
      cover: null,
      chapters,
      outline,
      parserVersion: 1,
      protected: askedForPassword || Boolean(field(metadata.info, 'EncryptFilterName')),
    }
  })
}

export async function importPdf(file: File, options: PdfImportOptions = {}): Promise<{ id: string }> {
  const parsed = await parsePdf(file, options)
  const id = await saveImportedBook(file, 'pdf', parsed, file.name, options.signal)
  return { id }
}

export async function openProtectedPdf(book: BookRecord, options: PdfImportOptions = {}): Promise<PdfSession> {
  const file = await loadOriginalFile(book.id)
  if (!file) throw new Error('O arquivo original deste PDF não está disponível.')
  const parsed = await parsePdf(file, options)
  return {
    book: { ...book, outline: parsed.outline },
    chapters: parsed.chapters.map((chapter, chapterIndex) => ({ ...chapter, chapterIndex, bookId: book.id })),
  }
}
