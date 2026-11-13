import type { TextItem } from 'pdfjs-dist/types/src/display/api'

interface Fragment {
  text: string
  left: number
  right: number
  top: number
  size: number
}

interface Line extends Fragment {}

export interface PdfPageLayout {
  width: number
  height: number
  lines: Line[]
}

function mergeFragments(fragments: Fragment[]): Line {
  const first = fragments[0]!
  let right = first.right
  let text = first.text
  for (const fragment of fragments.slice(1)) {
    const gap = fragment.left - right
    if (gap > Math.max(1, fragment.size * 0.15) && !/\s$/.test(text) && !/^\s/.test(fragment.text)) text += ' '
    text += fragment.text
    right = Math.max(right, fragment.right)
  }
  return { ...first, right, text: text.replace(/\s+/g, ' ').trim() }
}

export function layoutPage(items: TextItem[], view: number[], rotation: number): PdfPageLayout {
  const [minX = 0, minY = 0, maxX = 0, maxY = 0] = view
  const width = maxX - minX
  const height = maxY - minY
  const fragments: Fragment[] = []
  const quarterTurn = rotation === 90 || rotation === 270
  // A rotação de exibição pode girar texto que já está na orientação de leitura.
  // Coordenadas nativas preservam suas linhas; casos com matrizes rotacionadas
  // usam a ordem de extração quando o PDF não oferece uma base horizontal.
  for (const item of items) {
    const [a = 0, b = 0, , , x = 0, y = 0] = item.transform as number[]
    if (!item.str.trim() || ![a, b, x, y, item.width, item.height].every(Number.isFinite)) continue
    if (Math.abs(b) > Math.abs(a)) continue
    fragments.push({
      text: item.str,
      left: x - minX,
      right: x - minX + Math.abs(item.width),
      top: maxY - y,
      size: Math.max(Math.abs(item.height), Math.hypot(a, b), 1),
    })
  }
  if (fragments.length < items.filter(item => item.str.trim()).length * 0.5 || quarterTurn && !fragments.length) {
    const text = items.map(item => item.str + (item.hasEOL ? '\n' : '')).join('')
    return {
      width, height,
      lines: text.split('\n').flatMap((line, index) => line.trim()
        ? [{ text: line.trim(), left: 0, right: width, top: index * 12 + height * 0.12, size: 12 }]
        : []),
    }
  }
  fragments.sort((a, b) => a.top - b.top || a.left - b.left)
  const rows: Fragment[][] = []
  for (const fragment of fragments) {
    const row = rows.at(-1)
    const baseline = row?.[0]
    if (row && baseline && Math.abs(fragment.top - baseline.top) <= Math.min(fragment.size, baseline.size) * 0.3) {
      row.push(fragment)
    } else {
      rows.push([fragment])
    }
  }
  const lines = rows.flatMap(row => {
    row.sort((a, b) => a.left - b.left)
    const runs: Fragment[][] = []
    let edge = -Infinity
    for (const fragment of row) {
      const run = runs.at(-1)
      if (run && fragment.left - edge <= Math.max(22, fragment.size * 2)) run.push(fragment)
      else runs.push([fragment])
      edge = Math.max(edge, fragment.right)
    }
    return runs.map(mergeFragments)
  })
  return { width, height, lines }
}

function edgeKey(line: Line, page: PdfPageLayout): string | null {
  const edge = line.top <= page.height * 0.09 ? 'top' : line.top >= page.height * 0.91 ? 'bottom' : ''
  if (!edge || line.text.length > 130) return null
  const text = line.text.normalize('NFC').toLowerCase().trim()
  return `${edge}:${/^\d+$/.test(text) ? '<page>' : text}`
}

function repeatedEdges(pages: PdfPageLayout[]): Set<string> {
  const counts = new Map<string, number>()
  const candidates = pages.filter(page => page.lines.length >= 4)
  for (const page of candidates) {
    const keys = new Set(page.lines.map(line => edgeKey(line, page)))
    for (const key of keys) if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return new Set([...counts].filter(([, count]) => count >= Math.max(2, Math.ceil(candidates.length * 0.6))).map(([key]) => key))
}

function splitColumns(lines: Line[], width: number): Line[][] {
  let split = 0
  let score = 0
  const minimumGap = Math.max(7, width * 0.018)
  for (let part = 35; part <= 65; part += 2) {
    const x = width * part / 100
    const left = lines.filter(line => line.right <= x - minimumGap && line.right - line.left > width * 0.12)
    const right = lines.filter(line => line.left >= x + minimumGap && line.right - line.left > width * 0.12)
    const spanning = lines.length - lines.filter(line => line.right <= x - minimumGap || line.left >= x + minimumGap).length
    const firstLeft = left[0]
    const lastLeft = left.at(-1)
    const firstRight = right[0]
    const lastRight = right.at(-1)
    if (!firstLeft || !lastLeft || !firstRight || !lastRight) continue
    const overlap = Math.min(lastLeft.top, lastRight.top) - Math.max(firstLeft.top, firstRight.top)
    if (overlap < Math.max(firstLeft.size, firstRight.size) || Math.min(left.length, right.length) < 2) continue
    if (spanning > Math.max(3, lines.length * 0.23)) continue
    const candidate = Math.min(left.length, right.length) * 3 - spanning - Math.abs(part - 50) / 50
    if (candidate > score) {
      split = x
      score = candidate
    }
  }
  if (!score) return [lines]
  const blocks: Line[][] = []
  let left: Line[] = []
  let right: Line[] = []
  const flush = () => {
    if (left.length) blocks.push(left)
    if (right.length) blocks.push(right)
    left = []
    right = []
  }
  for (const line of lines) {
    if (line.right <= split - minimumGap) left.push(line)
    else if (line.left >= split + minimumGap) right.push(line)
    else {
      flush()
      blocks.push([line])
    }
  }
  flush()
  return blocks
}

function joinLine(previous: string, next: string): string {
  if (previous.endsWith('\u00ad')) return previous.slice(0, -1) + next
  const splitWord = /(?:^|\s)([\p{L}]{3,})-$/u.exec(previous)?.[1]
  if (splitWord && /^\p{Ll}{2}/u.test(next)) {
    const keepHyphen = /^(?:auto|anti|bem|ex|hiper|inter|mal|micro|mini|pós|pré|pró|semi|sobre|sub|super|vice)$/iu.test(splitWord)
    return (keepHyphen ? previous : previous.slice(0, -1)) + next
  }
  return `${previous} ${next}`
}

function paragraphsFromLines(lines: Line[]): string[] {
  const paragraphs: string[] = []
  let paragraph = ''
  let previous: Line | undefined
  for (const line of lines) {
    if (!line.text) continue
    const typicalSize = Math.max(previous?.size ?? line.size, line.size)
    const paragraphBreak = previous && (
      line.top - previous.top > typicalSize * 1.85 ||
      (line.left - previous.left > typicalSize && /[.!?…][”’)]?$/.test(previous.text))
    )
    if (paragraphBreak && paragraph) {
      paragraphs.push(paragraph)
      paragraph = ''
    }
    paragraph = paragraph ? joinLine(paragraph, line.text) : line.text
    previous = line
  }
  if (paragraph) paragraphs.push(paragraph)
  return paragraphs
}

export function extractParagraphs(pages: PdfPageLayout[]): string[][] {
  const edges = repeatedEdges(pages)
  return pages.map(page => {
    const body = page.lines.length >= 4 ? page.lines.filter(line => !edges.has(edgeKey(line, page) ?? '')) : page.lines
    return splitColumns(body.length ? body : page.lines, page.width).flatMap(paragraphsFromLines)
  })
}
