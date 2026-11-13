import { Capacitor, registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

interface BackgroundAudioPlugin {
  start(): Promise<{ started: boolean }>
  stop(): Promise<void>
  addListener(event: 'audioFocusLost', listener: () => void): Promise<PluginListenerHandle>
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

export async function stopBackgroundAudio(): Promise<void> {
  if (!isAndroidAudio()) return
  try {
    await BackgroundAudio.stop()
  } catch (error) {
    console.warn('Falha ao parar o áudio em segundo plano', error)
  }
}

export function onBackgroundAudioFocusLost(callback: () => void): () => void {
  if (!isAndroidAudio()) return () => {}

  let active = true
  const listener = BackgroundAudio.addListener('audioFocusLost', () => {
    if (active) callback()
  })
  void listener.catch(error => console.warn('Falha ao acompanhar o foco de áudio', error))
  return () => {
    active = false
    void listener.then(handle => handle.remove(), () => {}).catch(error => {
      console.warn('Falha ao remover o evento de foco de áudio', error)
    })
  }
}
