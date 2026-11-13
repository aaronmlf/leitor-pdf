import JSZip from 'jszip'
import { db } from './db'
import { inferOriginalFormat } from './library'
import { remapOcrPosition } from './ocr'
import { createId, hashOriginal } from './original'
import { positionPercent, resolveReadingPosition } from './positions'
import type { BookFormat, BookmarkRecord, BookRecord, ChapterRecord, FileRecord, OcrPageState, OutlineEntry, ProgressRecord, ReadingAnchor, SettingRecord } from './types'

const FORMAT = 'leitor-library'
const VERSION = 1
const MANIFEST_PATH = 'manifest.json'
const MAX_MANIFEST_BYTES = 128 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const SHA256 = /^[a-f\d]{64}$/

interface ArchiveBook extends Omit<BookRecord, 'cover' | 'format' | 'contentHash'> {
  format: BookFormat
  contentHash: string
  original: { size: number; type: string }
  coverFile?: { size: number; type: string; hash: string }
}

interface Manifest {
  format: typeof FORMAT
  version: typeof VERSION
  books: ArchiveBook[]
  chapters: ChapterRecord[]
  progress: ProgressRecord[]
  bookmarks: BookmarkRecord[]
  settings: SettingRecord[]
}

interface Snapshot {
  books: BookRecord[]
  chapters: ChapterRecord[]
  progress: ProgressRecord[]
  bookmarks: BookmarkRecord[]
  settings: SettingRecord[]
  files: FileRecord[]
}

export interface BackupPreview {
  books: number
  newBooks: number
  existingBooks: number
  bookmarks: number
  requiredBytes: number
}

function portableSetting(key: string): boolean {
  return key === 'engine' || key === 'rate' || key === 'readerAppearance' || key.startsWith('voice:')
}

function originalPath(index: number): string { return `originals/${index}` }
function coverPath(index: number): string { return `covers/${index}` }

function checkArchiveSize(size: number): void {
  if (size > MAX_ARCHIVE_BYTES) throw new Error('O backup excede o limite de 512 MiB deste leitor.')
}

export async function exportLibraryBackup(): Promise<Blob> {
  const snapshot = await db.transaction('r', [db.books, db.chapters, db.files, db.progress, db.bookmarks, db.settings], async () => {
    const [books, chapters, files, progress, bookmarks, settings] = await Promise.all([
      db.books.toArray(), db.chapters.toArray(), db.files.toArray(),
      db.progress.toArray(), db.bookmarks.toArray(), db.settings.toArray(),
    ])
    return { books, chapters, files, progress, bookmarks, settings }
  })
  const zip = new JSZip()
  const originals = new Map(snapshot.files.map(file => [file.id, file.blob]))
  const books: ArchiveBook[] = []
  for (const [index, { cover, ...book }] of snapshot.books.entries()) {
    const original = originals.get(book.id)
    if (!original) throw new Error(`O arquivo original de “${book.title}” está ausente.`)
    zip.file(originalPath(index), original)
    if (cover) zip.file(coverPath(index), cover)
    books.push({
      ...book,
      format: book.format ?? inferOriginalFormat(original),
      contentHash: book.contentHash ?? await hashOriginal(original),
      original: { size: original.size, type: original.type },
      coverFile: cover ? { size: cover.size, type: cover.type, hash: await hashOriginal(cover) } : undefined,
    })
  }
  const bookIds = new Set(books.map(book => book.id))
  const manifest: Manifest = {
    format: FORMAT,
    version: VERSION,
    books,
    chapters: snapshot.chapters.filter(item => bookIds.has(item.bookId)),
    progress: snapshot.progress.filter(item => bookIds.has(item.bookId)),
    bookmarks: snapshot.bookmarks.filter(item => bookIds.has(item.bookId)),
    settings: snapshot.settings.filter(item => portableSetting(item.key)),
  }
  const contents = JSON.stringify(manifest)
  const manifestSize = new Blob([contents]).size
  if (manifestSize > MAX_MANIFEST_BYTES) throw new Error('Os metadados da biblioteca excedem o limite de exportação.')
  checkArchiveSize(books.reduce((size, book) => size + book.original.size + (book.coverFile?.size ?? 0), manifestSize))
  zip.file(MANIFEST_PATH, contents, { compression: 'DEFLATE' })
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip', streamFiles: true })
}

