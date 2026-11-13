import { useEffect, useState } from 'react'
import { getChapterSentences } from '@leitor/core'
import type { ChapterRecord } from '@leitor/core'

export interface BookMatch {
  chapterIndex: number
  sentenceIndex: number
  start: number
  length: number
  paragraph: string
}

export function foldSearchText(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

function sourceOffset(text: string, offset: number): number {
  let folded = 0
  let original = 0
  for (const char of text) {
    const size = foldSearchText(char).length
    if (size > 0 && folded >= offset) return original
    folded += size
    original += char.length
  }
  return original
}

function* searchBook(chapters: ChapterRecord[], query: string, matches: BookMatch[]) {
  for (const [chapterIndex, chapter] of chapters.entries()) {
    const sentences = getChapterSentences(chapter)
    for (let first = 0; first < sentences.length;) {
      const paragraphIndex = sentences[first]?.paragraphIndex
      const offsets: number[] = []
      let paragraph = ''
      let next = first
      while (next < sentences.length && sentences[next]?.paragraphIndex === paragraphIndex) {
        if (paragraph) paragraph += ' '
        offsets.push(paragraph.length)
        paragraph += sentences[next]?.text ?? ''
        next++
      }
      const folded = foldSearchText(paragraph)
      let sentence = 0
      for (let found = folded.indexOf(query); found >= 0; found = folded.indexOf(query, found + query.length)) {
        const start = folded.length === paragraph.length ? found : sourceOffset(paragraph, found)
        const end = folded.length === paragraph.length
          ? found + query.length
          : sourceOffset(paragraph, found + query.length)
        while (offsets[sentence + 1] !== undefined && offsets[sentence + 1]! <= start) sentence++
        matches.push({ chapterIndex, sentenceIndex: first + sentence, start, length: end - start, paragraph })
      }
      first = next
      yield
    }
    yield
  }
}

const emptyMatches: BookMatch[] = []

export function useBookSearch(chapters: ChapterRecord[] | undefined, input: string) {
  const query = foldSearchText(input.trim()).replace(/\s+/g, ' ')
  const [result, setResult] = useState<{ query: string; chapters: ChapterRecord[]; matches: BookMatch[] }>()

  useEffect(() => {
    if (!query || !chapters) return
    const matches: BookMatch[] = []
    const work = searchBook(chapters, query, matches)
    let timer = window.setTimeout(step, 160)

    function step() {
      const end = performance.now() + 8
      while (performance.now() < end) {
        if (work.next().done) {
          if (chapters) setResult({ query, chapters, matches })
          return
        }
      }
      timer = window.setTimeout(step, 0)
    }

    return () => window.clearTimeout(timer)
  }, [chapters, query])

  const ready = result?.query === query && result.chapters === chapters
  return { matches: ready ? result.matches : emptyMatches, searching: !!query && !ready }
}
