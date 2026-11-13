import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getChapterSentences,
  getBookMeta,
  loadAudioBlob,
  loadChapters,
  loadProgress,
  loadSetting,
  normalizeForSpeech,
  resolveReadingPosition,
  saveAudioBlob,
  saveProgress,
  saveSetting,
} from '@leitor/core'
import type { BookRecord, ChapterRecord } from '@leitor/core'
import { PiperVoiceEngine, SystemVoiceEngine } from '@leitor/voice'
import type { AudioCache, DownloadProgress, PiperVoiceOption, VoiceEngine, VoiceInfo } from '@leitor/voice'
import {
  isAndroidAudio,
  onBackgroundAudioAction,
  onBackgroundAudioFocusLost,
  prepareBackgroundAudioArtwork,
  publishBackgroundAudioState,
  startBackgroundAudio,
  stopBackgroundAudio,
} from '../native/backgroundAudio'
import { useSleepTimer } from './useSleepTimer'

export type EngineId = 'system' | 'piper'

export interface ReaderSource {
  book: BookRecord
  chapters: ChapterRecord[]
}

export type ReaderBook = BookRecord & { chapters: ChapterRecord[] }

export interface Position {
  chapterIndex: number
  sentenceIndex: number
}

const startOfBook: Position = { chapterIndex: 0, sentenceIndex: 0 }
const SAMPLE_TEXT = 'Olá! Esta é uma amostra da voz para você avaliar a pronúncia.'

const audioCache: AudioCache = {
  get: loadAudioBlob,
  put: (key, blob) => saveAudioBlob(key, blob),
}

function voiceScore(voice: VoiceInfo): number {
  const lang = voice.lang.toLowerCase().replace('_', '-')
  if (lang.startsWith('pt-br')) return 2
  if (lang.startsWith('pt')) return 1
  return 0
}

function defaultVoiceId(voices: VoiceInfo[]): string | null {
  return voices.find(v => voiceScore(v) === 2)?.id ?? null
}

function validIndex(index: number, length: number): number {
  return Number.isInteger(index) ? Math.max(0, Math.min(index, length - 1)) : 0
}

