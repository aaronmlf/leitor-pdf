import { db } from './db'
import { parseEpub } from './epub'
import { chapterText, createReadingAnchor, resolveReadingPosition } from './positions'
import { getChapterSentences } from './sentences'
import { parseTxt } from './txt'
import type { BookFormat, BookmarkRecord, BookRecord, ChapterRecord, LibraryBook, ParsedBook, ProgressRecord } from './types'
import { createId, hashOriginal } from './original'

const BOOK_EXTENSION = /\.(epub|txt|pdf)$/i

/** Importa um EPUB ou TXT: faz o parse e grava metadados, capítulos e arquivo original. */
export async function importBook(file: Blob, fallbackName?: string): Promise<string> {
  const fileName = typeof File !== 'undefined' && file instanceof File ? file.name : ''
  const name = (fallbackName ?? fileName).replace(BOOK_EXTENSION, '').trim() || 'Livro'
  const extension = BOOK_EXTENSION.exec(fileName)?.[1] ?? BOOK_EXTENSION.exec(fallbackName ?? '')?.[1]
  if (extension?.toLowerCase() === 'pdf' || (!extension && file.type === 'application/pdf')) {
    throw new Error('PDF precisa ser preparado antes de ser salvo.')
  }
  const isTxt = extension ? extension.toLowerCase() === 'txt' : /^text\/plain(?:;|$)/i.test(file.type)
  const parsed = isTxt
    ? { ...parseTxt(await file.arrayBuffer(), name), author: '', cover: null }
    : await parseEpub(file)
  return saveImportedBook(file, isTxt ? 'txt' : 'epub', parsed, fallbackName)
}

/** Persiste resultado de um parser, incluindo as páginas de PDF fornecidas pelo app. */
export async function saveImportedBook(
  file: Blob,
  format: BookFormat,
  parsed: ParsedBook,
  fallbackName?: string,
  signal?: AbortSignal,
): Promise<string> {
  if (parsed.chapters.length === 0 || (format !== 'pdf' && !parsed.chapters.some(chapter => chapter.paragraphs.length))) {
    throw new Error(format === 'txt'
      ? 'Não encontrei texto neste arquivo TXT.'
      : format === 'epub' ? 'Não encontrei capítulos de texto neste EPUB.' : 'Não encontrei páginas neste PDF.')
  }
  signal?.throwIfAborted()
  const contentHash = await hashOriginal(file)
  signal?.throwIfAborted()

  const fileName = typeof File !== 'undefined' && file instanceof File ? file.name : ''
  const originalName = fileName || fallbackName || ''
  const fallbackTitle = (fallbackName || fileName).replace(BOOK_EXTENSION, '').trim() || 'Livro sem título'
  const isProtected = format === 'pdf' && parsed.protected === true
  const id = createId()
  let textLength = 0
  const chapters = parsed.chapters.map((chapter, chapterIndex): ChapterRecord => {
    const { title, paragraphs, sourceId, pageNumber, pageLabel } = chapter
    const record: ChapterRecord = {
      bookId: id,
      chapterIndex,
      title: isProtected ? `Página ${pageNumber ?? chapterIndex + 1}` : title,
      paragraphs: isProtected ? [] : paragraphs,
      sourceId,
      pageNumber,
      pageLabel,
      textOffset: textLength,
    }
    textLength += chapterText(record).length
    return record
  })
  await db.transaction('rw', db.books, db.chapters, db.files, async () => {
    signal?.throwIfAborted()
    await db.books.put({
      id,
      title: isProtected ? fallbackTitle : parsed.title || fallbackTitle,
      author: isProtected ? '' : parsed.author,
      addedAt: Date.now(),
      chapterCount: chapters.length,
      cover: isProtected ? null : parsed.cover,
      format,
      contentHash,
      originalName,
      outline: isProtected ? undefined : parsed.outline,
      parserVersion: parsed.parserVersion ?? 1,
      textLength,
      protected: isProtected || undefined,
    })
    await db.chapters.bulkPut(chapters)
    await db.files.put({ id, blob: file })
    signal?.throwIfAborted()
  })
  return id
}

export async function listBooks(): Promise<BookRecord[]> {
  return db.books.orderBy('addedAt').reverse().toArray()
}

export async function listLibrary(): Promise<LibraryBook[]> {
  const [books, positions] = await Promise.all([listBooks(), db.progress.toArray()])
  const progressByBook = new Map(positions.map(progress => [progress.bookId, progress]))
  return Promise.all(books.map(async book => {
    const progress = progressByBook.get(book.id) ?? null
    const file = book.format ? undefined : (await db.files.get(book.id))?.blob
    const format = book.format ?? inferOriginalFormat(file)
    const chapter = progress ? await db.chapters.get([book.id, progress.chapterIndex]) : undefined
    return {
      ...book,
      format,
      progress,
      progressPercent: progress?.progressPercent ?? (progress ? positionPercent(book, chapter, progress.sentenceIndex) : null),
      lastActivityAt: progress?.updatedAt ?? book.addedAt,
      positionLabel: chapter?.pageNumber ? `Página ${chapter.pageNumber}` : chapter?.title ?? null,
    }
  }))
}

export function inferOriginalFormat(file?: Blob): BookFormat {
  const name = typeof File !== 'undefined' && file instanceof File ? file.name : ''
  if (/\.pdf$/i.test(name) || file?.type === 'application/pdf') return 'pdf'
  if (/\.txt$/i.test(name) || /^text\/plain(?:;|$)/i.test(file?.type ?? '')) return 'txt'
  return 'epub'
}

