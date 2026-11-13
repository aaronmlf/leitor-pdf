import type { ChapterRecord, Sentence } from './types'

export function normalizeParagraph(paragraph: string): string {
  return paragraph.replace(/\s+/g, ' ').trim()
}

/**
 * Abreviações que não terminam frase em português. A lista é propositalmente
 * conservadora; refino fica para a Fase 4 (números, siglas, etc.).
 */
const ABBREVIATIONS = [
  'sr', 'sra', 'srta', 'dr', 'dra', 'prof', 'profa', 'exa', 'av', 'cia',
  'ltda', 'ed', 'vol', 'cap', 'pg', 'fl', 'art', 'jr', 'etc', 'aprox', 'nº',
]

const ABBREV_RE = new RegExp(`\\b(${ABBREVIATIONS.join('|')})\\.`, 'gi')
const INITIAL_RE = /\b([A-ZÁÉÍÓÚÂÊÔÃÕÇ])\.(?=\s[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/g
const DECIMAL_RE = /(\d)\.(\d)/g
/** Ponto/!/?/… seguido de aspas/parênteses e depois espaço ou fim. */
const SENTENCE_END_RE = /([.!?…]+["'”’»)]*)(\s+|$)/g
/** Continuação de frase: começa com minúscula ou reticências. */
const LOWERCASE_START_RE = /^[a-zà-úç…]/
const PROTECTED_DOT = '\u0001'

/** Web Speech engasga com trechos longos; quebramos por pontuação antes disso. */
function splitLong(sentence: string, max = 380): string[] {
  if (sentence.length <= max) return [sentence]
  const pieces: string[] = []
  let rest = sentence
  while (rest.length > max) {
    const window = rest.slice(0, max)
    const floor = Math.floor(max / 3)
    let cut = Math.max(window.lastIndexOf(';'), window.lastIndexOf(':'))
    if (cut < floor) cut = window.lastIndexOf(',')
    if (cut < floor) cut = window.lastIndexOf(' ')
    if (cut <= 0) cut = max - 1
    pieces.push(rest.slice(0, cut + 1).trim())
    rest = rest.slice(cut + 1).trim()
  }
  if (rest) pieces.push(rest)
  return pieces
}

/** Divide um parágrafo em frases, protegendo abreviações, iniciais e números. */
export function splitSentences(paragraph: string): string[] {
  let text = normalizeParagraph(paragraph)
  if (!text) return []

  text = text.replace(ABBREV_RE, `$1${PROTECTED_DOT}`)
  text = text.replace(INITIAL_RE, `$1${PROTECTED_DOT}`)
  text = text.replace(DECIMAL_RE, `$1${PROTECTED_DOT}$2`)

  const marked = text.replace(SENTENCE_END_RE, '$1\n')
  const raw = marked
    .split('\n')
    .map(piece => piece.trim())
    .filter(Boolean)

  const sentences: string[] = []
  for (const piece of raw) {
    const previous = sentences[sentences.length - 1]
    if (previous && LOWERCASE_START_RE.test(piece)) {
      // Reticências ou travessão no meio: a frase continua.
      sentences[sentences.length - 1] = `${previous} ${piece}`
    } else {
      sentences.push(...splitLong(piece))
    }
  }

  return sentences
    .map(sentence => sentence.split(PROTECTED_DOT).join('.').trim())
    .filter(Boolean)
}

/** Achata um capítulo em frases, preservando o parágrafo de origem. */
export function chapterToSentences(paragraphs: string[]): Sentence[] {
  const out: Sentence[] = []
  let paragraphOffset = 0
  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    const normalized = normalizeParagraph(paragraph)
    let nextOffset = 0
    for (const [sentenceIndex, text] of splitSentences(normalized).entries()) {
      const offset = normalized.indexOf(text, nextOffset)
      const start = offset < 0 ? nextOffset : offset
      out.push({ text, paragraphIndex, sentenceIndex, startOffset: paragraphOffset + start })
      nextOffset = start + text.length
    }
    paragraphOffset += normalized.length + 1
  }
  return out
}

const sentenceCache = new WeakMap<ChapterRecord, Sentence[]>()
const emptySentences: Sentence[] = []

export function getChapterSentences(chapter?: ChapterRecord): Sentence[] {
  if (!chapter) return emptySentences
  let sentences = sentenceCache.get(chapter)
  if (!sentences) {
    sentences = chapterToSentences(chapter.paragraphs)
    sentenceCache.set(chapter, sentences)
  }
  return sentences
}
