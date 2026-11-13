import Dexie, { type Table } from 'dexie'
import { createReadingAnchor } from './positions'
import type {
  AudioCacheRecord,
  BookRecord,
  BookmarkRecord,
  ChapterRecord,
  FileRecord,
  ProgressRecord,
  SettingRecord,
} from './types'

export class ReaderDB extends Dexie {
  books!: Table<BookRecord, string>
  chapters!: Table<ChapterRecord, [string, number]>
  files!: Table<FileRecord, string>
  progress!: Table<ProgressRecord, string>
  settings!: Table<SettingRecord, string>
  audio!: Table<AudioCacheRecord, string>
  bookmarks!: Table<BookmarkRecord, string>

  constructor() {
    super('leitor-db')
    this.version(1).stores({
      books: 'id, addedAt',
      chapters: '[bookId+chapterIndex], bookId',
      files: 'id',
      progress: 'bookId',
      settings: 'key',
    })
    this.version(2).stores({
      audio: 'key',
    })
    this.version(3).stores({
      bookmarks: 'id, bookId',
    })
    this.version(4).stores({
      books: 'id, addedAt, contentHash',
    }).upgrade(async transaction => {
      const chapters = transaction.table<ChapterRecord, [string, number]>('chapters')
      const progress = transaction.table<ProgressRecord, string>('progress')
      const bookmarks = transaction.table<BookmarkRecord, string>('bookmarks')
      const [positions, markers] = await Promise.all([progress.toArray(), bookmarks.toArray()])
      const records = [...positions, ...markers]
      const sources = await chapters.bulkGet(records.map(record => [record.bookId, record.chapterIndex]))
      for (const [index, record] of records.entries()) {
        const chapter = sources[index]
        if (chapter && !record.anchor) record.anchor = createReadingAnchor(chapter, record.sentenceIndex)
      }
      await Promise.all([progress.bulkPut(positions), bookmarks.bulkPut(markers)])
    })
  }
}

export const db = new ReaderDB()
