import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

const SVG_PATH = path.resolve('scripts/icon.svg')
const OUT_DIR = path.resolve('apps/web/public/icons')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f6c05a"/>
      <stop offset="1" stop-color="#e0812d"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="224" fill="#101418"/>
  <path d="M 512 330 C 436 288 330 276 248 296 L 248 704 C 330 684 436 696 512 738 Z" fill="url(#g)"/>
  <path d="M 512 330 C 588 288 694 276 776 296 L 776 704 C 694 684 588 696 512 738 Z" fill="url(#g)" opacity="0.85"/>
  <rect x="500" y="330" width="24" height="408" rx="12" fill="#101418"/>
</svg>
`

await mkdir(path.dirname(SVG_PATH), { recursive: true })
await writeFile(SVG_PATH, svg)
await mkdir(OUT_DIR, { recursive: true })

const sizes = [192, 512]
for (const size of sizes) {
  await run('magick', [
    '-background', 'none',
    SVG_PATH,
    '-resize', `${size}x${size}`,
    path.join(OUT_DIR, `icon-${size}.png`),
  ])
  // Ícone maskable: glifo centrado com folga na área segura.
  await run('magick', [
    '-size', '1024x1024',
    'xc:#101418',
    '(',
    SVG_PATH,
    '-resize', '760x760',
    ')',
    '-gravity', 'center',
    '-composite',
    '-resize', `${size}x${size}`,
    path.join(OUT_DIR, `icon-maskable-${size}.png`),
  ])
}

console.log(`Ícones gerados em ${OUT_DIR}`)
