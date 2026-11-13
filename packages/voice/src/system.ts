import type { SpeakOptions, VoiceEngine, VoiceInfo } from './types'

/** Motor de voz do aparelho, via Web Speech API. Grátis, sem download. */
export class SystemVoiceEngine implements VoiceEngine {
  readonly id = 'system'
  readonly label = 'Voz do sistema (Web Speech)'
  private token = 0
  private finishPlayback: (() => void) | null = null

  isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
  }

  async listVoices(): Promise<VoiceInfo[]> {
    if (!this.isSupported()) return []
    const synth = window.speechSynthesis
    const immediate = synth.getVoices()
    const raw = immediate.length > 0 ? immediate : await new Promise<SpeechSynthesisVoice[]>(resolve => {
      const finish = () => resolve(synth.getVoices())
      synth.addEventListener('voiceschanged', finish, { once: true })
      setTimeout(finish, 2000)
    })
    const list = raw.map(toVoiceInfo)
    // pt-BR primeiro, depois pt, depois o resto em ordem alfabética.
    return list.sort(
      (a, b) =>
        score(b) - score(a) || a.name.localeCompare(b.name, 'pt-BR'),
    )
  }

  async speak(text: string, options: SpeakOptions): Promise<void> {
    if (!this.isSupported() || !text.trim()) return
    const synth = window.speechSynthesis
    this.stop()
    const token = this.token
    // Chrome ignora speak() imediatamente depois de cancel().
    await nextTick()
    if (token !== this.token) return

    let aborted: string | null = null
    await new Promise<void>(resolve => {
      this.finishPlayback = resolve
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = clampRate(options.rate)
      utterance.lang = 'pt-BR'
      const voice = options.voiceId
        ? synth.getVoices().find(candidate => candidate.voiceURI === options.voiceId)
        : undefined
      if (voice) {
        utterance.voice = voice
        utterance.lang = voice.lang
      }
      utterance.onstart = () => {
        if (token === this.token) options.onStart?.()
      }
      utterance.onend = () => resolve()
      utterance.onerror = event => {
        aborted = event.error ?? 'unknown'
        resolve()
      }
      synth.speak(utterance)
    })

    if (token !== this.token) return // foi cancelado por stop()
    this.finishPlayback = null
    if (aborted === null) {
      options.onEnd?.()
    } else {
      options.onAbort?.(aborted)
    }
  }

  stop(): void {
    if (!this.isSupported()) return
    this.token++
    window.speechSynthesis.cancel()
    this.finishPlayback?.()
    this.finishPlayback = null
  }
}

function toVoiceInfo(voice: SpeechSynthesisVoice): VoiceInfo {
  return { id: voice.voiceURI, name: voice.name, lang: voice.lang, localService: voice.localService }
}

function score(voice: VoiceInfo): number {
  const lang = voice.lang.toLowerCase().replace('_', '-')
  if (lang.startsWith('pt-br')) return 2
  if (lang.startsWith('pt')) return 1
  return 0
}

function clampRate(rate: number): number {
  return Math.min(3, Math.max(0.5, rate))
}

function nextTick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}
