import JSZip from 'jszip'
import type { OutlineEntry, ParsedBook, ParsedChapter } from './types'

export type ParsedEpub = ParsedBook

/** EPUB é XML, mas livros reais às vezes têm XML quebrado: parse tolerante. */
function parseXmlOrHtml(text: string): Document {
  const strict = new DOMParser().parseFromString(text, 'application/xml')
  if (strict.getElementsByTagName('parsererror').length === 0) return strict
  return new DOMParser().parseFromString(text, 'text/html')
}

function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href)
  } catch {
    return href
  }
}

/** Junta o diretório base com o href relativo, resolvendo `../`. */
function resolveHref(baseDir: string, href: string): string {
  const joined = baseDir ? `${baseDir}/${href}` : href
  const stack: string[] = []
  for (const part of joined.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE',
  'SECTION', 'ARTICLE', 'ASIDE', 'MAIN', 'HEADER', 'FOOTER', 'NAV',
  'TABLE', 'TR', 'TD', 'TH', 'UL', 'OL', 'DL', 'DD', 'DT',
  'FIGURE', 'FIGCAPTION', 'PRE', 'HR',
])

/** Extrai parágrafos de texto do XHTML, quebrando em elementos de bloco. */
function htmlToChapter(html: string, fallbackTitle: string): ParsedChapter & { fragments: Map<string, number> } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, link, meta').forEach(el => el.remove())
  const body = doc.body

  const paragraphs: string[] = []
  const fragments = new Map<string, number>()
  let buffer: string[] = []
  const flush = () => {
    const text = buffer.join(' ').replace(/\s+/g, ' ').trim()
    if (text) paragraphs.push(text)
    buffer = []
  }
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      buffer.push(node.nodeValue ?? '')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    const tag = el.tagName
    const isBlock = BLOCK_TAGS.has(tag)
    if (isBlock) flush()
    const id = el.id || (tag === 'A' ? el.getAttribute('name') : null)
    if (id && !fragments.has(id)) fragments.set(id, paragraphs.length)
    if (tag === 'BR') {
      flush()
      return
    }
    for (const child of Array.from(el.childNodes)) walk(child)
    if (isBlock) flush()
  }
  walk(body)
  flush()

  const heading = body.querySelector('h1, h2, h3, h4, h5, h6')?.textContent?.replace(/\s+/g, ' ').trim()
  const title = heading || doc.title?.trim() || fallbackTitle
  return { title, paragraphs, fragments }
}

function folderOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

type OutlineDestination = Pick<OutlineEntry, 'chapterIndex' | 'paragraphIndex'>
type DestinationResolver = (href: string) => OutlineDestination | undefined

function epub3Outline(doc: Document, resolve: DestinationResolver): OutlineEntry[] {
  const toc = Array.from(doc.getElementsByTagNameNS('*', 'nav')).find(nav =>
    (nav.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? nav.getAttribute('epub:type') ?? '')
      .split(/\s+/).includes('toc') || nav.getAttribute('role') === 'doc-toc',
  )
  function entries(list: Element): OutlineEntry[] {
    return Array.from(list.children).filter(element => element.localName === 'li').flatMap(item => {
      const link = Array.from(item.children).find(element => element.localName === 'a')
      const nested = Array.from(item.children).find(element => element.localName === 'ol')
      const children = nested ? entries(nested) : []
      const title = link?.textContent?.replace(/\s+/g, ' ').trim()
      const destination = resolve(link?.getAttribute('href') ?? '')
      if (!title || !destination) return children
      return [{ title, ...destination, children: children.length ? children : undefined }]
    })
  }
  const list = toc?.getElementsByTagNameNS('*', 'ol')[0]
  return list ? entries(list) : []
}

function epub2Outline(doc: Document, resolve: DestinationResolver): OutlineEntry[] {
  function entries(parent: Element): OutlineEntry[] {
    return Array.from(parent.children).filter(element => element.localName === 'navPoint').flatMap(item => {
      const content = Array.from(item.children).find(element => element.localName === 'content')
      const title = item.getElementsByTagNameNS('*', 'navLabel')[0]?.textContent?.replace(/\s+/g, ' ').trim()
      const destination = resolve(content?.getAttribute('src') ?? '')
      const children = entries(item)
      if (!title || !destination) return children
      return [{ title, ...destination, children: children.length ? children : undefined }]
    })
  }
  const navMap = doc.getElementsByTagNameNS('*', 'navMap')[0]
  return navMap ? entries(navMap) : []
}