function positionPercent(book: BookRecord, chapter: ChapterRecord | undefined, sentenceIndex: number): number {
  if (!chapter) return 0
  if (book.protected) return Math.round(100 * (chapter.chapterIndex + 1) / Math.max(1, book.chapterCount))
  const sentences = getChapterSentences(chapter)
  const sentence = sentences[sentenceIndex]
  if (book.textLength && chapter.textOffset !== undefined) {
    const offset = chapter.textOffset + (sentence?.startOffset ?? 0) + (sentence?.text.length ?? 0)
    return Math.max(0, Math.min(100, Math.round(100 * offset / book.textLength)))
  }
  const section = chapter.chapterIndex + (sentenceIndex + 1) / Math.max(1, sentences.length)
  return Math.max(0, Math.min(100, Math.round(100 * section / Math.max(1, book.chapterCount))))
}

export async function getBookMeta(bookId: string): Promise<BookRecord | undefined> {
  return db.books.get(bookId)
}

export async function loadOriginalFile(bookId: string): Promise<Blob | undefined> {
  return (await db.files.get(bookId))?.blob
}

export const loadBookFile = loadOriginalFile

export async function loadChapters(bookId: string): Promise<ChapterRecord[]> {
  return db.chapters.where('bookId').equals(bookId).sortBy('chapterIndex')
}

export async function deleteBook(bookId: string): Promise<void> {
  await db.transaction('rw', db.books, db.chapters, db.files, db.progress, db.bookmarks, async () => {
    await db.books.delete(bookId)
    await db.chapters.where('bookId').equals(bookId).delete()
    await db.files.delete(bookId)
    await db.progress.delete(bookId)
    await db.bookmarks.where('bookId').equals(bookId).delete()
  })
}

export async function loadProgress(bookId: string): Promise<ProgressRecord | undefined> {
  return db.progress.get(bookId)
}

export async function saveProgress(
  bookId: string,
  chapterIndex: number,
  sentenceIndex: number,
  updatedAt = Date.now(),
): Promise<void> {
  await db.transaction('rw', db.books, db.chapters, db.progress, async () => {
    const [book, chapter, existing] = await Promise.all([
      db.books.get(bookId), db.chapters.get([bookId, chapterIndex]), db.progress.get(bookId),
    ])
    if (!book) throw new Error('Livro não encontrado.')
    if (existing && existing.updatedAt > updatedAt) return
    await db.progress.put({
      bookId, chapterIndex, sentenceIndex, updatedAt,
      progressPercent: positionPercent(book, chapter, sentenceIndex),
      anchor: !book.protected && chapter ? createReadingAnchor(chapter, sentenceIndex) : undefined,
    })
  })
}

/** Marcadores do livro, do mais recente para o mais antigo. */
export async function listBookmarks(bookId: string): Promise<BookmarkRecord[]> {
  return db.bookmarks.where('bookId').equals(bookId).reverse().sortBy('createdAt')
}

export async function addBookmark(
  bookId: string,
  chapterIndex: number,
  sentenceIndex: number,
  label: string,
): Promise<string> {
  return db.transaction('rw', db.books, db.chapters, db.bookmarks, async () => {
    const [book, chapters, bookmarks] = await Promise.all([
      db.books.get(bookId), loadChapters(bookId), listBookmarks(bookId),
    ])
    if (!book) throw new Error('Livro não encontrado.')
    const chapter = chapters[chapterIndex]
    const existing = bookmarks.find(bookmark => {
      const position = book.protected ? bookmark : resolveReadingPosition(chapters, bookmark)
      return position.chapterIndex === chapterIndex && position.sentenceIndex === sentenceIndex
    })
    if (existing) return existing.id
    const bookmarkLabel = book.protected
      ? `Página ${chapter?.pageNumber ?? chapterIndex + 1} · frase ${sentenceIndex + 1}`
      : label.trim()
    if (!bookmarkLabel) throw new Error('Informe um nome para o marcador.')
    const id = createId()
    await db.bookmarks.put({
      id, bookId, chapterIndex, sentenceIndex, label: bookmarkLabel, createdAt: Date.now(),
      anchor: !book.protected && chapter ? createReadingAnchor(chapter, sentenceIndex) : undefined,
    })
    return id
  })
}

export async function renameBookmark(id: string, label: string): Promise<void> {
  const normalized = label.trim()
  if (!normalized) throw new Error('Informe um nome para o marcador.')
  await db.transaction('rw', db.books, db.bookmarks, async () => {
    const bookmark = await db.bookmarks.get(id)
    if (!bookmark) throw new Error('Marcador não encontrado.')
    if ((await db.books.get(bookmark.bookId))?.protected) throw new Error('O nome de um marcador de PDF protegido é fixo.')
    await db.bookmarks.update(id, { label: normalized, updatedAt: Date.now() })
  })
}

export async function deleteBookmark(id: string): Promise<void> {
  await db.bookmarks.delete(id)
}

export async function loadSetting(key: string): Promise<string | undefined> {
  return (await db.settings.get(key))?.value
}

export async function saveSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value })
}

/** Cache de áudio gerado pelo Piper: chave = `voiceId:hash(texto)`. */
export async function loadAudioBlob(key: string): Promise<Blob | null> {
  const record = await db.audio.get(key)
  return record?.blob ?? null
}

export async function saveAudioBlob(key: string, blob: Blob): Promise<void> {
  await db.audio.put({ key, blob, savedAt: Date.now() })
}

export async function clearAudioCache(): Promise<void> {
  await db.audio.clear()
}