type JsonObject = Record<string, unknown>
function object(value: unknown): value is JsonObject { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function string(value: unknown): value is string { return typeof value === 'string' }
function optional<T>(value: unknown, validate: (input: unknown) => input is T): value is T | undefined {
  return value === undefined || validate(value)
}
function format(value: unknown): value is BookFormat { return value === 'epub' || value === 'txt' || value === 'pdf' }
function hash(value: unknown): value is string { return string(value) && SHA256.test(value) }
function percent(value: unknown): value is number { return integer(value) && value <= 100 }
function flag(value: unknown): value is boolean { return typeof value === 'boolean' }

function archiveFile(value: unknown): value is ArchiveBook['original'] {
  return object(value) && integer(value.size) && value.size > 0 && string(value.type)
}

function coverFile(value: unknown): value is NonNullable<ArchiveBook['coverFile']> {
  return object(value) && hash(value.hash) && archiveFile(value)
}

function outlineEntry(value: unknown, chapterCount: number, depth: number): value is OutlineEntry {
  return depth <= 64 && object(value) && string(value.title) && integer(value.chapterIndex) &&
    value.chapterIndex < chapterCount && optional(value.paragraphIndex, integer) &&
    (value.children === undefined || Array.isArray(value.children) &&
      value.children.every(child => outlineEntry(child, chapterCount, depth + 1)))
}

function archiveBook(value: unknown): value is ArchiveBook {
  if (!object(value) || !string(value.id) || !value.id || !string(value.title) || !string(value.author) ||
      !integer(value.addedAt) || !integer(value.chapterCount) || !value.chapterCount || !format(value.format) ||
      !hash(value.contentHash) || !archiveFile(value.original) || !optional(value.coverFile, coverFile) ||
      !optional(value.originalName, string) || !optional(value.parserVersion, integer) ||
      !optional(value.textLength, integer) || !optional(value.protected, flag)) return false
  const chapterCount = value.chapterCount
  if (value.protected && (value.format !== 'pdf' || value.author !== '' || value.coverFile || value.outline || value.textLength)) return false
  return value.outline === undefined || Array.isArray(value.outline) && value.outline.every(entry => outlineEntry(entry, chapterCount, 0))
}

function chapterRecord(value: unknown): value is ChapterRecord {
  return object(value) && string(value.bookId) && integer(value.chapterIndex) && string(value.title) &&
    Array.isArray(value.paragraphs) && value.paragraphs.every(string) && optional(value.sourceId, string) &&
    optional(value.pageNumber, integer) && optional(value.pageLabel, string) && optional(value.textOffset, integer) &&
    optional(value.ocr, ocrPageState)
}

function ocrPageState(value: unknown): value is OcrPageState {
  return object(value) && (value.status === 'recognized' || value.status === 'empty' || value.status === 'failed') &&
    string(value.language) && !!value.language.trim() && integer(value.updatedAt)
}

function anchor(value: unknown): value is ReadingAnchor {
  return object(value) && optional(value.sourceId, string) && integer(value.offset) && string(value.quote) &&
    string(value.prefix) && string(value.suffix)
}

function validPosition(value: JsonObject): boolean {
  return string(value.bookId) && integer(value.chapterIndex) && integer(value.sentenceIndex) && optional(value.anchor, anchor)
}

function progressRecord(value: unknown): value is ProgressRecord {
  return object(value) && validPosition(value) && integer(value.updatedAt) && optional(value.progressPercent, percent)
}

function bookmarkRecord(value: unknown): value is BookmarkRecord {
  return object(value) && validPosition(value) && string(value.id) && !!value.id && string(value.label) &&
    integer(value.createdAt) && optional(value.updatedAt, integer)
}

function settingRecord(value: unknown): value is SettingRecord {
  return object(value) && string(value.key) && portableSetting(value.key) && string(value.value)
}

function invalidBackup(): Error { return new Error('O arquivo não contém um backup válido do Leitor.') }

function parseManifest(text: string): Manifest {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw invalidBackup() }
  if (!object(value) || value.format !== FORMAT) throw invalidBackup()
  if (value.version !== VERSION) throw new Error('Esta versão do backup do Leitor não é compatível.')
  const { books, chapters, progress, bookmarks, settings } = value
  if (!Array.isArray(books) || !books.every(archiveBook) || !Array.isArray(chapters) || !chapters.every(chapterRecord) ||
      !Array.isArray(progress) || !progress.every(progressRecord) || !Array.isArray(bookmarks) || !bookmarks.every(bookmarkRecord) ||
      !Array.isArray(settings) || !settings.every(settingRecord)) throw invalidBackup()
  validateReferences(books, chapters, progress, bookmarks, settings)
  return { format: FORMAT, version: VERSION, books, chapters, progress, bookmarks, settings }
}