export async function parseEpub(file: Blob): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(file)

  const container = zip.file('META-INF/container.xml')
  if (!container) throw new Error('EPUB inválido: META-INF/container.xml ausente.')
  const containerDoc = parseXmlOrHtml(await container.async('string'))
  const opfPath =
    containerDoc.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path') ?? ''
  const opfFile = zip.file(opfPath)
  if (!opfFile) throw new Error('EPUB inválido: arquivo OPF ausente.')

  const opf = parseXmlOrHtml(await opfFile.async('string'))
  const baseDir = folderOf(opfPath)

  const metadata = opf.getElementsByTagNameNS('*', 'metadata')[0]
  const title = metadata?.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim() || 'Livro sem título'
  const author = metadata?.getElementsByTagNameNS('*', 'creator')[0]?.textContent?.trim() || ''

  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>()
  for (const item of Array.from(opf.getElementsByTagNameNS('*', 'item'))) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (id && href) {
      manifest.set(id, {
        href: decodeHref(href),
        mediaType: item.getAttribute('media-type') ?? '',
        properties: item.getAttribute('properties') ?? '',
      })
    }
  }

  const spine = Array.from(opf.getElementsByTagNameNS('*', 'itemref'))
    .map(ref => ref.getAttribute('idref'))
    .filter((id): id is string => id != null)
    .map(id => manifest.get(id))
    .filter((item): item is NonNullable<typeof item> => {
      if (!item) return false
      return /xhtml|html/i.test(item.mediaType) || /\.x?html?$/i.test(item.href)
    })

  let cover: Blob | null = null
  const coverMetaId =
    Array.from(opf.getElementsByTagNameNS('*', 'meta'))
      .find(m => m.getAttribute('name') === 'cover')
      ?.getAttribute('content') ?? null
  const coverItem =
    (coverMetaId ? manifest.get(coverMetaId) : undefined) ??
    Array.from(manifest.values()).find(item =>
      item.properties.split(/\s+/).includes('cover-image'))
  if (coverItem) {
    const coverFile = zip.file(resolveHref(baseDir, coverItem.href))
    if (coverFile) cover = await coverFile.async('blob')
  }

  const chapters: ParsedChapter[] = []
  const chapterPaths = new Map<string, { index: number; fragments: Map<string, number>; paragraphCount: number }>()
  for (const item of spine) {
    const path = resolveHref(baseDir, item.href)
    const chapterFile = zip.file(path)
    if (!chapterFile) continue
    const { fragments, ...chapter } = htmlToChapter(
      await chapterFile.async('string'),
      `Capítulo ${chapters.length + 1}`,
    )
    if (chapter.paragraphs.length === 0) continue
    chapterPaths.set(path, { index: chapters.length, fragments, paragraphCount: chapter.paragraphs.length })
    chapters.push({ ...chapter, sourceId: `epub:${path}` })
  }

  const epub3Nav = [...manifest.values()].find(item => item.properties.split(/\s+/).includes('nav'))
  const epub2NavId = opf.getElementsByTagNameNS('*', 'spine')[0]?.getAttribute('toc')
  const epub2Nav = (epub2NavId ? manifest.get(epub2NavId) : undefined) ??
    [...manifest.values()].find(item => item.mediaType === 'application/x-dtbncx+xml')
  let outline: OutlineEntry[] = []
  for (const [nav, parse] of [[epub3Nav, epub3Outline], [epub2Nav, epub2Outline]] as const) {
    if (!nav) continue
    const path = resolveHref(baseDir, nav.href)
    const navFile = zip.file(path)
    if (!navFile) continue
    const resolve: DestinationResolver = href => {
      if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return undefined
      const hashIndex = href.indexOf('#')
      const target = hashIndex === -1 ? href : href.slice(0, hashIndex)
      const fragment = hashIndex === -1 ? '' : decodeHref(href.slice(hashIndex + 1))
      const targetPath = target ? resolveHref(folderOf(path), decodeHref(target.split('?')[0] ?? '')) : path
      const chapter = chapterPaths.get(targetPath)
      if (!chapter) return undefined
      const paragraphIndex = chapter.fragments.get(fragment)
      return {
        chapterIndex: chapter.index,
        paragraphIndex: paragraphIndex === undefined ? undefined : Math.min(paragraphIndex, chapter.paragraphCount - 1),
      }
    }
    outline = parse(parseXmlOrHtml(await navFile.async('string')), resolve)
    if (outline.length) break
  }

  return { title, author, cover, chapters, outline: outline.length ? outline : undefined, parserVersion: 2 }
}
