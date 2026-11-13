import { Capacitor, registerPlugin } from '@capacitor/core'

interface BackupFilesPlugin {
  begin(options: { name: string }): Promise<{ selected: boolean }>
  append(options: { base64: string }): Promise<void>
  finish(): Promise<void>
  cancel(): Promise<void>
}

const BackupFiles = registerPlugin<BackupFilesPlugin>('BackupFiles')
const chunkSize = 96 * 1024

export async function saveBackup(blob: Blob, name: string): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
    return true
  }

  const { selected } = await BackupFiles.begin({ name })
  if (!selected) return false
  try {
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      const chunk = blob.slice(offset, offset + chunkSize)
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
        reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o backup.'))
        reader.readAsDataURL(chunk)
      })
      await BackupFiles.append({ base64 })
    }
    await BackupFiles.finish()
    return true
  } catch (cause) {
    await BackupFiles.cancel().catch(() => undefined)
    throw cause
  }
}
