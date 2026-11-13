export type BookFormat = 'epub' | 'txt' | 'pdf'

export interface OutlineEntry {
  title: string
  chapterIndex: number
  paragraphIndex?: number
  children?: OutlineEntry[]
}

/** Metadados + capa. O arquivo original fica em `files`. */
export interface BookRecord {
  id: string
  title: string
  author: string
  addedAt: number
  chapterCount: number
  cover: Blob | null
  format?: BookFormat
  contentHash?: string
  originalName?: string
  outline?: OutlineEntry[]
  parserVersion?: number
  textLength?: number
  protected?: boolean
}

export interface LibraryBook extends BookRecord {
  progress: ProgressRecord | null
  progressPercent: number | null
  lastActivityAt: number
  positionLabel: string | null
}

export interface ChapterRecord extends ParsedChapter {
  bookId: string
  chapterIndex: number
  textOffset?: number
  ocr?: OcrPageState
}

export interface OcrPageState {
  status: 'recognized' | 'empty' | 'failed'
  language: string
  updatedAt: number
}

export type OcrPageResult =
  | { status: 'recognized'; language: string; paragraphs: string[] }
  | { status: 'empty' | 'failed'; language: string }

/** Arquivo original guardado como Blob (permite reprocessar depois). */
export interface FileRecord {
  id: string
  blob: Blob
}

/** Posição no texto canônico da unidade, antes da normalização para fala. */
export interface ReadingAnchor {
  sourceId?: string
  offset: number
  quote: string
  prefix: string
  suffix: string
}

export interface ReadingPosition {
  chapterIndex: number
  sentenceIndex: number
  anchor?: ReadingAnchor
}

export interface ProgressRecord extends ReadingPosition {
  bookId: string
  updatedAt: number
  progressPercent?: number
}

export interface SettingRecord {
  key: string
  value: string
}

/** Marcador: posição salva pelo usuário dentro de um livro. */
export interface BookmarkRecord extends ReadingPosition {
  id: string
  bookId: string
  label: string
  createdAt: number
  updatedAt?: number
}

/** Uma frase, já mapeada para o parágrafo de origem. */
export interface Sentence {
  text: string
  paragraphIndex: number
  sentenceIndex: number
  startOffset?: number
}

/** Registro de áudio gerado pelo Piper (cache de frases). */
export interface AudioCacheRecord {
  key: string
  blob: Blob
  savedAt: number
}

export interface ParsedChapter {
  title: string
  paragraphs: string[]
  sourceId?: string
  pageNumber?: number
  pageLabel?: string
}

export interface ParsedBook {
  title: string
  author: string
  cover: Blob | null
  chapters: ParsedChapter[]
  outline?: OutlineEntry[]
  parserVersion?: number
  protected?: boolean
}
