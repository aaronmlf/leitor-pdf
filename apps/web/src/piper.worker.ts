/// <reference lib="webworker" />

import * as tts from '@mintplex-labs/piper-tts-web'

// WASMs self-hospedados (public/): sem CDN, funciona offline após o primeiro uso.
const LOCAL_WASM_PATHS = {
  onnxWasm: '/ort/',
  piperData: '/piper/piper_phonemize.data',
  piperWasm: '/piper/piper_phonemize.wasm',
}

type Request =
  | { type: 'voices'; requestId: number }
  | { type: 'stored'; requestId: number }
  | { type: 'download'; requestId: number; voiceId: string }
  | { type: 'cancel-download'; requestId: number }
  | { type: 'synthesize'; requestId: number; voiceId: string; text: string }
  | { type: 'remove'; requestId: number; voiceId: string }

type WorkerResponse =
  | { type: 'voices'; requestId: number; voices: unknown[] }
  | { type: 'stored'; requestId: number; voiceIds: string[] }
  | { type: 'progress'; requestId: number; loaded: number; total: number }
  | { type: 'synthDone'; requestId: number; wav: ArrayBuffer }
  | { type: 'done'; requestId: number }
  | { type: 'error'; requestId: number; message: string }

interface WorkerContext {
  addEventListener(type: 'message', listener: (event: MessageEvent<Request>) => void): void
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void
}

const ctx = self as unknown as WorkerContext

// Download e síntese em fila: uma inferência por vez evita disputar o modelo/sessão.
let chain: Promise<unknown> = Promise.resolve()
const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
  const result = chain.then(job, job)
  chain = result.catch(() => undefined)
  return result
}

// A lib trata TtsSession como singleton e trocar de voz sem reinit usa o
// modelo errado: guardamos uma sessão por voz e zeramos o singleton antes.
const sessions = new Map<string, Promise<InstanceType<typeof tts.TtsSession>>>()
const downloads = new Map<number, AbortController>()

async function voiceDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('piper', { create: true })
}

async function hasVoice(directory: FileSystemDirectoryHandle, voiceId: string): Promise<boolean> {
  try {
    const [model, config] = await Promise.all([
      directory.getFileHandle(`${voiceId}.onnx`),
      directory.getFileHandle(`${voiceId}.onnx.json`),
    ])
    JSON.parse(await (await config.getFile()).text())
    return (await model.getFile()).size > 0
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof DOMException && error.name === 'NotFoundError')) {
      return false
    }
    throw error
  }
}

async function fetchVoiceFile(path: string, signal: AbortSignal): Promise<Response> {
  const response = await fetch(`${tts.HF_BASE}/${path}`, { signal })
  if (!response.ok) throw new Error(`O download da voz falhou (HTTP ${response.status}).`)
  return response
}

async function saveVoiceFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onProgress?: (loaded: number) => void,
): Promise<void> {
  const file = await directory.getFileHandle(name, { create: true })
  // O acesso síncrono no worker também funciona em WebViews sem createWritable().
  const writer = await file.createSyncAccessHandle()
  const reader = stream.getReader()
  try {
    writer.truncate(0)
    let loaded = 0
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      const written = writer.write(value, { at: loaded })
      if (written !== value.byteLength) throw new Error('A gravação da voz ficou incompleta.')
      loaded += written
      onProgress?.(loaded)
    }
    if (loaded === 0) throw new Error('O download da voz veio vazio.')
    writer.flush()
  } catch (error) {
    void reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
    writer.close()
  }
}

async function removeVoice(directory: FileSystemDirectoryHandle, voiceId: string): Promise<void> {
  await Promise.all([`${voiceId}.onnx.json`, `${voiceId}.onnx`].map(async name => {
    try {
      await directory.removeEntry(name)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
    }
  }))
}

async function downloadVoice(voiceId: string, requestId: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const path = Object.hasOwn(tts.PATH_MAP, voiceId) ? tts.PATH_MAP[voiceId] : undefined
  if (!path) throw new Error('Esta voz não está disponível para download.')

  const directory = await voiceDirectory()
  if (await hasVoice(directory, voiceId)) return
  const config = await (await fetchVoiceFile(`${path}.json`, signal)).blob()
  JSON.parse(await config.text())

  // A configuração é gravada por último para que uma gravação parcial não apareça como voz baixada.
  await removeVoice(directory, voiceId)
  const response = await fetchVoiceFile(path, signal)
  if (!response.body) throw new Error('O download da voz veio vazio.')
  const total = Number(response.headers.get('content-length') ?? 0)
  try {
    await saveVoiceFile(directory, `${voiceId}.onnx`, response.body, signal, loaded => {
      ctx.postMessage({ type: 'progress', requestId, loaded, total })
    })
    await saveVoiceFile(directory, `${voiceId}.onnx.json`, config.stream(), signal)
    signal.throwIfAborted()
  } catch (error) {
    await removeVoice(directory, voiceId).catch(() => undefined)
    throw error
  }
}

function getSession(voiceId: string): Promise<InstanceType<typeof tts.TtsSession>> {
  const existing = sessions.get(voiceId)
  if (existing) return existing
  const created = (async () => {
    if (!await hasVoice(await voiceDirectory(), voiceId)) {
      throw new Error('Baixe esta voz antes de ouvir.')
    }
    ;(tts.TtsSession as unknown as { _instance: unknown })._instance = null
    return tts.TtsSession.create({ voiceId, wasmPaths: LOCAL_WASM_PATHS })
  })()
  sessions.set(voiceId, created)
  created.catch(() => sessions.delete(voiceId))
  return created
}

ctx.addEventListener('message', event => {
  const req = event.data
  void (async () => {
    try {
      switch (req.type) {
        case 'voices': {
          const voices = (await tts.voices()).filter(voice => Object.hasOwn(tts.PATH_MAP, voice.key))
          ctx.postMessage({ type: 'voices', requestId: req.requestId, voices })
          break
        }
        case 'stored': {
          const directory = await voiceDirectory()
          const candidates = await tts.stored()
          const voiceIds = (await Promise.all(candidates.map(async id =>
            await hasVoice(directory, id) ? id : null,
          ))).filter(id => id !== null)
          ctx.postMessage({ type: 'stored', requestId: req.requestId, voiceIds })
          break
        }
        case 'download': {
          const controller = new AbortController()
          downloads.set(req.requestId, controller)
          try {
            await enqueue(() => downloadVoice(req.voiceId, req.requestId, controller.signal))
            ctx.postMessage({ type: 'done', requestId: req.requestId })
          } finally {
            downloads.delete(req.requestId)
          }
          break
        }
        case 'cancel-download': {
          downloads.get(req.requestId)?.abort()
          break
        }
        case 'synthesize': {
          const wav = await enqueue(async () => {
            const session = await getSession(req.voiceId)
            const blob = await session.predict(req.text)
            return blob.arrayBuffer()
          })
          ctx.postMessage({ type: 'synthDone', requestId: req.requestId, wav }, [wav])
          break
        }
        case 'remove': {
          await enqueue(async () => {
            await removeVoice(await voiceDirectory(), req.voiceId)
            sessions.delete(req.voiceId)
          })
          ctx.postMessage({ type: 'done', requestId: req.requestId })
          break
        }
      }
    } catch (error) {
      ctx.postMessage({
        type: 'error',
        requestId: req.requestId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })()
})
