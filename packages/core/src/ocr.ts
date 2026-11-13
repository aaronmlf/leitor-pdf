import { db } from './db'
import { createReadingAnchor, positionPercent, resolveReadingPosition } from './positions'
import type { BookRecord, ChapterRecord, OcrPageResult, ReadingPosition } from './types'

function assertOcrBook(book: BookRecord | undefined): asserts book is BookRecord {
  if (book?.format !== 'pdf') throw new Error('O reconhecimento de texto está disponível para PDFs.')
  if (book.protected) throw new Error('O texto reconhecido de um PDF protegido não pode ser salvo.')
}

function assertPageNumber(page: number): void {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Informe uma página válida.')
}

/** Lista as páginas elegíveis para continuar um intervalo de OCR. */
export async function listOcrPages(bookId: string, startPage: number, endPage: number): Promise<ChapterRecord[]> {
  assertPageNumber(startPage)
  assertPageNumber(endPage)
  if (startPage > endPage) throw new Error('Informe um intervalo de páginas válido.')
  return db.transaction('r', db.books, db.chapters, async () => {
    const book = await db.books.get(bookId)
    assertOcrBook(book)
    if (endPage > book.chapterCount) throw new Error('O intervalo ultrapassa o total de páginas do PDF.')
    const pages = await db.chapters.where('[bookId+chapterIndex]')
      .between([bookId, startPage - 1], [bookId, endPage - 1], true, true).toArray()
    return pages.filter(page => !page.paragraphs.length && (page.ocr === undefined || page.ocr.status === 'failed'))
  })
}

/** Mantém âncoras textuais anteriores quando o novo OCR só permite aproximação. */
export function remapOcrPosition<T extends ReadingPosition>(position: T, before: ChapterRecord, after: ChapterRecord): T {
  const anchor = position.anchor ?? createReadingAnchor(before, position.sentenceIndex)
  const resolved = resolveReadingPosition([after], { ...position, anchor, chapterIndex: 0 })
  return {
    ...position,
    chapterIndex: after.chapterIndex,
    sentenceIndex: resolved.sentenceIndex,
    anchor: resolved.approximate ? anchor : createReadingAnchor(after, resolved.sentenceIndex) ?? anchor,
  }
}

/** Salva o resultado de uma página; as outras páginas e o original ficam intactos. */
export async function saveOcrPage(
  bookId: string,
  pageNumber: number,
  result: OcrPageResult,
  options: { replace?: boolean; signal?: AbortSignal } = {},
): Promise<ChapterRecord> {
  assertPageNumber(pageNumber)
  const language = result.language.trim()
  if (!language) throw new Error('Informe o idioma do reconhecimento de texto.')
  const paragraphs = result.status === 'recognized' ? result.paragraphs.map(text => text.trim()).filter(Boolean) : []
  const status = result.status === 'recognized' && !paragraphs.length ? 'empty' : result.status
  const updatedAt = Date.now()
  options.signal?.throwIfAborted()

  return db.transaction('rw', [db.books, db.chapters, db.progress, db.bookmarks], async () => {
    const [book, page] = await Promise.all([db.books.get(bookId), db.chapters.get([bookId, pageNumber - 1])])
    assertOcrBook(book)
    if (page?.pageNumber !== pageNumber) throw new Error('Página não encontrada no PDF.')
    options.signal?.throwIfAborted()

    if (page.paragraphs.length && (page.ocr?.status !== 'recognized' || !options.replace || status !== 'recognized')) return page
    if (page.ocr?.status === 'empty' && !options.replace) return page

    const next: ChapterRecord = {
      ...page,
      paragraphs,
      ocr: { status, language, updatedAt },
    }
    if (status === 'recognized') {
      const [progress, bookmarks] = await Promise.all([
        db.progress.get(bookId), db.bookmarks.where('bookId').equals(bookId).toArray(),
      ])
      if (progress?.chapterIndex === page.chapterIndex) {
        const resolved = remapOcrPosition(progress, page, next)
        await db.progress.put({ ...resolved, progressPercent: positionPercent(book, next, resolved.sentenceIndex) })
      }
      await db.bookmarks.bulkPut(bookmarks.filter(bookmark => bookmark.chapterIndex === page.chapterIndex)
        .map(bookmark => remapOcrPosition(bookmark, page, next)))
    }
    await db.chapters.put(next)
    options.signal?.throwIfAborted()
    return next
  })
}