function uniqueMap<T>(items: T[], key: (item: T) => string): Map<string, T> {
  const map = new Map<string, T>()
  for (const item of items) {
    const id = key(item)
    if (map.has(id)) throw invalidBackup()
    map.set(id, item)
  }
  return map
}

function validateReferences(
  books: ArchiveBook[], chapters: ChapterRecord[], progress: ProgressRecord[], bookmarks: BookmarkRecord[], settings: SettingRecord[],
): void {
  const byId = uniqueMap(books, book => book.id)
  const chapterCounts = new Map<string, number>()
  uniqueMap(chapters, chapter => JSON.stringify([chapter.bookId, chapter.chapterIndex]))
  for (const chapter of chapters) {
    const book = byId.get(chapter.bookId)
    if (!book || chapter.chapterIndex >= book.chapterCount) throw invalidBackup()
    if (book.protected && (chapter.paragraphs.length || chapter.title !== `Página ${chapter.pageNumber ?? chapter.chapterIndex + 1}`)) {
      throw invalidBackup()
    }
    if (chapter.ocr && (book.format !== 'pdf' || book.protected || chapter.pageNumber !== chapter.chapterIndex + 1 ||
        (chapter.ocr.status === 'recognized' ? !chapter.paragraphs.some(paragraph => paragraph.trim()) : chapter.paragraphs.length))) {
      throw invalidBackup()
    }
    chapterCounts.set(book.id, (chapterCounts.get(book.id) ?? 0) + 1)
  }
  for (const book of books) if (chapterCounts.get(book.id) !== book.chapterCount) throw invalidBackup()
  uniqueMap(progress, position => position.bookId)
  uniqueMap(bookmarks, bookmark => bookmark.id)
  uniqueMap(settings, setting => setting.key)
  for (const position of [...progress, ...bookmarks]) {
    const book = byId.get(position.bookId)
    if (!book || position.chapterIndex >= book.chapterCount || (book.protected && position.anchor)) throw invalidBackup()
    if (book.protected && 'label' in position && !/^Página \d+ · frase \d+$/.test(position.label)) throw invalidBackup()
  }
}

interface ZipEntryStream {
  on(event: 'data', callback: (chunk: Uint8Array) => void): ZipEntryStream
  on(event: 'end', callback: () => void): ZipEntryStream
  on(event: 'error', callback: (error: Error) => void): ZipEntryStream
  pause(): ZipEntryStream
  resume(): ZipEntryStream
}

function readEntry(zip: JSZip, path: string, maxBytes: number, type: string): Promise<Blob> {
  const entry = zip.file(path)
  if (!entry || entry.unsafeOriginalName !== path) return Promise.reject(invalidBackup())
  // JSZip exposes this stream in browsers, but its bundled types only declare the Node stream.
  const stream = (entry as JSZip.JSZipObject & { internalStream(type: 'uint8array'): ZipEntryStream }).internalStream('uint8array')
  return new Promise((resolve, reject) => {
    const parts: BlobPart[] = []
    let size = 0
    stream.on('data', chunk => {
      size += chunk.byteLength
      if (size > maxBytes) {
        stream.pause()
        reject(invalidBackup())
      } else {
        parts.push(new Uint8Array(chunk))
      }
    }).on('end', () => resolve(new Blob(parts, { type })))
      .on('error', () => reject(invalidBackup())).resume()
  })
}

