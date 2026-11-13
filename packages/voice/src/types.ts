export interface VoiceInfo {
  /** Identificador estável da voz (voiceURI no motor do sistema). */
  id: string
  name: string
  lang: string
  /** O navegador informa se a voz é processada no aparelho. */
  localService?: boolean
}

export interface SpeakOptions {
  /** Velocidade: 1 = normal. */
  rate: number
  /** id da voz em listVoices(); null/undefined = voz padrão do aparelho. */
  voiceId?: string | null
  /**
   * Texto da frase seguinte, para o motor pré-gerar o áudio enquanto a atual
   * toca (evita pausas entre frases no Piper). Ignorado pelo motor do sistema.
   */
  prefetch?: string | null
  /** Disparado quando o áudio começa a tocar. */
  onStart?: () => void
  /** Fim natural da fala. Não é chamado quando stop() cancela a fala. */
  onEnd?: () => void
  /** Fala abortada por erro (ex.: 'not-allowed', 'synthesis-failed'). */
  onAbort?: (reason: string) => void
}

/**
 * Motor de voz trocável. Hoje: `system` (Web Speech API).
 * Fase 2: `piper` (ONNX/WASM, offline, com cache de modelo no OPFS).
 */
export interface VoiceEngine {
  id: string
  label: string
  isSupported(): boolean
  listVoices(): Promise<VoiceInfo[]>
  speak(text: string, options: SpeakOptions): Promise<void>
  stop(): void
}

export interface DownloadProgress {
  loaded: number
  total: number
}

/** Cache de áudio gerado (implementado com IndexedDB no app). */
export interface AudioCache {
  get(key: string): Promise<Blob | null>
  put(key: string, blob: Blob): Promise<void>
}

/** Voz do catálogo do Piper, com metadados para a tela de escolha. */
export interface PiperVoiceOption {
  id: string
  name: string
  lang: string
  quality: string
  sizeBytes: number
}

/** Motores com download de modelo (ex.: Piper). */
export interface DownloadableVoiceEngine extends VoiceEngine {
  download(voiceId: string, onProgress?: (progress: DownloadProgress) => void): Promise<void>
  downloadedVoices(): Promise<string[]>
  removeVoice(voiceId: string): Promise<void>
}