/** Orquestra posição, reprodução e progresso. Pausa = stop + retomar a frase atual. */
export function useReader(bookId: string, bookOverride?: ReaderSource) {
  const [book, setBook] = useState<ReaderBook | null>(null)
  const [bookError, setBookError] = useState<string | null>(null)
  const [bookLoadAttempt, setBookLoadAttempt] = useState(0)
  const [position, setPositionState] = useState(startOfBook)
  const { chapterIndex, sentenceIndex } = position
  const [positionNotice, setPositionNotice] = useState<string | null>(null)
  const [progressError, setProgressError] = useState<string | null>(null)
  const lastProgressIntent = useRef<(Position & { updatedAt: number }) | null>(null)
  const progressRequest = useRef(0)
  const [playback, setPlayback] = useState<'idle' | 'preparing' | 'playing' | 'paused' | 'finished'>('idle')
  const playing = playback === 'preparing' || playback === 'playing'
  const [rate, setRateState] = useState(1)
  const [voiceId, setVoiceIdState] = useState<string | null>(null)
  const [systemVoices, setSystemVoices] = useState<VoiceInfo[]>([])
  const [localVoicesOnly, setLocalVoicesOnly] = useState(false)
  const [speechError, setSpeechError] = useState<string | null>(null)

  // Seleção de motor de voz.
  const [engineId, setEngineIdState] = useState<EngineId>('system')
  const [engineLoaded, setEngineLoaded] = useState(false)
  const [voiceLoadAttempt, setVoiceLoadAttempt] = useState(0)
  const [voicesLoading, setVoicesLoading] = useState(true)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [piperCandidates, setPiperCandidates] = useState<PiperVoiceOption[]>([])
  const [downloadedIds, setDownloadedIds] = useState<string[]>([])
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number | null>>({})
  const [downloadErrors, setDownloadErrors] = useState<Record<string, string>>({})
  const [sampleStatus, setSampleStatus] = useState<string | null>(null)
  const downloadingRef = useRef(new Map<string, AbortController>())

  const systemEngine = useMemo(() => new SystemVoiceEngine(), [])
  const piperRef = useRef<PiperVoiceEngine | null>(null)
  const [piperEngine, setPiperEngine] = useState<PiperVoiceEngine | null>(null)

  const engine: VoiceEngine | null = engineId === 'piper' ? piperEngine : systemEngine
  const engineSupported = engine?.isSupported() ?? false
  const voices = useMemo(() => engineId === 'piper'
    ? piperCandidates.filter(voice => downloadedIds.includes(voice.id))
    : localVoicesOnly ? systemVoices.filter(voice => voice.localService === true) : systemVoices,
  [engineId, localVoicesOnly, piperCandidates, downloadedIds, systemVoices])
  const canPlay = engineSupported && engineLoaded && !voicesLoading && (
    engineId === 'piper' ? !!voiceId && downloadedIds.includes(voiceId) : voices.length > 0
  )
  const activeVoice = voices.find(voice => voice.id === voiceId)

  const playingRef = useRef(false)
  const mediaSessionRef = useRef(false)
  const [artworkDataUrl, setArtworkDataUrl] = useState<string>()
  const playbackPhaseRef = useRef<'idle' | 'starting' | 'active'>('idle')
  const resumeAfterChapterRef = useRef(false)
  const playbackRequestRef = useRef(0)
  const sentenceRequestRef = useRef(0)
  const rateRef = useRef(1)
  const voiceRef = useRef<string | null>(null)
  const bookRef = useRef<ReaderBook | null>(null)
  const positionRef = useRef(startOfBook)
  const speakAtRef = useRef<(chapter: number, sentence: number) => void>(() => {})

  bookRef.current = book
  const sentences = getChapterSentences(book?.chapters[chapterIndex])
  const hasReadableText = useMemo(
    () => book?.chapters.some(chapter => chapter.paragraphs.some(paragraph => paragraph.trim().length > 0)) ?? false,
    [book],
  )
  const [canGoPrevious, canGoNext] = useMemo(() => [
    sentenceIndex > 0 || !!book?.chapters.slice(0, chapterIndex).some(chapter => chapter.paragraphs.length > 0),
    sentenceIndex + 1 < sentences.length || !!book?.chapters.slice(chapterIndex + 1).some(chapter => chapter.paragraphs.length > 0),
  ], [book, chapterIndex, sentenceIndex, sentences.length])

  const publishMedia = useCallback((status: 'playing' | 'paused' | 'buffering') => {
    const current = bookRef.current
    if (!mediaSessionRef.current || !current || !isAndroidAudio()) return
    const { chapterIndex: ci, sentenceIndex: si } = positionRef.current
    const chapter = current.chapters[ci]
    const total = getChapterSentences(chapter).length
    void publishBackgroundAudioState({
      title: current.title,
      subtitle: chapter?.title,
      position: si,
      total,
      status,
      canGoPrevious: si > 0 || current.chapters.slice(0, ci).some(item => item.paragraphs.length > 0),
      canGoNext: si + 1 < total || current.chapters.slice(ci + 1).some(item => item.paragraphs.length > 0),
      artworkDataUrl,
    })
  }, [artworkDataUrl])

  const persistProgress = useCallback((next: Position & { updatedAt: number }) => {
    lastProgressIntent.current = next
    const request = ++progressRequest.current
    void saveProgress(bookId, next.chapterIndex, next.sentenceIndex, next.updatedAt).then(
      () => { if (request === progressRequest.current) setProgressError(null) },
      () => { if (request === progressRequest.current) setProgressError('Não foi possível salvar a posição.') },
    )
  }, [bookId])

  const setPosition = useCallback((ci: number, si: number, persist = true) => {
    const next = { chapterIndex: ci, sentenceIndex: si }
    positionRef.current = next
    setPositionState(next)
    if (persist) persistProgress({ ...next, updatedAt: Date.now() })
  }, [persistProgress])

  const retryProgress = useCallback(() => {
    if (lastProgressIntent.current) persistProgress(lastProgressIntent.current)
  }, [persistProgress])

  const retryBook = useCallback(() => {
    setBookError(null)
    setBookLoadAttempt(attempt => attempt + 1)
  }, [])

  const updateVoice = useCallback((id: string | null) => {
    voiceRef.current = id
    setVoiceIdState(id)
  }, [])

  const ensurePiper = useCallback(() => {
    if (typeof Worker === 'undefined' || typeof Audio === 'undefined') return null
    if (!piperRef.current) {
      piperRef.current = new PiperVoiceEngine({
        createWorker: () =>
          new Worker(new URL('../piper.worker.ts', import.meta.url), { type: 'module' }),
        cache: bookOverride ? undefined : audioCache,
      })
      setPiperEngine(piperRef.current)
    }
    return piperRef.current
  }, [bookOverride])

  const stopPlayback = useCallback((next: 'idle' | 'paused' | 'finished' = 'paused', keepSession = false) => {
    const wasPlaying = playingRef.current
    playbackRequestRef.current++
    playbackPhaseRef.current = 'idle'
    playingRef.current = false
    engine?.stop()
    if (wasPlaying || next !== 'paused') setPlayback(next)
    else setPlayback(previous => previous === 'idle' ? previous : next)
    setSampleStatus(null)
    const keepMedia = keepSession && mediaSessionRef.current
    if (!keepMedia) mediaSessionRef.current = false
    void stopBackgroundAudio({ keepSession: keepMedia })
  }, [engine])

  const pause = useCallback(() => stopPlayback('paused', true), [stopPlayback])
  const stopReading = useCallback(() => stopPlayback(), [stopPlayback])
  const onTimerEnd = useCallback((afterChapter: boolean) => {
    resumeAfterChapterRef.current = afterChapter
    stopPlayback('paused')
  }, [stopPlayback])
  const sleep = useSleepTimer(onTimerEnd)

  const beginPlayback = useCallback((reading: boolean, speak: () => void) => {
    const resume = reading && mediaSessionRef.current
    if (!resume) stopPlayback('idle')
    const request = playbackRequestRef.current
    playbackPhaseRef.current = 'starting'
    playingRef.current = reading
    if (reading) setPlayback('preparing')
    setSpeechError(null)

    const start = () => {
      playbackPhaseRef.current = 'active'
      speak()
    }
    if (!isAndroidAudio()) {
      start()
      return
    }

    if (reading) {
      mediaSessionRef.current = true
      publishMedia('buffering')
    }
    void startBackgroundAudio().then(granted => {
      if (request !== playbackRequestRef.current) return
      if (granted) {
        if (reading) sleep.syncNative()
        start()
      }
      else {
        stopPlayback('paused')
        setSpeechError('O áudio está indisponível. Tente novamente.')
      }
    })
  }, [publishMedia, sleep.syncNative, stopPlayback])

  // Loop de reprodução: fala a frase e encadeia a próxima (atravessa capítulos).
  useEffect(() => {
    speakAtRef.current = (ci, si) => {
      const current = bookRef.current
      if (!current || !engine || !playingRef.current) return

      let list = getChapterSentences(current.chapters[ci])
      while (!list[si] && ci + 1 < current.chapters.length) {
        ci++
        si = 0
        list = getChapterSentences(current.chapters[ci])
      }
      const sentence = list[si]
      if (!sentence) {
        sleep.clear()
        stopPlayback('finished')
        return
      }
      setPosition(ci, si)
      const voice = voices.find(option => option.id === voiceRef.current)
      const spokenText = voice && voiceScore(voice) === 0
        ? (text: string) => text
        : normalizeForSpeech
      const next = list[si + 1]
      const request = playbackRequestRef.current
      const sentenceRequest = ++sentenceRequestRef.current
      const isCurrent = () => request === playbackRequestRef.current && sentenceRequest === sentenceRequestRef.current
      const onAbort = (reason: string) => {
        if (!isCurrent()) return
        stopPlayback()
        setSpeechError(reason)
      }
      void engine.speak(spokenText(sentence.text) || sentence.text, {
        rate: rateRef.current,
        voiceId: voiceRef.current,
        prefetch: next ? spokenText(next.text) || next.text : null,
        onStart: () => { if (isCurrent()) setPlayback('playing') },
        onEnd: () => {
          if (!isCurrent()) return
          if (si + 1 === list.length && sleep.checkChapterEnd(ci)) return
          speakAtRef.current(ci, si + 1)
        },
        onAbort,
      }).catch(error => onAbort(error instanceof Error ? error.message : 'Falha na reprodução.'))
    }
  }, [engine, setPosition, sleep.checkChapterEnd, sleep.clear, stopPlayback, voices])

  // Carrega o livro, capítulos e a última posição (só depende do livro).
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [meta, chapters, progress] = bookOverride
          ? [bookOverride.book, bookOverride.chapters, await loadProgress(bookId)] as const
          : await Promise.all([getBookMeta(bookId), loadChapters(bookId), loadProgress(bookId)])
        if (!alive) return
        if (!meta) {
          setBookError('Livro não encontrado na biblioteca.')
          return
        }
        const resolved = resolveReadingPosition(chapters, progress ?? startOfBook)
        setPosition(resolved.chapterIndex, resolved.sentenceIndex, false)
        setPositionNotice(resolved.approximate ? 'A posição salva foi aproximada.' : null)
        setBook({ ...meta, chapters })
      } catch (error) {
        if (alive) setBookError(error instanceof Error ? error.message : 'Falha ao abrir o livro.')
      }
    })()
    return () => {
      alive = false
    }
  }, [bookId, bookLoadAttempt, bookOverride, setPosition])

  useEffect(() => () => {
    playbackRequestRef.current++
    playbackPhaseRef.current = 'idle'
    playingRef.current = false
    systemEngine.stop()
    for (const request of downloadingRef.current.values()) request.abort()
    downloadingRef.current.clear()
    piperRef.current?.dispose()
    piperRef.current = null
    void stopBackgroundAudio()
  }, [systemEngine])

  useEffect(() => onBackgroundAudioFocusLost((reason, deadline?: number) => {
    if (reason === 'timer') {
      sleep.expireIfDue(deadline)
      return
    }
    if (playbackPhaseRef.current === 'idle') return
    stopPlayback()
    setSpeechError(reason === 'route' ? 'A saída de áudio foi desconectada.' : 'A reprodução foi interrompida por outro áudio.')
  }), [sleep.expireIfDue, stopPlayback])

  useEffect(() => {
    if (!isAndroidAudio() || !book?.cover) return
    let active = true
    void prepareBackgroundAudioArtwork(book.cover).then(data => {
      if (active) setArtworkDataUrl(data)
    })
    return () => { active = false }
  }, [book?.cover])

  useEffect(() => {
    publishMedia(playback === 'playing' ? 'playing' : playback === 'preparing' ? 'buffering' : 'paused')
  }, [book, chapterIndex, playback, publishMedia, sentenceIndex])

  // Restaura o motor e a velocidade escolhidos na sessão anterior.
  useEffect(() => {
    let alive = true
    void (async () => {
      const [savedEngine, savedRate, savedLocalOnly] = await Promise.all([
        loadSetting('engine').catch(() => undefined),
        loadSetting('rate').catch(() => undefined),
        loadSetting('systemVoicesLocalOnly').catch(() => undefined),
      ])
      if (!alive) return
      if (savedEngine === 'piper') {
        ensurePiper()
        setEngineIdState('piper')
      }
      setLocalVoicesOnly(savedLocalOnly === 'true')
      const value = Number(savedRate)
      if (Number.isFinite(value) && value >= 0.5 && value <= 3) {
        setRateState(value)
        rateRef.current = value
      }
      setEngineLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [ensurePiper])

  const retryVoices = useCallback(() => {
    setVoiceError(null)
    setVoicesLoading(true)
    setVoiceLoadAttempt(attempt => attempt + 1)
  }, [])

  // Vozes do motor ativo + voz salva para esse motor.
  useEffect(() => {
    if (!engineLoaded) return
    if (!engine) {
      setVoicesLoading(false)
      return
    }
    let alive = true
    void (async () => {
      try {
        const saved = await loadSetting(`voice:${engineId}`).catch(() => undefined)
        if (engine instanceof PiperVoiceEngine) {
          const [candidates, downloaded] = await Promise.all([
            engine.listVoiceOptions(),
            engine.downloadedVoices(),
          ])
          if (!alive) return
          setPiperCandidates(candidates)
          setDownloadedIds(downloaded)
          const available = candidates.filter(voice => downloaded.includes(voice.id))
          updateVoice(saved && available.some(voice => voice.id === saved) ? saved : null)
        } else {
          const list = await engine.listVoices()
          if (!alive) return
          setSystemVoices(list)
          const eligible = localVoicesOnly ? list.filter(voice => voice.localService === true) : list
          const id = localVoicesOnly ? defaultVoiceId(eligible) ?? eligible[0]?.id ?? null
            : saved === '' ? null : defaultVoiceId(eligible)
          updateVoice(saved && eligible.some(voice => voice.id === saved) ? saved : id)
        }
      } catch (error) {
        if (!alive) return
        const message = error instanceof Error ? error.message : 'Erro desconhecido.'
        setVoiceError(`Falha ao carregar vozes: ${message}`)
      } finally {
        if (alive) setVoicesLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [engine, engineId, engineLoaded, localVoicesOnly, updateVoice, voiceLoadAttempt])

  const play = useCallback(() => {
    if (!canPlay || !hasReadableText || !bookRef.current || playingRef.current) return
    beginPlayback(true, () => {
      const { chapterIndex: ci, sentenceIndex: si } = positionRef.current
      const nextSentence = resumeAfterChapterRef.current ? si + 1 : si
      resumeAfterChapterRef.current = false
      speakAtRef.current(ci, nextSentence)
    })
  }, [beginPlayback, canPlay, hasReadableText])

  const togglePlay = useCallback(() => {
    if (playingRef.current) pause()
    else play()
  }, [pause, play])

  const seek = useCallback(
    (ci: number, si: number, persist = true) => {
      const chapters = bookRef.current?.chapters
      if (!chapters?.[ci]) return
      resumeAfterChapterRef.current = false
      sleep.onChapterJump(ci)
      const index = validIndex(si, getChapterSentences(chapters[ci]).length)
      setPositionNotice(null)
      const continueReading = playingRef.current && playbackPhaseRef.current === 'active'
      setPosition(ci, index, persist && !continueReading)
      setPlayback(previous => previous === 'finished' ? 'paused' : previous)
      if (!playingRef.current || playbackPhaseRef.current === 'starting') return
      playbackRequestRef.current++
      setPlayback('preparing')
      engine?.stop()
      speakAtRef.current(ci, index)
    },
    [engine, setPosition, sleep.onChapterJump],
  )

  const moveSentence = useCallback((direction: -1 | 1) => {
    const chapters = bookRef.current?.chapters
    if (!chapters) return
    const { chapterIndex: ci, sentenceIndex: si } = positionRef.current
    const target = si + direction
    if (getChapterSentences(chapters[ci])[target]) {
      seek(ci, target)
      return
    }
    for (let index = ci + direction; index >= 0 && index < chapters.length; index += direction) {
      const count = getChapterSentences(chapters[index]).length
      if (count > 0) {
        seek(index, direction === 1 ? 0 : count - 1)
        return
      }
    }
  }, [seek])

  const nextSentence = useCallback(() => moveSentence(1), [moveSentence])
  const prevSentence = useCallback(() => moveSentence(-1), [moveSentence])

  const mediaActions = useRef({ play, pause, nextSentence, prevSentence })
  mediaActions.current = { play, pause, nextSentence, prevSentence }
  useEffect(() => onBackgroundAudioAction(action => {
    if (!mediaSessionRef.current) return
    const controls = mediaActions.current
    if (action === 'play' && !playingRef.current) controls.play()
    else if (action === 'pause' && playingRef.current) controls.pause()
    else if (action === 'next') controls.nextSentence()
    else if (action === 'previous') controls.prevSentence()
  }), [])

  const gotoChapter = useCallback((ci: number) => seek(ci, 0), [seek])

  const gotoParagraph = useCallback((ci: number, paragraph: number) => {
    const index = getChapterSentences(bookRef.current?.chapters[ci])
      .findIndex(sentence => sentence.paragraphIndex >= paragraph)
    seek(ci, Math.max(0, index))
  }, [seek])

  const setRate = useCallback((value: number) => {
    setRateState(value)
    rateRef.current = value
    void saveSetting('rate', String(value))
  }, [])

  const setVoice = useCallback(
    (id: string | null) => {
      if (engineId === 'piper' && id && !downloadedIds.includes(id)) return
      if (engineId === 'system' && localVoicesOnly && !voices.some(voice => voice.id === id)) return
      updateVoice(id)
      void saveSetting(`voice:${engineId}`, id ?? '')
      if (playingRef.current) {
        if (engineId === 'piper' && !id) stopPlayback()
        else {
          const { chapterIndex: ci, sentenceIndex: si } = positionRef.current
          seek(ci, si)
        }
      }
    },
    [downloadedIds, engineId, localVoicesOnly, seek, stopPlayback, updateVoice, voices],
  )

  const setOnlyLocalVoices = useCallback((onlyLocal: boolean) => {
    if (onlyLocal === localVoicesOnly) return
    stopPlayback()
    setVoicesLoading(true)
    setVoiceError(null)
    setLocalVoicesOnly(onlyLocal)
    void saveSetting('systemVoicesLocalOnly', String(onlyLocal)).catch(() => {
      setVoiceError('Não foi possível salvar o filtro de vozes do aparelho.')
    })
  }, [localVoicesOnly, stopPlayback])

  const applyOcrPage = useCallback((chapter: ChapterRecord) => {
    const current = bookRef.current
    if (!current || current.id !== chapter.bookId) return
    const next = { ...current, chapters: current.chapters.map(item =>
      item.chapterIndex === chapter.chapterIndex ? chapter : item) }
    bookRef.current = next
    setBook(next)
    if (positionRef.current.chapterIndex !== chapter.chapterIndex) return
    if (current.chapters[chapter.chapterIndex]?.paragraphs !== chapter.paragraphs) resumeAfterChapterRef.current = false
    const index = validIndex(positionRef.current.sentenceIndex, getChapterSentences(chapter).length)
    setPosition(chapter.chapterIndex, index, false)
    const expectedBook = next.id
    const expected = positionRef.current
    void loadProgress(expectedBook).then(progress => {
      if (!progress || progress.chapterIndex !== chapter.chapterIndex || positionRef.current !== expected ||
        bookRef.current?.chapters[chapter.chapterIndex] !== chapter) return
      const resolved = resolveReadingPosition(bookRef.current.chapters, progress)
      setPosition(resolved.chapterIndex, resolved.sentenceIndex, false)
      setPositionNotice(resolved.approximate ? 'A posição salva foi aproximada.' : null)
    }).catch(() => undefined)
  }, [setPosition])

  const setEngine = useCallback(
    (id: EngineId) => {
      if (!engineLoaded || id === engineId) return
      stopPlayback()
      setSpeechError(null)
      setVoiceError(null)
      setVoicesLoading(true)
      updateVoice(null)
      setEngineIdState(id)
      void saveSetting('engine', id)
      if (id === 'piper') ensurePiper()
    },
    [engineId, engineLoaded, ensurePiper, stopPlayback, updateVoice],
  )

  const downloadVoice = useCallback(
    async (id: string) => {
      const piper = ensurePiper()
      if (!piper || downloadingRef.current.has(id)) return
      const request = new AbortController()
      downloadingRef.current.set(id, request)
      setDownloadProgress(previous => ({ ...previous, [id]: null }))
      setDownloadErrors(previous => {
        const next = { ...previous }
        delete next[id]
        return next
      })
      try {
        await piper.download(id, (progress: DownloadProgress) => {
          setDownloadProgress(prev => ({
            ...prev,
            [id]: progress.total > 0 ? Math.min(progress.loaded / progress.total, 1) : null,
          }))
        }, request.signal)
        const downloaded = await piper.downloadedVoices()
        if (!downloaded.includes(id)) throw new Error('O modelo não foi salvo neste aparelho.')
        setDownloadedIds(previous => [...new Set([...previous, ...downloaded])])
      } catch (error) {
        if (request.signal.aborted) return
        const message = error instanceof Error ? error.message : 'Erro desconhecido.'
        setDownloadErrors(previous => ({ ...previous, [id]: message }))
      } finally {
        if (downloadingRef.current.get(id) === request) {
          downloadingRef.current.delete(id)
          setDownloadProgress(previous => {
            const next = { ...previous }
            delete next[id]
            return next
          })
        }
      }
    },
    [ensurePiper],
  )

  const cancelVoiceDownload = useCallback((id: string) => {
    downloadingRef.current.get(id)?.abort()
  }, [])

  const playSample = useCallback(
    (id: string) => {
      if (!engine || engineId !== 'piper' || !downloadedIds.includes(id)) return
      beginPlayback(false, () => {
        const request = playbackRequestRef.current
        const onAbort = (reason: string) => {
          if (request !== playbackRequestRef.current) return
          stopPlayback()
          setSpeechError(reason)
        }
        setSampleStatus('Preparando amostra…')
        void engine.speak(SAMPLE_TEXT, {
          rate: rateRef.current,
          voiceId: id,
          onStart: () => {
            if (request === playbackRequestRef.current) setSampleStatus('Tocando amostra…')
          },
          onEnd: () => {
            if (request === playbackRequestRef.current) stopPlayback()
          },
          onAbort,
        }).catch(error => onAbort(error instanceof Error ? error.message : 'Falha na amostra.'))
      })
      if (playbackPhaseRef.current !== 'idle') setSampleStatus('Preparando amostra…')
    },
    [beginPlayback, downloadedIds, engine, engineId, stopPlayback],
  )

  return {
    book,
    bookError,
    retryBook,
    chapterIndex,
    sentenceIndex,
    sentences,
    playing,
    playback,
    rate,
    voiceId,
    voices,
    hasVoices: voices.length > 0,
    hasReadableText,
    activeVoice,
    localVoicesOnly,
    setOnlyLocalVoices,
    sleep,
    canGoPrevious,
    canGoNext,
    voicesLoading,
    voiceError,
    retryVoices,
    speechError,
    positionNotice,
    progressError,
    retryProgress,
    canPlay,
    engineId,
    engineLoaded,
    piperCandidates,
    downloadedIds,
    downloadProgress,
    downloadErrors,
    sampleStatus,
    togglePlay,
    play,
    pause,
    stopReading,
    nextSentence,
    prevSentence,
    gotoChapter,
    gotoParagraph,
    seek,
    setRate,
    setVoice,
    setEngine,
    downloadVoice,
    cancelVoiceDownload,
    playSample,
    stopSample: stopPlayback,
    applyOcrPage,
    engineSupported,
  }
}