async function verifiedEntry(zip: JSZip, path: string, data: ArchiveBook['original'], expectedHash: string): Promise<Blob> {
  const entry = await readEntry(zip, path, data.size, data.type)
  if (entry.size !== data.size || await hashOriginal(entry) !== expectedHash) throw invalidBackup()
  return entry
}

async function localBooksWithHashes(): Promise<BookRecord[]> {
  const { books, files } = await db.transaction('r', db.books, db.files, async () => {
    const books = await db.books.toArray()
    const files = await db.files.bulkGet(books.filter(book => !book.contentHash).map(book => book.id))
    return { books, files }
  })
  const byId = new Map(books.map(book => [book.id, book]))
  for (const file of files) {
    const book = file && byId.get(file.id)
    if (book && file) book.contentHash = await hashOriginal(file.blob)
  }
  return books
}

function findExisting(archive: Pick<BookRecord, 'id' | 'contentHash'>, byId: Map<string, BookRecord>, byHash: Map<string, BookRecord>): BookRecord | undefined {
  const byIdentity = byId.get(archive.id)
  if (byIdentity && byIdentity.contentHash === archive.contentHash) return byIdentity
  return archive.contentHash ? byHash.get(archive.contentHash) : undefined
}

function hashIndex(books: BookRecord[]): Map<string, BookRecord> {
  const index = new Map<string, BookRecord>()
  for (const book of books) if (book.contentHash && !index.has(book.contentHash)) index.set(book.contentHash, book)
  return index
}

async function checkSpace(requiredBytes: number): Promise<void> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
  const estimate = await storage?.estimate?.().catch(() => undefined)
  if (estimate?.quota !== undefined && estimate.usage !== undefined && requiredBytes > estimate.quota - estimate.usage) {
    throw new Error('Não há espaço suficiente para restaurar a biblioteca.')
  }
}

async function prepareBackup(file: Blob): Promise<{ snapshot: Snapshot; preview: BackupPreview; knownBooks: BookRecord[] }> {
  checkArchiveSize(file.size)
  const zip = await JSZip.loadAsync(file).catch(() => { throw invalidBackup() })
  const manifestFile = await readEntry(zip, MANIFEST_PATH, MAX_MANIFEST_BYTES, 'application/json')
  const manifest = parseManifest(await manifestFile.text())
  checkArchiveSize(manifest.books.reduce((size, book) => size + book.original.size + (book.coverFile?.size ?? 0), manifestFile.size))
  const paths = new Set([MANIFEST_PATH])
  manifest.books.forEach((book, index) => {
    paths.add(originalPath(index))
    if (book.coverFile) paths.add(coverPath(index))
  })
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir && (!paths.has(entry.name) || entry.name !== entry.unsafeOriginalName)) throw invalidBackup()
  }

  const knownBooks = await localBooksWithHashes()
  const byId = new Map(knownBooks.map(book => [book.id, book]))
  const byHash = hashIndex(knownBooks)
  const newIds = new Set<string>()
  let requiredBytes = 0
  for (const book of manifest.books) {
    if (findExisting(book, byId, byHash)) continue
    newIds.add(book.id)
    requiredBytes += book.original.size + (book.coverFile?.size ?? 0)
  }
  const newRows = manifest.chapters.filter(chapter => newIds.has(chapter.bookId) || chapter.ocr !== undefined)
  requiredBytes += new Blob([JSON.stringify([newRows, manifest.bookmarks, manifest.progress, manifest.settings])]).size
  await checkSpace(requiredBytes)

  const files: FileRecord[] = []
  const books: BookRecord[] = []
  for (const [index, { original, coverFile: cover, ...book }] of manifest.books.entries()) {
    const blob = await verifiedEntry(zip, originalPath(index), original, book.contentHash)
    files.push({ id: book.id, blob })
    const image = cover ? await verifiedEntry(zip, coverPath(index), cover, cover.hash) : null
    books.push({ ...book, cover: image })
  }
  return {
    snapshot: { ...manifest, books, files },
    knownBooks,
    preview: {
      books: books.length,
      newBooks: newIds.size,
      existingBooks: books.length - newIds.size,
      bookmarks: manifest.bookmarks.length,
      requiredBytes,
    },
  }
}

