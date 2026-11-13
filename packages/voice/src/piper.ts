import type {
  AudioCache,
  DownloadProgress,
  PiperVoiceOption,
  SpeakOptions,
  VoiceEngine,
  VoiceInfo,
} from './types'

/** Voz como vem do catálogo do Piper (Hugging Face). */
interface PiperVoiceRaw {
  key: string
  name?: string
  quality?: string
  language?: { code?: string }
  files?: Record<string, { size_bytes?: number } | undefined>
}

interface PiperResponse {
  requestId: number
  type:
    | 'voices'
    | 'stored'
    | 'progress'
    | 'synthDone'
    | 'done'
    | 'error'
  voices?: PiperVoiceRaw[]
  voiceIds?: string[]
  wav?: ArrayBuffer
  loaded?: number
  total?: number
  message?: string
}

export interface PiperVoiceEngineOptions {
  /** Cria o Web Worker que roda a inferência (WASM) fora da thread da UI. */
  createWorker: () => Worker
  /** Cache persistente de áudio (IndexedDB no app). */
  cache?: AudioCache
}

export class PiperVoiceEngine implements VoiceEngine {
  readonly id = 'piper'
  readonly label = 'Piper (offline, no navegador)'
  private readonly worker: Worker
  private readonly cache?: AudioCache
  private readonly waiting = new Map<
    number,
    {
      resolve: (value: PiperResponse) => void
      reject: (error: Error) => void
      onProgress?: (progress: DownloadProgress) => void
    }
  >()
  private readonly buffer = new Map<string, Blob>()
  private rawVoices: PiperVoiceRaw[] | null = null
  private rawVoicesPromise: Promise<PiperVoiceRaw[]> | null = null
  private nextRequestId = 1
  private token = 0
  private workerError: Error | null = null
  private audio: HTMLAudioElement | null = null
  private finishPlayback: (() => void) | null = null

  constructor(options: PiperVoiceEngineOptions) {
    this.worker = options.createWorker()
    this.cache = options.cache
    this.worker.onmessage = event => this.handleMessage(event as MessageEvent<PiperResponse>)
    this.worker.onerror = event => this.failWorker(event.message || 'Falha no worker do Piper.')
  }

  isSupported(): boolean {
    return (
      typeof Worker !== 'undefined' &&
      typeof Audio !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    )
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const options = await this.listVoiceOptions()
    return options.map(option => ({ id: option.id, name: option.name, lang: option.lang }))
  }

  /** Vozes com metadados completos (qualidade, tamanho) para a tela de escolha. */
  async listVoiceOptions(): Promise<PiperVoiceOption[]> {
    const raw = await this.loadRawVoices()
    const options = raw.map(toVoiceOption)
    const langRank = (option: PiperVoiceOption): number => {
      const lang = option.lang.toLowerCase()
      if (lang.startsWith('pt-br')) return 0
      if (lang.startsWith('pt')) return 1
      return 2
    }
    const qualityRank = (option: PiperVoiceOption): number =>
      option.quality === 'high' ? 3 : option.quality === 'medium' ? 2 : option.quality === 'low' ? 1 : 0
    options.sort(
      (a, b) =>
        langRank(a) - langRank(b) ||
        qualityRank(b) - qualityRank(a) ||
        a.name.localeCompare(b.name, 'pt-BR'),
    )
    return options
  }

