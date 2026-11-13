import { Capacitor, registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

export type BackgroundAudioAction = 'play' | 'pause' | 'previous' | 'next'
export type BackgroundAudioInterruption = 'focus' | 'route' | 'timer'

export interface BackgroundPlaybackState {
  title: string
  subtitle?: string
  position: number
  total?: number
  status: 'playing' | 'paused' | 'buffering'
  canGoPrevious: boolean
  canGoNext: boolean
  artworkDataUrl?: string
}

interface BackgroundAudioPlugin {
  start(): Promise<{ started: boolean }>
  stop(options: { keepSession?: boolean }): Promise<void>
  updateState(state: BackgroundPlaybackState): Promise<void>
  setTimer(options: { deadline: number | null }): Promise<void>
  addListener(event: 'audioFocusLost', listener: (event: { reason?: BackgroundAudioInterruption; deadline?: number }) => void): Promise<PluginListenerHandle>
  addListener(event: 'audioAction', listener: (event: { action: BackgroundAudioAction }) => void): Promise<PluginListenerHandle>
}

const BackgroundAudio = registerPlugin<BackgroundAudioPlugin>('BackgroundAudio')

export function isAndroidAudio(): boolean {
  return Capacitor.getPlatform() === 'android'
}

export async function startBackgroundAudio(): Promise<boolean> {
  if (!isAndroidAudio()) return true
  try {
    const { started } = await BackgroundAudio.start()
    return started
  } catch (error) {
    console.warn('Falha ao iniciar o áudio em segundo plano', error)
    return false
  }
}

export async function stopBackgroundAudio(options: { keepSession?: boolean } = {}): Promise<void> {
  if (!isAndroidAudio()) return
  try {
    await BackgroundAudio.stop(options)
  } catch (error) {
    console.warn('Falha ao parar o áudio em segundo plano', error)
  }
}

export async function publishBackgroundAudioState(state: BackgroundPlaybackState): Promise<void> {
  if (!isAndroidAudio()) return
  try {
    await BackgroundAudio.updateState(state)
  } catch (error) {
    console.warn('Falha ao atualizar os controles de mídia', error)
  }
}

export async function setBackgroundAudioTimer(deadline: number | null): Promise<void> {
  if (!isAndroidAudio()) return
  try {
    await BackgroundAudio.setTimer({ deadline })
  } catch (error) {
    console.warn('Falha ao configurar o temporizador de áudio', error)
  }
}

export async function prepareBackgroundAudioArtwork(cover: Blob | null): Promise<string | undefined> {
  if (!isAndroidAudio() || !cover) return

  const url = URL.createObjectURL(cover)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight) return

    const scale = Math.min(1, 192 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return
    context.fillStyle = '#20252a'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const thumbnail = canvas.toDataURL('image/jpeg', 0.78)
    return thumbnail.startsWith('data:image/jpeg;base64,') ? thumbnail : undefined
  } catch {
    return undefined
  } finally {
    URL.revokeObjectURL(url)
  }
}

function listen(register: (isActive: () => boolean) => Promise<PluginListenerHandle>): () => void {
  if (!isAndroidAudio()) return () => {}

  let active = true
  const listener = register(() => active)
  void listener.catch(error => console.warn('Falha ao acompanhar os controles de mídia', error))
  return () => {
    active = false
    void listener.then(handle => handle.remove(), () => {}).catch(error => {
      console.warn('Falha ao remover o evento de mídia', error)
    })
  }
}

export function onBackgroundAudioFocusLost(callback: (reason?: BackgroundAudioInterruption, deadline?: number) => void): () => void {
  return listen(isActive => BackgroundAudio.addListener('audioFocusLost', ({ reason, deadline }) => {
    if (isActive()) callback(reason, deadline)
  }))
}

export function onBackgroundAudioAction(callback: (action: BackgroundAudioAction) => void): () => void {
  return listen(isActive => BackgroundAudio.addListener('audioAction', ({ action }) => {
    if (isActive()) callback(action)
  }))
}