export async function previewLibraryBackup(file: Blob): Promise<BackupPreview> {
  return (await prepareBackup(file)).preview
}

function grouped<T extends { bookId: string }>(records: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const record of records) {
    const group = groups.get(record.bookId) ?? []
    group.push(record)
    groups.set(record.bookId, group)
  }
  return groups
}

function markerPosition(bookmark: BookmarkRecord, chapters: ChapterRecord[], book: BookRecord): string {
  const position = book.protected ? bookmark : resolveReadingPosition(chapters, bookmark)
  return JSON.stringify([position.chapterIndex, position.sentenceIndex, bookmark.label])
}

function mergeOcrPages(chapters: ChapterRecord[], archivedChapters: ChapterRecord[]): Array<{ before: ChapterRecord; after: ChapterRecord }> {
  const changes: Array<{ before: ChapterRecord; after: ChapterRecord }> = []
  const archivedByPage = new Map(archivedChapters.map(chapter => [chapter.pageNumber, chapter]))
  for (const before of chapters) {
    if (before.pageNumber === undefined || (before.paragraphs.length && !before.ocr)) continue
    const archived = archivedByPage.get(before.pageNumber)
    if (!archived?.ocr) continue
    if (before.ocr) {
      if (before.ocr.status === 'recognized' && archived.ocr.status !== 'recognized') continue
      if (archived.ocr.status !== 'recognized' || before.ocr.status === 'recognized') {
        if (before.ocr.updatedAt >= archived.ocr.updatedAt) continue
      }
    }
    changes.push({ before, after: { ...before, ocr: archived.ocr, paragraphs: archived.paragraphs } })
  }
  return changes
}