  async download(
    voiceId: string,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<void> {
    await this.call({ type: 'download', voiceId }, onProgress)
  }

  async downloadedVoices(): Promise<string[]> {
    const response = await this.call<PiperResponse & { voiceIds?: string[] }>({
      type: 'stored',
    })
    return response.voiceIds ?? []
  }

  async removeVoice(voiceId: string): Promise<void> {
    await this.call({ type: 'remove', voiceId })
    for (const key of [...this.buffer.keys()]) {
      if (key.startsWith(`${voiceId}:`)) this.buffer.delete(key)
    }
  }

  async speak(text: string, options: SpeakOptions): Promise<void> {
    if (!this.isSupported() || !text.trim()) return
    this.stop()
    const token = this.token
    const voiceId = options.voiceId
    if (!voiceId) {
      options.onAbort?.('Nenhuma voz Piper selecionada.')
      return
    }
    try {
      const blob = await this.ensureAudio(text, voiceId)
      if (token !== this.token) return
      // Pré-gera a próxima frase enquanto a atual toca.
      if (options.prefetch) {
        void this.ensureAudio(options.prefetch, voiceId).catch(() => undefined)
      }
      await this.play(blob, token, options)
    } catch (error) {
      if (token === this.token) {
        options.onAbort?.(error instanceof Error ? error.message : 'Falha no Piper.')
      }
    }
  }

  stop(): void {
    this.token++
    this.audio?.pause()
    this.finishPlayback?.()
  }

  dispose(): void {
    this.stop()
    this.failWorker('Motor Piper encerrado.')
  }

  private failWorker(message: string): void {
    if (this.workerError) return
    this.workerError = new Error(message)
    this.worker.terminate()
    for (const entry of this.waiting.values()) entry.reject(this.workerError)
    this.waiting.clear()
  }

  private async loadRawVoices(): Promise<PiperVoiceRaw[]> {
    if (this.rawVoices) return this.rawVoices
    if (!this.rawVoicesPromise) {
      this.rawVoicesPromise = (async () => {
        const response = await this.call<PiperResponse & { voices?: PiperVoiceRaw[] }>({
          type: 'voices',
        })
        this.rawVoices = response.voices ?? []
        return this.rawVoices
      })().finally(() => { this.rawVoicesPromise = null })
    }
    return this.rawVoicesPromise
  }

  private async ensureAudio(text: string, voiceId: string): Promise<Blob> {
    const key = cacheKey(voiceId, text)
    const buffered = this.buffer.get(key)
    if (buffered) return buffered

    const cached = await (this.cache?.get(key).catch(() => null) ?? Promise.resolve(null))
    if (cached) {
      this.remember(key, cached)
      return cached
    }

    const response = await this.call<PiperResponse & { wav?: ArrayBuffer }>({
      type: 'synthesize',
      voiceId,
      text,
    })
    if (!response.wav) throw new Error('Resposta sem áudio do worker.')
    const blob = new Blob([response.wav], { type: 'audio/wav' })
    this.remember(key, blob)
    if (this.cache) {
      void this.cache.put(key, blob).catch(() => undefined)
    }
    return blob
  }

  private remember(key: string, blob: Blob): void {
    this.buffer.set(key, blob)
    while (this.buffer.size > 8) {
      const oldest = this.buffer.keys().next().value
      if (oldest === undefined) break
      this.buffer.delete(oldest)
    }
  }

  private async play(blob: Blob, token: number, options: SpeakOptions): Promise<void> {
    const url = URL.createObjectURL(blob)
    const audio = new Audio()
    audio.src = url
    audio.playbackRate = clampRate(options.rate)
    this.audio = audio

    let failure: string | null = null
    await new Promise<void>(resolve => {
      this.finishPlayback = resolve
      audio.onended = () => resolve()
      audio.onerror = () => {
        failure = audio.error?.message ?? 'Falha ao tocar o áudio.'
        resolve()
      }
      void audio.play().then(() => {
        if (token === this.token) options.onStart?.()
      }, () => {
        failure = 'Reprodução bloqueada pelo navegador.'
        resolve()
      })
    })

    audio.onended = null
    audio.onerror = null
    if (this.audio === audio) {
      this.audio = null
      this.finishPlayback = null
    }
    URL.revokeObjectURL(url)

    if (token !== this.token) return
    if (failure === null) options.onEnd?.()
    else options.onAbort?.(failure)
  }

  private handleMessage(event: MessageEvent<PiperResponse>): void {
    const message = event.data
    if (!message || typeof message.requestId !== 'number') return
    const entry = this.waiting.get(message.requestId)
    if (!entry) return
    if (message.type === 'progress') {
      entry.onProgress?.({
        loaded: message.loaded ?? 0,
        total: message.total ?? 0,
      })
      return
    }
    this.waiting.delete(message.requestId)
    if (message.type === 'error') {
      entry.reject(new Error(message.message ?? 'Erro desconhecido no worker.'))
    } else {
      entry.resolve(message)
    }
  }

  private call<T extends PiperResponse>(
    message: Record<string, unknown>,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<T> {
    if (this.workerError) return Promise.reject(this.workerError)
    const requestId = this.nextRequestId++
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(requestId, {
        resolve: resolve as (value: PiperResponse) => void,
        reject,
        onProgress,
      })
      try {
        this.worker.postMessage({ ...message, requestId })
      } catch (error) {
        this.waiting.delete(requestId)
        reject(error)
      }
    })
  }
}

function toVoiceOption(raw: PiperVoiceRaw): PiperVoiceOption {
  const code = raw.language?.code ?? raw.key.split('-')[0] ?? ''
  const sizeBytes = Object.values(raw.files ?? {}).reduce(
    (sum, file) => sum + (file?.size_bytes ?? 0),
    0,
  )
  return {
    id: raw.key,
    name: raw.name || raw.key,
    lang: code.replace('_', '-'),
    quality: String(raw.quality ?? ''),
    sizeBytes,
  }
}

function cacheKey(voiceId: string, text: string): string {
  return `${voiceId}:${hashText(text)}`
}

/** FNV-1a: chave curta e estável para o cache de frases. */
function hashText(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function clampRate(rate: number): number {
  return Math.min(3, Math.max(0.5, rate))
}
