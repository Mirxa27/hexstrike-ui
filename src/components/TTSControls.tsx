
import { useState } from 'react'
import { Volume2, VolumeX, Settings, X, Play, Pause, StopCircle } from 'lucide-react'
import { useTTS } from '../hooks/useTTS'

export function TTSControls() {
  const [showSettings, setShowSettings] = useState(false)
  const {
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
  } = useTTS()

  if (!supported) {
    return null
  }

  const demoText = "HexStrike AI - Your security copilot. Text-to-speech is now enabled."

  return (
    <>
      {/* Main TTS Toggle Button */}
      <div className="relative">
        <button
          type="button"
          onClick={() => updateSettings({ enabled: !settings.enabled })}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-colors text-xs font-medium ${
            settings.enabled
              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
              : 'text-[#64748b] hover:text-[#cbd5e1] border border-transparent hover:bg-white/[0.04]'
          }`}
          title={settings.enabled ? 'TTS enabled' : 'Enable TTS'}
        >
          {settings.enabled ? (
            <Volume2 size={14} />
          ) : (
            <VolumeX size={14} />
          )}
          <span className="hidden sm:inline">{settings.enabled ? 'TTS On' : 'TTS Off'}</span>
        </button>

        {/* Quick controls popup */}
        {settings.enabled && (
          <div className="absolute right-0 top-full mt-2 w-72 bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl shadow-2xl z-50 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a2e]">
              <div className="flex items-center gap-2">
                <Volume2 size={14} className="text-emerald-400" />
                <span className="text-xs font-semibold text-[#e2e8f0]">Text-to-Speech</span>
              </div>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-1 hover:bg-[#1a1a2e] rounded text-[#6b7280] hover:text-[#e2e8f0]"
              >
                {showSettings ? <X size={14} /> : <Settings size={14} />}
              </button>
            </div>

            {!showSettings ? (
              /* Quick Controls */
              <div className="p-4 space-y-3">
                {/* Autoplay Toggle */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#94a3b8]">Autoplay</span>
                  <button
                    onClick={() => updateSettings({ autoplay: !settings.autoplay })}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      settings.autoplay ? 'bg-emerald-500' : 'bg-[#1a1a2e]'
                    }`}
                  >
                    <div
                      className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-transform ${
                        settings.autoplay ? 'left-6' : 'left-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Playback Controls */}
                <div className="flex items-center justify-center gap-2 pt-2 border-t border-[#1a1a2e]">
                  {isSpeaking ? (
                    <>
                      <button
                        onClick={isPaused ? resume : pause}
                        className="p-2 hover:bg-[#1a1a2e] rounded-lg text-[#94a3b8] hover:text-[#e2e8f0]"
                        title={isPaused ? 'Resume' : 'Pause'}
                      >
                        {isPaused ? <Play size={14} /> : <Pause size={14} />}
                      </button>
                      <button
                        onClick={stop}
                        className="p-2 hover:bg-[#1a1a2e] rounded-lg text-[#94a3b8] hover:text-[#e2e8f0]"
                        title="Stop"
                      >
                        <StopCircle size={14} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => speak(demoText)}
                      className="flex items-center gap-2 px-3 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 rounded-lg text-xs text-emerald-300 transition-colors"
                    >
                      <Play size={12} />
                      Test Speech
                    </button>
                  )}
                </div>

                {/* Status indicator */}
                {isSpeaking && (
                  <div className="flex items-center justify-center gap-2 text-[10px] text-emerald-400">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>{isPaused ? 'Paused' : 'Speaking...'}</span>
                  </div>
                )}
              </div>
            ) : (
              /* Settings Panel */
              <div className="p-4 space-y-4 max-h-80 overflow-y-auto">
                {/* Voice Selection */}
                <div>
                  <label className="block text-[10px] text-[#6b7280] mb-1.5">Voice</label>
                  <select
                    value={settings.voice?.name || ''}
                    onChange={(e) => {
                      const voice = voices.find(v => v.name === e.target.value)
                      updateSettings({ voice })
                    }}
                    className="w-full bg-[#0a0a0f] border border-[#1a1a2e] rounded-lg px-2 py-1.5 text-xs text-[#e2e8f0] focus:border-emerald-500/50 focus:outline-none"
                  >
                    {voices.map((voice) => (
                      <option key={voice.name} value={voice.name}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Rate */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] text-[#6b7280]">Speed</label>
                    <span className="text-[10px] text-[#94a3b8]">{settings.rate.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={settings.rate}
                    onChange={(e) => updateSettings({ rate: parseFloat(e.target.value) })}
                    className="w-full h-1.5 bg-[#1a1a2e] rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, #10b981 0%, #10b981 ${((settings.rate - 0.5) / 1.5) * 100}%, #1a1a2e ${((settings.rate - 0.5) / 1.5) * 100}%, #1a1a2e 100%)`
                    }}
                  />
                </div>

                {/* Pitch */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] text-[#6b7280]">Pitch</label>
                    <span className="text-[10px] text-[#94a3b8]">{settings.pitch.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={settings.pitch}
                    onChange={(e) => updateSettings({ pitch: parseFloat(e.target.value) })}
                    className="w-full h-1.5 bg-[#1a1a2e] rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, #10b981 0%, #10b981 ${((settings.pitch - 0.5) / 1.5) * 100}%, #1a1a2e ${((settings.pitch - 0.5) / 1.5) * 100}%, #1a1a2e 100%)`
                    }}
                  />
                </div>

                {/* Volume */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] text-[#6b7280]">Volume</label>
                    <span className="text-[10px] text-[#94a3b8]">{Math.round(settings.volume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={settings.volume}
                    onChange={(e) => updateSettings({ volume: parseFloat(e.target.value) })}
                    className="w-full h-1.5 bg-[#1a1a2e] rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, #10b981 0%, #10b981 ${settings.volume * 100}%, #1a1a2e ${settings.volume * 100}%, #1a1a2e 100%)`
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