export async function restoreLibraryBackup(file: Blob): Promise<{ importedBooks: number; mergedBooks: number }> {
  const { snapshot, knownBooks } = await prepareBackup(file)
  const legacyHashes = new Map(knownBooks.map(book => [book.id, book.contentHash]))
  const importedChapters = grouped(snapshot.chapters)
  const importedMarkers = grouped(snapshot.bookmarks)
  const importedProgress = new Map(snapshot.progress.map(progress => [progress.bookId, progress]))
  const originals = new Map(snapshot.files.map(record => [record.id, record.blob]))
  return db.transaction('rw', [db.books, db.chapters, db.files, db.progress, db.bookmarks, db.settings], async () => {
    const [books, markers, progress, settings] = await Promise.all([
      db.books.toArray(), db.bookmarks.toArray(), db.progress.toArray(), db.settings.toArray(),
    ])
    for (const book of books) book.contentHash ??= legacyHashes.get(book.id)
    const byId = new Map(books.map(book => [book.id, book]))
    const byHash = hashIndex(books)
    const markersById = new Map(markers.map(marker => [marker.id, marker]))
    const markersByBook = grouped(markers)
    const progressByBook = new Map(progress.map(position => [position.bookId, position]))
    const settingKeys = new Set(settings.map(setting => setting.key))
    let importedBooks = 0
    let mergedBooks = 0

    for (const archivedBook of snapshot.books) {
      let book = findExisting(archivedBook, byId, byHash)
      const archivedChapters = (importedChapters.get(archivedBook.id) ?? []).sort((a, b) => a.chapterIndex - b.chapterIndex)
      let chapters: ChapterRecord[]
      let changedPages = new Map<number, { before: ChapterRecord; after: ChapterRecord }>()
      if (book) {
        mergedBooks++
        chapters = await db.chapters.where('bookId').equals(book.id).sortBy('chapterIndex')
        await db.books.put({ ...book, contentHash: archivedBook.contentHash, format: book.format ?? archivedBook.format })
        if (book.format === 'pdf' && !book.protected && !archivedBook.protected) {
          const changes = mergeOcrPages(chapters, archivedChapters)
          await db.chapters.bulkPut(changes.map(change => change.after))
          changedPages = new Map(changes.map(change => [change.before.chapterIndex, change]))
          chapters = chapters.map(chapter => changedPages.get(chapter.chapterIndex)?.after ?? chapter)
        }
      } else {
        const id = byId.has(archivedBook.id) ? createId() : archivedBook.id
        book = { ...archivedBook, id }
        chapters = archivedChapters.map(chapter => ({ ...chapter, bookId: id }))
        const blob = originals.get(archivedBook.id)
        if (!blob) throw invalidBackup()
        await db.books.add(book)
        await db.chapters.bulkAdd(chapters)
        await db.files.add({ id, blob })
        byId.set(id, book)
        importedBooks++
      }

      const incomingPosition = importedProgress.get(archivedBook.id)
      let existingPosition = progressByBook.get(book.id)
      const progressChange = existingPosition && changedPages.get(existingPosition.chapterIndex)
      if (existingPosition && progressChange?.after.ocr?.status === 'recognized') {
        existingPosition = remapOcrPosition(existingPosition, progressChange.before, progressChange.after)
        existingPosition.progressPercent = positionPercent(book, progressChange.after, existingPosition.sentenceIndex)
        await db.progress.put(existingPosition)
        progressByBook.set(book.id, existingPosition)
      }
      if (incomingPosition && (!existingPosition || incomingPosition.updatedAt > existingPosition.updatedAt)) {
        const resolved = book.protected ? incomingPosition : resolveReadingPosition(chapters, incomingPosition)
        const position = {
          ...incomingPosition,
          bookId: book.id,
          chapterIndex: resolved.chapterIndex,
          sentenceIndex: resolved.sentenceIndex,
          anchor: book.protected ? undefined : incomingPosition.anchor,
          progressPercent: book.format === 'pdf'
            ? positionPercent(book, chapters[resolved.chapterIndex], resolved.sentenceIndex)
            : incomingPosition.progressPercent,
        }
        await db.progress.put(position)
        progressByBook.set(book.id, position)
      }

      const bookMarkers = markersByBook.get(book.id) ?? []
      for (const [index, marker] of bookMarkers.entries()) {
        const change = changedPages.get(marker.chapterIndex)
        if (change?.after.ocr?.status !== 'recognized') continue
        const mapped = remapOcrPosition(marker, change.before, change.after)
        await db.bookmarks.put(mapped)
        bookMarkers[index] = mapped
        markersById.set(mapped.id, mapped)
      }
      const byPosition = new Map(bookMarkers.map(marker => [markerPosition(marker, chapters, book), marker]))
      for (const incoming of importedMarkers.get(archivedBook.id) ?? []) {
        const resolved = book.protected ? incoming : resolveReadingPosition(chapters, incoming)
        const marker: BookmarkRecord = {
          ...incoming,
          bookId: book.id,
          chapterIndex: resolved.chapterIndex,
          sentenceIndex: resolved.sentenceIndex,
          anchor: book.protected ? undefined : incoming.anchor,
          label: book.protected ? `Página ${chapters[resolved.chapterIndex]?.pageNumber ?? resolved.chapterIndex + 1} · frase ${resolved.sentenceIndex + 1}` : incoming.label,
        }
        const sameId = markersById.get(incoming.id)
        const sameBookmark = sameId?.bookId === book.id && sameId.createdAt === incoming.createdAt
        if (sameBookmark) {
          if ((sameId.updatedAt ?? sameId.createdAt) >= (incoming.updatedAt ?? incoming.createdAt)) continue
          await db.bookmarks.put(marker)
          const index = bookMarkers.indexOf(sameId)
          if (index !== -1) bookMarkers[index] = marker
          byPosition.delete(markerPosition(sameId, chapters, book))
        } else {
          if (byPosition.has(markerPosition(marker, chapters, book))) continue
          if (sameId) marker.id = createId()
          await db.bookmarks.add(marker)
          bookMarkers.push(marker)
        }
        byPosition.set(markerPosition(marker, chapters, book), marker)
        markersById.set(marker.id, marker)
      }
      markersByBook.set(book.id, bookMarkers)
    }
    await db.settings.bulkAdd(snapshot.settings.filter(setting => !settingKeys.has(setting.key)))
    return { importedBooks, mergedBooks }
  })
}
