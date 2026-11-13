import { useEffect, useState } from 'react'
import { clearAudioCache, db } from '@leitor/core'
import { PiperVoiceEngine } from '@leitor/voice'
import { ocrPackage } from '../pdf/ocrPackage'

interface StoredVoice { id: string; bytes: number }
interface StorageSummary { books: number; audio: number; voices: StoredVoice[] | null }
type IterableDirectory = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
}

function size(bytes: number): string {
  const unit = bytes >= 1_000_000 ? 'MB' : 'KB'
  const divisor = unit === 'MB' ? 1_000_000 : 1000
  return `${(bytes / divisor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${unit}`
}

async function listVoices(): Promise<StoredVoice[]> {
  const root = await navigator.storage.getDirectory()
  const directory = await root.getDirectoryHandle('piper', { create: true }) as IterableDirectory
  const voices: StoredVoice[] = []
  for await (const [name, entry] of directory.entries()) {
    if (entry.kind !== 'file' || !name.endsWith('.onnx')) continue
    const id = name.slice(0, -'.onnx'.length)
    const model = await (entry as FileSystemFileHandle).getFile()
    const config = await directory.getFileHandle(`${id}.onnx.json`).then(handle => handle.getFile()).catch(() => null)
    voices.push({ id, bytes: model.size + (config?.size ?? 0) })
  }
  return voices.sort((a, b) => a.id.localeCompare(b.id))
}

async function inspectStorage(): Promise<StorageSummary> {
  const [books, audio, voices] = await Promise.all([
    db.files.toArray().then(files => files.reduce((bytes, file) => bytes + file.blob.size, 0)),
    db.audio.toArray().then(files => files.reduce((bytes, file) => bytes + file.blob.size, 0)),
    listVoices().catch(() => null),
  ])
  return { books, audio, voices }
}

export function LibraryStorage() {
  const [summary, setSummary] = useState<StorageSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    void inspectStorage().then(value => { if (active) setSummary(value) }, () => {
      if (active) { setError(true); setStatus('Não foi possível calcular o espaço usado.') }
    })
    return () => { active = false }
  }, [])

  const change = async (action: () => Promise<void>, success: string) => {
    setBusy(true)
    setError(false)
    setStatus('')
    try {
      await action()
      setSummary(await inspectStorage())
      setStatus(success)
    } catch {
      setError(true)
      setStatus('Não foi possível concluir a operação. Tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  const removeVoice = (id: string) => change(async () => {
    const piper = new PiperVoiceEngine({
      createWorker: () => new Worker(new URL('../piper.worker.ts', import.meta.url), { type: 'module' }),
    })
    try {
      await piper.removeVoice(id)
      if ((await db.settings.get('voice:piper'))?.value === id) await db.settings.delete('voice:piper')
    } finally {
      piper.dispose()
    }
  }, 'Voz removida. Você pode baixá-la novamente quando quiser.')

  return (
    <div className="library-storage">
      {!summary && !status && <p role="status">Calculando espaço…</p>}
      {summary && <>
        <dl className="library-backup-summary">
          <div><dt>Livros originais</dt><dd>{size(summary.books)}</dd></div>
          <div><dt>Áudio em cache</dt><dd>{size(summary.audio)}</dd></div>
          <div><dt>Vozes Piper</dt><dd>{summary.voices ? size(summary.voices.reduce((bytes, voice) => bytes + voice.bytes, 0)) : 'Indisponível'}</dd></div>
          <div><dt>Modelo OCR em português</dt><dd>{size(ocrPackage.downloadBytes)} incluído</dd></div>
        </dl>
        <button className="btn" disabled={busy || !summary.audio} onClick={() => void change(clearAudioCache, 'Cache de áudio limpo.')}>Limpar cache de áudio</button>
        {summary.voices && summary.voices.length > 0 && <ul className="library-imports">
          {summary.voices.map(voice => <li key={voice.id}>
            <span>{voice.id} · {size(voice.bytes)}</span>
            <button className="btn" disabled={busy} onClick={() => void removeVoice(voice.id)} aria-label={`Remover voz ${voice.id}`}>Remover</button>
          </li>)}
        </ul>}
      </>}
      {status && <p className={error ? 'notice notice-error' : 'notice'} role={error ? 'alert' : 'status'}>{status}</p>}
    </div>
  )
}
