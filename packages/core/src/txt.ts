import type { ParsedChapter } from './types'

/**
 * Parser de arquivos .txt de livros. Heurísticas:
 * - UTF-8 com fallback para Windows-1252 (arquivos antigos em pt-BR);
 * - capítulos por linhas "Capítulo N", "Parte N", "Chapter N", romanos
 *   isolados, prólogo/epílogo/prefácio/introdução/conclusão;
 * - parágrafos por linha em branco (arquivos de projeto Gutenberg usam
 *   quebra dura em ~72 colunas, então linhas seguidas se juntam) ou por
 *   recuo grande no começo da linha (estilo sem linha em branco);
 * - título do livro: primeira linha curta, sem pontuação final, separada do corpo.
 */

const HEADING_RE =
  /^\s*(?:cap[íi]tulo\s+(?:[0-9IVXLCivxlc]{1,7}|primeir[ao]|segund[ao]|terceir[ao]|[úu]nic[ao]|d[ée]cim[ao]|vig[ée]sim[ao])\b|chapter\s+[0-9ivxlcIVXLC]{1,7}\b|parte\s+(?:[0-9IVXLCivxlc]{1,7}|primeir[ao]|segund[ao]|terceir[ao])\b|pr[óo]logo\b|ep[íi]logo\b|pref[áa]cio\b|introdu[çc][ãa]o\b|conclus[ãa]o\b|posf[áa]cio\b)/i

const ROMAN_HEADING_RE = /^\s*[IVXLC]{1,6}\.?\s*$/

function isHeading(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > 60) return false
  if (HEADING_RE.test(trimmed)) return true
  return ROMAN_HEADING_RE.test(trimmed)
}

function decode(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('windows-1252').decode(buffer)
  }
}

export interface ParsedTxt {
  title: string
  chapters: ParsedChapter[]
}

/** Converte o texto bruto de um .txt em título + capítulos/parágrafos. */
export function parseTxt(raw: ArrayBuffer, fallbackName: string): ParsedTxt {
  const text = decode(raw).replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
  const lines = text.split('\n')

  let start = lines.findIndex(line => line.trim())
  if (start === -1) return { title: fallbackName, chapters: [] }

  // Uma linha isolada só é título se também houver texto para ler.
  let title = fallbackName
  const candidate = lines[start]?.trim()
  if (candidate && candidate.length <= 60 && !/[.!?:;,]$/.test(candidate) && !isHeading(candidate) &&
      !lines[start + 1]?.trim() && lines.some((line, index) => index > start + 1 && line.trim())) {
    title = candidate
    start++
  }

  const chapters: ParsedChapter[] = []
  let currentTitle: string | null = null
  let paragraphs: string[] = []
  let buffer: string[] = []
  const sectionCounts = new Map<string, number>()

  const flushParagraph = () => {
    if (buffer.length === 0) return
    const paragraph = buffer.join(' ').replace(/\s+/g, ' ').trim()
    buffer = []
    if (paragraph) paragraphs.push(paragraph)
  }

  const flushChapter = () => {
    flushParagraph()
    if (paragraphs.length > 0) {
      const section = currentTitle?.normalize('NFC').toLowerCase() ?? ''
      const count = (sectionCounts.get(section) ?? 0) + 1
      sectionCounts.set(section, count)
      chapters.push({ title: currentTitle ?? title, paragraphs, sourceId: `txt:${section}:${count}` })
    }
    paragraphs = []
  }

  for (const line of lines.slice(start)) {
    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      continue
    }
    if (isHeading(trimmed)) {
      flushChapter()
      currentTitle = trimmed.replace(/\s+/g, ' ').replace(/[-–—:.]\s*$/, '').trim() || title
      continue
    }
    // Recuo grande no começo da linha = parágrafo novo (estilo sem linha vazia).
    if (/^(\t|\s{4,})/.test(line) && buffer.length > 0) flushParagraph()
    buffer.push(trimmed)
  }
  flushChapter()

  return { title, chapters }
}
