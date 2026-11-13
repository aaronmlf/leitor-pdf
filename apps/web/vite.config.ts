import { cpSync, createReadStream, mkdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve, sep } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const require = createRequire(import.meta.url)
const pdfPackage = dirname(require.resolve('pdfjs-dist/package.json'))
const ortDistribution = dirname(require.resolve('onnxruntime-web'))
const piperPackage = dirname(require.resolve('@diffusionstudio/piper-wasm/package.json'))
const pdfDirectories = ['cmaps', 'iccs', 'standard_fonts', 'wasm']
const runtimeFiles = [
  ...pdfDirectories.map(name => ({ source: join(pdfPackage, name), directory: 'pdf-assets', name })),
  { source: join(pdfPackage, 'LICENSE'), directory: 'pdf-assets', name: 'LICENSE' },
  ...['', '-threaded', '-simd', '-simd-threaded', '-simd.jsep', '-simd-threaded.jsep'].map(variant => {
    const name = `ort-wasm${variant}.wasm`
    return { source: join(ortDistribution, name), directory: 'ort', name }
  }),
  ...['piper_phonemize.data', 'piper_phonemize.wasm'].map(name => ({
    source: join(piperPackage, 'build', name), directory: 'piper', name,
  })),
]

function localRuntimeAssets(): Plugin {
  return {
    name: 'local-runtime-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = (request.url ?? '').split('?')[0] ?? ''
        const asset = runtimeFiles.find(({ directory, name }) => {
          const prefix = `/${directory}/${name}`
          return url === prefix || (directory === 'pdf-assets' && pdfDirectories.includes(name) && url.startsWith(`${prefix}/`))
        })
        if (!asset) return next()
        const prefix = `/${asset.directory}/${asset.name}`
        const path = resolve(asset.source, `.${url.slice(prefix.length)}`)
        if (path !== asset.source && !path.startsWith(`${asset.source}${sep}`)) return next()
        const stat = statSync(path, { throwIfNoEntry: false })
        if (!stat?.isFile()) return next()
        const extension = extname(path)
        const contentType = extension === '.wasm' ? 'application/wasm' :
          extension === '.js' ? 'text/javascript' : 'application/octet-stream'
        response.setHeader('Content-Type', contentType)
        response.setHeader('Content-Length', stat.size)
        createReadStream(path).pipe(response)
      })
    },
    writeBundle(output) {
      for (const asset of runtimeFiles) {
        const directory = join(output.dir ?? 'dist', asset.directory)
        mkdirSync(directory, { recursive: true })
        cpSync(asset.source, join(directory, asset.name), { recursive: true })
      }
    },
  }
}

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
  },
  plugins: [
    react(),
    localRuntimeAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        id: '/',
        lang: 'pt-BR',
        name: 'Leitor — livros em voz alta',
        short_name: 'Leitor',
        description: 'Leitor de EPUB, TXT e PDF com leitura em voz alta e biblioteca offline.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#101418',
        theme_color: '#101418',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,epub}', 'pdf-assets/**/*'],
        navigateFallback: '/index.html',
        // WASMs do motor TTS ficam fora do precache (grandes) e entram no cache
        // de execução: primeira visita online, depois funcionam offline.
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) =>
              url.pathname.startsWith('/ort/') || url.pathname.startsWith('/piper/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'tts-wasm',
              expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  // Pacotes do monorepo são código-fonte TS, não dependências pré-empacotadas.
  optimizeDeps: {
    exclude: ['@leitor/core', '@leitor/voice'],
  },
})
