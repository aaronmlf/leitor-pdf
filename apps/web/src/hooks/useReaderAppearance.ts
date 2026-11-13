import { useEffect, useRef, useState } from 'react'
import { loadSetting, saveSetting } from '@leitor/core'

interface Appearance {
  theme: 'system' | 'light' | 'dark' | 'sepia'
  textSize: 'small' | 'normal' | 'large' | 'extra-large'
  spacing: 'compact' | 'normal' | 'relaxed'
  follow: boolean
}

const appearanceKey = 'readerAppearance'
const defaults: Appearance = { theme: 'system', textSize: 'normal', spacing: 'normal', follow: true }

function readAppearance(raw: string | undefined): Appearance {
  if (!raw) return defaults
  const saved: Partial<Appearance> | null = JSON.parse(raw)
  return {
    theme: saved?.theme === 'light' || saved?.theme === 'dark' || saved?.theme === 'sepia' ? saved.theme : 'system',
    textSize: saved?.textSize === 'small' || saved?.textSize === 'large' || saved?.textSize === 'extra-large'
      ? saved.textSize : 'normal',
    spacing: saved?.spacing === 'compact' || saved?.spacing === 'relaxed' ? saved.spacing : 'normal',
    follow: typeof saved?.follow === 'boolean' ? saved.follow : true,
  }
}

export function useReaderAppearance() {
  const [appearance, setAppearance] = useState(defaults)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const revision = useRef(0)
  const current = useRef(defaults)

  useEffect(() => {
    let active = true
    void loadSetting(appearanceKey).then(raw => {
      if (!active) return
      current.current = readAppearance(raw)
      setAppearance(current.current)
    }).catch(() => {
      if (active) setError('Não foi possível carregar a aparência salva.')
    }).finally(() => {
      if (active) setLoaded(true)
    })
    return () => { active = false }
  }, [])

  function update(values: Partial<Appearance>) {
    const next = { ...current.current, ...values }
    current.current = next
    setAppearance(next)
    const attempt = ++revision.current
    void saveSetting(appearanceKey, JSON.stringify(next)).then(
      () => { if (attempt === revision.current) setError(null) },
      () => { if (attempt === revision.current) setError('Não foi possível salvar a aparência.') },
    )
  }

  return { appearance, loaded, error, update }
}
