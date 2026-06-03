
import { useState, useEffect, useCallback, useRef } from 'react'

export interface TTSOptions {
  enabled: boolean
  autoplay: boolean
  rate: number
  pitch: number
  volume: number
  voice?: SpeechSynthesisVoice
}

export interface UseTTSReturn {
  isSpeaking: boolean
  isPaused: boolean
  supported: boolean
  voices: SpeechSynthesisVoice[]
  speak: (text: string, options?: Partial<TTSOptions>) => void
  stop: () => void
  pause: () => void
  resume: () => void
  settings: TTSOptions
  updateSettings: (settings: Partial<TTSOptions>) => void
}

const DEFAULT_OPTIONS: TTSOptions = {
  enabled: false,
  autoplay: false,
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  voice: undefined,
}

export function useTTS(): UseTTSReturn {
  const [settings, setSettings] = useState<TTSOptions>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('hexstrike-tts-settings')
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          return { ...DEFAULT_OPTIONS, ...parsed }
        } catch {
          return DEFAULT_OPTIONS
        }
      }
    }
    return DEFAULT_OPTIONS
  })

  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [supported, setSupported] = useState(false)
  
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const synthRef = useRef<SpeechSynthesis | null>(null)

  // Check support and initialize
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSupported(false)
      return
    }
    const synth = window.speechSynthesis
    synthRef.current = synth
    setSupported(true)

    // Load voices and restore the persisted voice BY NAME. Reading the saved
    // name from storage (rather than the captured `settings` closure) avoids
    // the stale-closure bug: voices load asynchronously in Chrome, long after
    // this effect's `settings` snapshot was taken.
    const loadVoices = () => {
      const availableVoices = synth.getVoices() || []
      setVoices(availableVoices)

      let savedVoiceName: string | undefined
      try {
        const raw = localStorage.getItem('hexstrike-tts-settings')
        if (raw) savedVoiceName = (JSON.parse(raw) as { voiceName?: string })?.voiceName
      } catch {
        /* ignore malformed storage */
      }
      if (savedVoiceName) {
        const match = availableVoices.find((v) => v.name === savedVoiceName)
        if (match) setSettings((prev) => (prev.voice?.name === match.name ? prev : { ...prev, voice: match }))
      }
    }

    loadVoices()
    // Chrome loads voices asynchronously — guard via the ref, never the global.
    if (synth.onvoiceschanged !== undefined) {
      synth.onvoiceschanged = loadVoices
    }
    return () => {
      if (synth.onvoiceschanged === loadVoices) synth.onvoiceschanged = null
    }
  }, [])

  // Persist settings
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('hexstrike-tts-settings', JSON.stringify({
        enabled: settings.enabled,
        autoplay: settings.autoplay,
        rate: settings.rate,
        pitch: settings.pitch,
        volume: settings.volume,
        voiceName: settings.voice?.name,
      }))
    }
  }, [settings])

  const speak = useCallback((text: string, options?: Partial<TTSOptions>) => {
    if (!synthRef.current || !supported) {
      console.warn('TTS not supported')
      return
    }

    const finalOptions = { ...settings, ...options }
    
    if (!finalOptions.enabled && !options?.enabled) {
      return
    }

    // Cancel any ongoing speech
    synthRef.current.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    
    // Apply settings
    utterance.rate = finalOptions.rate
    utterance.pitch = finalOptions.pitch
    utterance.volume = finalOptions.volume
    if (finalOptions.voice) {
      utterance.voice = finalOptions.voice
    }

    // Event handlers
    utterance.onstart = () => {
      setIsSpeaking(true)
      setIsPaused(false)
    }

    utterance.onend = () => {
      setIsSpeaking(false)
      setIsPaused(false)
    }

    utterance.onerror = (event) => {
      console.error('TTS error:', event)
      setIsSpeaking(false)
      setIsPaused(false)
    }

    utteranceRef.current = utterance
    synthRef.current.speak(utterance)
  }, [settings, supported])

  const stop = useCallback(() => {
    if (synthRef.current) {
      synthRef.current.cancel()
      setIsSpeaking(false)
      setIsPaused(false)
    }
  }, [])

  const pause = useCallback(() => {
    if (synthRef.current && isSpeaking && !isPaused) {
      synthRef.current.pause()
      setIsPaused(true)
    }
  }, [isSpeaking, isPaused])

  const resume = useCallback(() => {
    if (synthRef.current && isSpeaking && isPaused) {
      synthRef.current.resume()
      setIsPaused(false)
    }
  }, [isSpeaking, isPaused])

  const updateSettings = useCallback((newSettings: Partial<TTSOptions>) => {
    setSettings(prev => ({ ...prev, ...newSettings }))
  }, [])

  return {
    isSpeaking,
    isPaused,
    supported,
    voices,
    speak,
    stop,
    pause,
    resume,
    settings,
    updateSettings,
  }
}
