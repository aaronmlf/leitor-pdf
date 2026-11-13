import { getChapterSentences, normalizeParagraph } from './sentences'
import type { ChapterRecord, ReadingAnchor, ReadingPosition } from './types'

const CONTEXT_LENGTH = 48
const QUOTE_LENGTH = 96
const canonicalText = new WeakMap<ChapterRecord, string>()

export function chapterText(chapter: ChapterRecord): string {
  let text = canonicalText.get(chapter)
  if (text === undefined) {
    text = chapter.paragraphs.map(normalizeParagraph).join('\n')
    canonicalText.set(chapter, text)
  }
  return text
}

export function createReadingAnchor(chapter: ChapterRecord, sentenceIndex: number): ReadingAnchor | undefined {
  const sentence = getChapterSentences(chapter)[sentenceIndex]
  if (!sentence) return chapter.sourceId
    ? { sourceId: chapter.sourceId, offset: 0, quote: '', prefix: '', suffix: '' }
    : undefined
  const offset = sentence.startOffset ?? 0
  const text = chapterText(chapter)
  const end = offset + Math.min(sentence.text.length, QUOTE_LENGTH)
  return {
    sourceId: chapter.sourceId,
    offset,
    quote: text.slice(offset, end),
    prefix: text.slice(Math.max(0, offset - CONTEXT_LENGTH), offset),
    suffix: text.slice(end, end + CONTEXT_LENGTH),
  }
}

function sentenceAt(chapter: ChapterRecord, offset: number): number {
  const sentences = getChapterSentences(chapter)
  let low = 0
  let high = sentences.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if ((sentences[middle]?.startOffset ?? 0) <= offset) low = middle + 1
    else high = middle - 1
  }
  return Math.max(0, high)
}

function contextScore(text: string, offset: number, anchor: ReadingAnchor): number {
  const prefix = text.slice(Math.max(0, offset - anchor.prefix.length), offset)
  const quoteEnd = offset + anchor.quote.length
  const suffix = text.slice(quoteEnd, quoteEnd + anchor.suffix.length)
  let score = 0
  while (score < prefix.length && prefix.at(-1 - score) === anchor.prefix.at(-1 - score)) score++
  let suffixScore = 0
  while (suffixScore < suffix.length && suffix[suffixScore] === anchor.suffix[suffixScore]) suffixScore++
  return score + suffixScore
}

interface Match { chapterIndex: number; offset: number; context: number; distance: number }

function findMatch(chapters: ChapterRecord[], indexes: number[], anchor: ReadingAnchor): Match | undefined {
  let best: Match | undefined
  for (const index of indexes) {
    const chapter = chapters[index]
    if (!chapter) continue
    const text = chapterText(chapter)
    for (let offset = text.indexOf(anchor.quote); offset !== -1; offset = text.indexOf(anchor.quote, offset + 1)) {
      const context = contextScore(text, offset, anchor)
      const distance = Math.abs(offset - anchor.offset)
      if (!best || context > best.context || (context === best.context && distance < best.distance)) {
        best = { chapterIndex: index, offset, context, distance }
      }
    }
  }
  return best
}

function clampIndex(index: number, length: number): number {
  return Number.isInteger(index) ? Math.max(0, Math.min(index, length - 1)) : 0
}

/** Mantém índices antigos e relocaliza a frase quando o texto foi reprocessado. */
export function resolveReadingPosition(chapters: ChapterRecord[], position: ReadingPosition): {
  chapterIndex: number; sentenceIndex: number; approximate: boolean
} {
  const fallbackIndex = clampIndex(position.chapterIndex, chapters.length)
  const fallback = chapters[fallbackIndex]
  const anchor = position.anchor
  if (!anchor || !fallback) {
    return {
      chapterIndex: fallbackIndex,
      sentenceIndex: clampIndex(position.sentenceIndex, getChapterSentences(fallback).length),
      approximate: false,
    }
  }

  const sourceIndex = anchor.sourceId === undefined ? -1 : chapters.findIndex(chapter => chapter.sourceId === anchor.sourceId)
  const preferredIndex = sourceIndex === -1 ? fallbackIndex : sourceIndex
  const preferred = chapters[preferredIndex] ?? fallback
  const preferredText = chapterText(preferred)
  if (!anchor.quote && sourceIndex !== -1) {
    return { chapterIndex: preferredIndex, sentenceIndex: sentenceAt(preferred, anchor.offset), approximate: false }
  }
  if (anchor.quote && preferredText.startsWith(anchor.quote, anchor.offset) &&
      contextScore(preferredText, anchor.offset, anchor) === anchor.prefix.length + anchor.suffix.length) {
    return { chapterIndex: preferredIndex, sentenceIndex: sentenceAt(preferred, anchor.offset), approximate: false }
  }

  if (anchor.quote) {
    const preferredMatch = findMatch(chapters, [preferredIndex], anchor)
    const otherIndexes = chapters.map((_, index) => index).filter(index => index !== preferredIndex)
    const match = preferredMatch ?? findMatch(chapters, otherIndexes, anchor)
    const matchedChapter = match && chapters[match.chapterIndex]
    if (match && matchedChapter) {
      return { chapterIndex: match.chapterIndex, sentenceIndex: sentenceAt(matchedChapter, match.offset), approximate: false }
    }
  }

  return { chapterIndex: preferredIndex, sentenceIndex: sentenceAt(preferred, anchor.offset), approximate: true }
}
