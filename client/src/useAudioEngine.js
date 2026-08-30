import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { resolveEightSpineTrack } from './eightSpineModules'

const EQ_FREQUENCIES = [62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
const FLAT_EQ = EQ_FREQUENCIES.map(() => 0)

function smoothAudioParam(context, param, value, timeConstant = 0.025) {
  if (!context || !param) return
  const now = context.currentTime
  try {
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now)
    else {
      const currentValue = param.value
      param.cancelScheduledValues(now)
      param.setValueAtTime(currentValue, now)
    }
    param.setTargetAtTime(value, now, timeConstant)
  } catch {
    param.value = value
  }
}

function readEqualizerSettings() {
  try {
    const stored = JSON.parse(window.localStorage.getItem('sonora-equalizer') || '{}')
    const curve = Array.isArray(stored.curve) && stored.curve.length === EQ_FREQUENCIES.length
      ? stored.curve.map((value) => Math.max(-12, Math.min(12, Number(value) || 0)))
      : FLAT_EQ
    return { curve, enabled: stored.enabled !== false }
  } catch {
    return { curve: FLAT_EQ, enabled: true }
  }
}

export function useAudioEngine() {
  const graphRef = useRef(null)
  const queueRef = useRef([])
  const indexRef = useRef(-1)
  const currentRef = useRef(null)
  const playbackIdRef = useRef(null)
  const recordedPlaybackIdsRef = useRef(new Set())
  const repeatRef = useRef('off')
  const shuffleRef = useRef(false)
  const sessionContextRef = useRef({})
  const nextRef = useRef(null)
  const startedAtRef = useRef(0)
  const crossfadeRef = useRef(4)
  const transitionRef = useRef(false)
  const consecutiveSkipsRef = useRef(0)
  const bassBoostRef = useRef(0)
  const compressionRef = useRef(false)
  const ambienceRef = useRef(0)
  const volumeRef = useRef(0.78)
  const mutedRef = useRef(false)
  const [initialEqualizer] = useState(readEqualizerSettings)
  const eqRef = useRef(initialEqualizer.curve)
  const eqEnabledRef = useRef(initialEqualizer.enabled)

  const [currentTrack, setCurrentTrack] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(0.78)
  const [muted, setMuted] = useState(false)
  const [queue, setQueue] = useState([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [shuffle, setShuffleState] = useState(false)
  const [repeat, setRepeatState] = useState('off')
  const [crossfade, setCrossfadeState] = useState(4)
  const [spatial, setSpatialState] = useState(false)
  const [eq, setEqState] = useState(initialEqualizer.curve)
  const [eqEnabled, setEqEnabledState] = useState(initialEqualizer.enabled)
  const [bassBoost, setBassBoostState] = useState(0)
  const [compression, setCompressionState] = useState(false)
  const [ambience, setAmbienceState] = useState(0)
  const [analyser, setAnalyser] = useState(null)

  const ensureGraph = useCallback(() => {
    if (graphRef.current) return graphRef.current
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    const context = new AudioContextClass()
    const decks = [new Audio(), new Audio()]
    const deckGains = decks.map(() => context.createGain())
    const sources = decks.map((deck, index) => {
      deck.preload = 'auto'
      deck.crossOrigin = 'anonymous'
      const source = context.createMediaElementSource(deck)
      source.connect(deckGains[index])
      return source
    })
    const eqNodes = EQ_FREQUENCIES.map((frequency) => {
      const filter = context.createBiquadFilter()
      filter.type = frequency === EQ_FREQUENCIES[0] ? 'lowshelf' : frequency === EQ_FREQUENCIES.at(-1) ? 'highshelf' : 'peaking'
      filter.frequency.value = frequency
      filter.Q.value = 1
      filter.gain.value = eqEnabledRef.current ? eqRef.current[EQ_FREQUENCIES.indexOf(frequency)] : 0
      return filter
    })
    deckGains.forEach((gain) => gain.connect(eqNodes[0]))
    eqNodes.forEach((node, index) => {
      if (eqNodes[index + 1]) node.connect(eqNodes[index + 1])
    })

    const bassEnhancer = context.createBiquadFilter()
    bassEnhancer.type = 'lowshelf'
    bassEnhancer.frequency.value = 95
    bassEnhancer.gain.value = bassBoostRef.current * 9
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = compressionRef.current ? -24 : 0
    compressor.knee.value = compressionRef.current ? 12 : 0
    compressor.ratio.value = compressionRef.current ? 4 : 1
    compressor.attack.value = 0.008
    compressor.release.value = 0.24
    const splitter = context.createChannelSplitter(2)
    const delayLeft = context.createDelay(0.05)
    const delayRight = context.createDelay(0.05)
    const merger = context.createChannelMerger(2)
    const panner = context.createStereoPanner()
    const dryGain = context.createGain()
    const convolver = context.createConvolver()
    const wetGain = context.createGain()
    const analyserNode = context.createAnalyser()
    const master = context.createGain()
    const impulseLength = Math.floor(context.sampleRate * 1.8)
    const impulse = context.createBuffer(2, impulseLength, context.sampleRate)
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const samples = impulse.getChannelData(channel)
      for (let index = 0; index < impulseLength; index += 1) {
        const decay = Math.pow(1 - index / impulseLength, 3.2)
        samples[index] = (Math.random() * 2 - 1) * decay
      }
    }
    convolver.buffer = impulse
    dryGain.gain.value = 1 - ambienceRef.current * 0.12
    wetGain.gain.value = ambienceRef.current * 0.3
    analyserNode.fftSize = 256
    analyserNode.smoothingTimeConstant = 0.82
    eqNodes.at(-1).connect(bassEnhancer)
    bassEnhancer.connect(compressor)
    compressor.connect(splitter)
    splitter.connect(delayLeft, 0)
    splitter.connect(delayRight, 1)
    delayLeft.connect(merger, 0, 0)
    delayRight.connect(merger, 0, 1)
    merger.connect(panner)
    panner.connect(dryGain)
    panner.connect(convolver)
    dryGain.connect(analyserNode)
    convolver.connect(wetGain)
    wetGain.connect(analyserNode)
    analyserNode.connect(master)
    master.connect(context.destination)
    master.gain.value = mutedRef.current ? 0 : volumeRef.current
    deckGains[0].gain.value = 1
    deckGains[1].gain.value = 0

    const graph = {
      context,
      decks,
      deckGains,
      sources,
      eqNodes,
      bassEnhancer,
      compressor,
      splitter,
      delayLeft,
      delayRight,
      merger,
      panner,
      dryGain,
      convolver,
      wetGain,
      analyser: analyserNode,
      master,
      activeDeck: 0,
    }
    decks.forEach((deck, index) => {
      deck.addEventListener('ended', () => {
        if (index === graph.activeDeck && !transitionRef.current) nextRef.current?.(false, true)
      })
    })
    graphRef.current = graph
    setAnalyser(analyserNode)
    return graph
  }, [])

  const recordListen = useCallback((completed, skipped, beacon = false) => {
    const track = currentRef.current
    const graph = graphRef.current
    if (!track || !graph) return Promise.resolve(null)
    if (track.sourceKind === '8spine') return Promise.resolve(null)
    const deck = graph.decks[graph.activeDeck]
    const seconds = Math.max(0, deck.currentTime || (Date.now() - startedAtRef.current) / 1000)
    if (seconds < 2) return Promise.resolve(null)
    const sessionContext = sessionContextRef.current || {}
    const playbackEventId = playbackIdRef.current
    if (!playbackEventId || recordedPlaybackIdsRef.current.has(playbackEventId)) return Promise.resolve(null)
    recordedPlaybackIdsRef.current.add(playbackEventId)
    const payload = {
      trackId: track.id,
      seconds,
      completed,
      skipped,
      moodContext: sessionContext.intent || null,
      sessionId: track.recommendation?.sessionId || sessionContext.sessionId || null,
      recommendationRunId: track.recommendation?.runId || sessionContext.runId || null,
      playbackEventId,
    }
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/history', new Blob([JSON.stringify(payload)], { type: 'application/json' }))
      return Promise.resolve(null)
    }
    return api('/history', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then((result) => {
      if (result?.tokenAccount && result.tokenCharge) {
        window.dispatchEvent(new CustomEvent('sonora:token-usage', {
          detail: {
            account: result.tokenAccount,
            charge: result.tokenCharge,
            eventId: playbackEventId,
            completed,
            progress: track.duration ? Math.min(1, seconds / track.duration) : 0,
          },
        }))
      }
      return result
    }).catch(() => {
      recordedPlaybackIdsRef.current.delete(playbackEventId)
      return null
    })
  }, [])

  const updateMediaSession = useCallback((track) => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.artworkUrl ? [{ src: track.artworkUrl, sizes: '512x512' }] : [],
    })
  }, [])

  const loadTrack = useCallback(async (track, fade = true) => {
    const graph = ensureGraph()
    if (graph.context.state === 'suspended') await graph.context.resume()
    let playableTrack = track
    try {
      if (track?.sourceKind === '8spine') {
        try {
          playableTrack = await resolveEightSpineTrack(track)
        } catch (error) {
          if (!track.streamUrl) throw error
        }
        if (playableTrack !== track) {
          const queuedIndex = queueRef.current.findIndex((candidate) => candidate.id === track.id)
          if (queuedIndex >= 0) {
            const nextQueue = [...queueRef.current]
            nextQueue[queuedIndex] = playableTrack
            queueRef.current = nextQueue
            setQueue(nextQueue)
          }
        }
      }
      if (!playableTrack?.streamUrl) throw new Error('La pista no tiene un enlace de audio reproducible.')
    } catch (error) {
      setPlaying(false)
      window.dispatchEvent(new CustomEvent('sonora:playback-error', {
        detail: { message: error?.message || 'No se pudo preparar la pista.' },
      }))
      return
    }
    const oldDeckIndex = graph.activeDeck
    const newDeckIndex = fade && currentRef.current ? 1 - oldDeckIndex : oldDeckIndex
    const oldDeck = graph.decks[oldDeckIndex]
    const newDeck = graph.decks[newDeckIndex]
    newDeck.src = playableTrack.streamUrl
    newDeck.currentTime = 0
    graph.activeDeck = newDeckIndex
    currentRef.current = playableTrack
    setCurrentTrack(playableTrack)
    const nextPlaybackId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${playableTrack.id}-${Math.random()}`
    playbackIdRef.current = nextPlaybackId
    setDuration(playableTrack.duration || 0)
    setCurrentTime(0)
    startedAtRef.current = Date.now()
    updateMediaSession(playableTrack)

    try {
      await newDeck.play()
      setPlaying(true)
      if (playableTrack.sourceKind === '8spine') {
        api('/token-usage/stream', {
          method: 'POST',
          body: JSON.stringify({
            eventId: nextPlaybackId,
            moduleId: playableTrack.moduleId,
            moduleTrackId: playableTrack.moduleTrackId,
            title: playableTrack.title,
            artist: playableTrack.artist,
            album: playableTrack.album,
            artworkUrl: playableTrack.artworkUrl,
          }),
        }).then((result) => {
          if (!result?.charged || !result.account) return
          window.dispatchEvent(new CustomEvent('sonora:token-usage', {
            detail: {
              account: result.account,
              charge: result.charged,
              euroCents: result.euroCents,
              eventId: nextPlaybackId,
              completed: true,
              progress: 1,
              stream: true,
            },
          }))
        }).catch(() => {})
      }
      if (newDeckIndex !== oldDeckIndex && crossfadeRef.current > 0) {
        transitionRef.current = true
        const now = graph.context.currentTime
        graph.deckGains[newDeckIndex].gain.cancelScheduledValues(now)
        graph.deckGains[oldDeckIndex].gain.cancelScheduledValues(now)
        graph.deckGains[newDeckIndex].gain.setValueAtTime(0.001, now)
        graph.deckGains[oldDeckIndex].gain.setValueAtTime(Math.max(0.001, graph.deckGains[oldDeckIndex].gain.value), now)
        graph.deckGains[newDeckIndex].gain.exponentialRampToValueAtTime(1, now + crossfadeRef.current)
        graph.deckGains[oldDeckIndex].gain.exponentialRampToValueAtTime(0.001, now + crossfadeRef.current)
        window.setTimeout(() => {
          oldDeck.pause()
          oldDeck.removeAttribute('src')
          transitionRef.current = false
        }, crossfadeRef.current * 1000 + 80)
      } else {
        graph.deckGains[newDeckIndex].gain.value = 1
      }
    } catch (error) {
      setPlaying(false)
      window.dispatchEvent(new CustomEvent('sonora:playback-error', {
        detail: { message: error?.message || `No se pudo reproducir ${playableTrack.title}.` },
      }))
    }
  }, [ensureGraph, updateMediaSession])

  const playCollection = useCallback((tracks, startIndex = 0, context = null) => {
    if (!tracks?.length) return
    recordListen(false, true)
    queueRef.current = tracks
    indexRef.current = startIndex
    sessionContextRef.current = typeof context === 'string' ? { intent: context } : (context || {})
    consecutiveSkipsRef.current = 0
    setQueue(tracks)
    setCurrentIndex(startIndex)
    loadTrack(tracks[startIndex], false)
  }, [loadTrack, recordListen])

  const playAt = useCallback((queueIndex) => {
    const tracks = queueRef.current
    const nextIndex = Number(queueIndex)
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= tracks.length) return
    recordListen(false, true)
    consecutiveSkipsRef.current = 0
    indexRef.current = nextIndex
    setCurrentIndex(nextIndex)
    loadTrack(tracks[nextIndex], true)
  }, [loadTrack, recordListen])

  const addToQueue = useCallback((track, placement = 'end') => {
    if (!track) return
    if (!queueRef.current.length) {
      playCollection([track], 0, { source: 'context-menu' })
    } else {
      const nextQueue = [...queueRef.current]
      const insertAt = placement === 'next'
        ? Math.min(nextQueue.length, Math.max(0, indexRef.current + 1))
        : nextQueue.length
      nextQueue.splice(insertAt, 0, track)
      queueRef.current = nextQueue
      setQueue(nextQueue)
    }
    api('/interactions', {
      method: 'POST',
      body: JSON.stringify({
        trackId: track.id,
        eventType: 'queue_add',
        context: { placement },
      }),
    }).catch(() => {})
  }, [playCollection])

  const next = useCallback((manual = true, completed = false) => {
    const tracks = queueRef.current
    if (!tracks.length) return
    recordListen(completed, manual && !completed)
    if (completed) consecutiveSkipsRef.current = 0
    else if (manual) consecutiveSkipsRef.current += 1
    if (repeatRef.current === 'one' && !manual) {
      loadTrack(currentRef.current, false)
      return
    }
    let nextIndex = shuffleRef.current
      ? Math.floor(Math.random() * tracks.length)
      : indexRef.current + 1
    if (nextIndex >= tracks.length) {
      if (repeatRef.current !== 'all') {
        const graph = graphRef.current
        graph?.decks[graph.activeDeck]?.pause()
        setPlaying(false)
        return
      }
      nextIndex = 0
    }
    indexRef.current = nextIndex
    setCurrentIndex(nextIndex)
    loadTrack(tracks[nextIndex], true)
    const sessionContext = sessionContextRef.current || {}
    if (
      manual &&
      consecutiveSkipsRef.current >= 2 &&
      typeof sessionContext.onAdapt === 'function'
    ) {
      const skipCount = consecutiveSkipsRef.current
      Promise.resolve(sessionContext.onAdapt({
        currentTrackId: tracks[nextIndex]?.id,
        consecutiveSkips: skipCount,
      })).then((adaptedSession) => {
        if (!adaptedSession?.tracks?.length) return
        const keepThrough = indexRef.current + 1
        const keptTracks = queueRef.current.slice(0, keepThrough)
        const seen = new Set(keptTracks.map((track) => track.id))
        const adaptedTracks = adaptedSession.tracks.filter((track) => !seen.has(track.id))
        const nextQueue = [...keptTracks, ...adaptedTracks]
        queueRef.current = nextQueue
        setQueue(nextQueue)
        sessionContextRef.current = {
          ...sessionContext,
          intent: adaptedSession.intent,
          sessionId: adaptedSession.sessionId,
          runId: adaptedSession.runId,
        }
        consecutiveSkipsRef.current = 0
      }).catch(() => {})
    }
  }, [loadTrack, recordListen])

  useEffect(() => {
    nextRef.current = next
  }, [next])

  const previous = useCallback(() => {
    const graph = graphRef.current
    if (!graph) return
    const deck = graph.decks[graph.activeDeck]
    if (deck.currentTime > 4) {
      deck.currentTime = 0
      return
    }
    const previousIndex = Math.max(0, indexRef.current - 1)
    recordListen(false, true)
    indexRef.current = previousIndex
    setCurrentIndex(previousIndex)
    loadTrack(queueRef.current[previousIndex], true)
  }, [loadTrack, recordListen])

  const toggle = useCallback(async () => {
    if (!currentRef.current && queueRef.current.length) {
      loadTrack(queueRef.current[0], false)
      return
    }
    const graph = graphRef.current
    if (!graph) return
    const deck = graph.decks[graph.activeDeck]
    if (deck.paused) {
      if (!playbackIdRef.current || recordedPlaybackIdsRef.current.has(playbackIdRef.current)) {
        playbackIdRef.current = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${currentRef.current.id}-${Math.random()}`
        startedAtRef.current = Date.now()
      }
      await graph.context.resume()
      await deck.play()
      setPlaying(true)
    } else {
      deck.pause()
      setPlaying(false)
    }
  }, [loadTrack])

  const stop = useCallback(() => {
    const graph = graphRef.current
    if (!graph) return
    const deck = graph.decks[graph.activeDeck]
    const pendingRecord = recordListen(false, true)
    deck.pause()
    deck.currentTime = 0
    playbackIdRef.current = null
    setCurrentTime(0)
    setPlaying(false)
    return pendingRecord
  }, [recordListen])

  const seek = useCallback((seconds) => {
    const graph = graphRef.current
    if (!graph) return
    graph.decks[graph.activeDeck].currentTime = seconds
    setCurrentTime(seconds)
  }, [])

  const setVolume = useCallback((value, commit = true) => {
    const nextVolume = Math.max(0, Math.min(1, Number(value)))
    volumeRef.current = nextVolume
    if (commit) setVolumeState((current) => current === nextVolume ? current : nextVolume)
    const graph = graphRef.current
    if (graph) smoothAudioParam(graph.context, graph.master.gain, mutedRef.current ? 0 : nextVolume, 0.012)
  }, [])

  const adjustVolume = useCallback((delta) => {
    setVolume(volumeRef.current + Number(delta || 0), true)
  }, [setVolume])

  const toggleMute = useCallback(() => {
    const nextValue = !mutedRef.current
    mutedRef.current = nextValue
    setMuted(nextValue)
    const graph = graphRef.current
    if (graph) smoothAudioParam(graph.context, graph.master.gain, nextValue ? 0 : volumeRef.current, 0.01)
  }, [])

  const setShuffle = useCallback((value) => {
    shuffleRef.current = value
    setShuffleState(value)
  }, [])

  const cycleRepeat = useCallback(() => {
    const nextValue = repeatRef.current === 'off' ? 'all' : repeatRef.current === 'all' ? 'one' : 'off'
    repeatRef.current = nextValue
    setRepeatState(nextValue)
  }, [])

  const setCrossfade = useCallback((value, commit = true) => {
    const seconds = Math.max(0, Math.min(12, Number(value) || 0))
    crossfadeRef.current = seconds
    if (commit) setCrossfadeState((current) => current === seconds ? current : seconds)
  }, [])

  const setSpatial = useCallback((value) => {
    const enabled = Boolean(value)
    setSpatialState(enabled)
    const graph = graphRef.current
    if (graph) {
      smoothAudioParam(graph.context, graph.delayLeft.delayTime, enabled ? 0.006 : 0, 0.04)
      smoothAudioParam(graph.context, graph.delayRight.delayTime, enabled ? 0.014 : 0, 0.04)
      smoothAudioParam(graph.context, graph.panner.pan, enabled ? 0.03 : 0, 0.04)
    }
  }, [])

  const setEqBand = useCallback((index, value, commit = true) => {
    const amount = Math.max(-12, Math.min(12, Number(value) || 0))
    const nextValue = [...eqRef.current]
    nextValue[index] = amount
    eqRef.current = nextValue
    if (commit) setEqState(nextValue)
    const graph = graphRef.current
    if (graph) smoothAudioParam(graph.context, graph.eqNodes[index].gain, eqEnabledRef.current ? amount : 0, 0.025)
  }, [])

  const setEqCurve = useCallback((curve, commit = true) => {
    const nextCurve = EQ_FREQUENCIES.map((_, index) => Math.max(-12, Math.min(12, Number(curve?.[index]) || 0)))
    eqRef.current = nextCurve
    if (commit) setEqState(nextCurve)
    const graph = graphRef.current
    if (!graph) return
    graph.eqNodes.forEach((node, index) => {
      smoothAudioParam(graph.context, node.gain, eqEnabledRef.current ? nextCurve[index] : 0, 0.025)
    })
  }, [])

  const setEqEnabled = useCallback((value) => {
    const enabled = Boolean(value)
    eqEnabledRef.current = enabled
    setEqEnabledState(enabled)
    const graph = graphRef.current
    if (!graph) return
    graph.eqNodes.forEach((node, index) => {
      smoothAudioParam(graph.context, node.gain, enabled ? eqRef.current[index] : 0, 0.035)
    })
  }, [])

  const setBassBoost = useCallback((value, commit = true) => {
    const amount = Math.max(0, Math.min(1, Number(value)))
    bassBoostRef.current = amount
    if (commit) setBassBoostState((current) => current === amount ? current : amount)
    const graph = graphRef.current
    if (graph) smoothAudioParam(graph.context, graph.bassEnhancer.gain, amount * 9, 0.03)
  }, [])

  const setCompression = useCallback((value) => {
    const enabled = Boolean(value)
    compressionRef.current = enabled
    setCompressionState(enabled)
    const graph = graphRef.current
    if (!graph) return
    smoothAudioParam(graph.context, graph.compressor.threshold, enabled ? -24 : 0, 0.04)
    smoothAudioParam(graph.context, graph.compressor.knee, enabled ? 12 : 0, 0.04)
    smoothAudioParam(graph.context, graph.compressor.ratio, enabled ? 4 : 1, 0.04)
  }, [])

  const setAmbience = useCallback((value, commit = true) => {
    const amount = Math.max(0, Math.min(1, Number(value)))
    ambienceRef.current = amount
    if (commit) setAmbienceState((current) => current === amount ? current : amount)
    const graph = graphRef.current
    if (!graph) return
    smoothAudioParam(graph.context, graph.dryGain.gain, 1 - amount * 0.12, 0.035)
    smoothAudioParam(graph.context, graph.wetGain.gain, amount * 0.3, 0.035)
  }, [])

  const reorderQueue = useCallback((from, to) => {
    const nextQueue = [...queueRef.current]
    const [moved] = nextQueue.splice(from, 1)
    nextQueue.splice(to, 0, moved)
    queueRef.current = nextQueue
    const activeId = currentRef.current?.id
    const nextIndex = nextQueue.findIndex((track) => track.id === activeId)
    indexRef.current = nextIndex
    setCurrentIndex(nextIndex)
    setQueue(nextQueue)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const graph = graphRef.current
      if (!graph) return
      const deck = graph.decks[graph.activeDeck]
      setCurrentTime(deck.currentTime || 0)
      if (Number.isFinite(deck.duration)) setDuration(deck.duration)
      if (
        'mediaSession' in navigator &&
        Number.isFinite(deck.duration) &&
        deck.duration > 0 &&
        Number.isFinite(deck.currentTime)
      ) {
        try {
          navigator.mediaSession.setPositionState({
            duration: deck.duration,
            playbackRate: deck.playbackRate || 1,
            position: Math.min(deck.currentTime, deck.duration),
          })
        } catch {
          // Some browsers expose Media Session without position state support.
        }
      }
      if (
        !transitionRef.current &&
        !deck.paused &&
        repeatRef.current !== 'one' &&
        crossfadeRef.current > 0 &&
        deck.duration > crossfadeRef.current + 1 &&
        deck.duration - deck.currentTime <= crossfadeRef.current
      ) {
        nextRef.current?.(false, true)
      }
    }, 300)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    function preservePartialListen() {
      recordListen(false, true, true)
    }
    window.addEventListener('pagehide', preservePartialListen)
    return () => window.removeEventListener('pagehide', preservePartialListen)
  }, [recordListen])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const setHandler = (action, handler) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
      } catch {
        // Browsers and headset drivers do not all expose the same actions.
      }
    }
    setHandler('play', async () => {
      const graph = graphRef.current
      if (!graph) {
        toggle()
        return
      }
      const deck = graph.decks[graph.activeDeck]
      if (deck.paused) {
        await graph.context.resume()
        await deck.play()
        setPlaying(true)
      }
    })
    setHandler('pause', () => {
      const graph = graphRef.current
      if (!graph) return
      graph.decks[graph.activeDeck].pause()
      setPlaying(false)
    })
    setHandler('stop', stop)
    setHandler('previoustrack', previous)
    setHandler('nexttrack', () => next(true, false))
    setHandler('seekbackward', (details) => {
      const graph = graphRef.current
      const deck = graph?.decks[graph.activeDeck]
      if (deck) seek(Math.max(0, deck.currentTime - (details.seekOffset || 10)))
    })
    setHandler('seekforward', (details) => {
      const graph = graphRef.current
      const deck = graph?.decks[graph.activeDeck]
      if (deck) seek(Math.min(deck.duration || Infinity, deck.currentTime + (details.seekOffset || 10)))
    })
    setHandler('seekto', (details) => seek(details.seekTime || 0))
  }, [next, previous, seek, stop, toggle])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  }, [playing])

  useEffect(() => {
    window.localStorage.setItem('sonora-equalizer', JSON.stringify({ curve: eq, enabled: eqEnabled }))
  }, [eq, eqEnabled])

  useEffect(() => {
    function handleMediaKey(event) {
      if (event.key === 'MediaPlayPause') toggle()
      if (event.key === 'MediaStop') stop()
      if (event.key === 'MediaTrackNext') next(true, false)
      if (event.key === 'MediaTrackPrevious') previous()
    }
    window.addEventListener('keydown', handleMediaKey)
    return () => window.removeEventListener('keydown', handleMediaKey)
  }, [next, previous, stop, toggle])

  useEffect(() => () => {
    const graph = graphRef.current
    if (!graph) return
    graph.decks.forEach((deck) => deck.pause())
    graph.context.close()
  }, [])

  const nextManual = useCallback(() => next(true, false), [next])

  return {
    currentTrack,
    playing,
    currentTime,
    duration,
    volume,
    muted,
    queue,
    currentIndex,
    shuffle,
    repeat,
    crossfade,
    spatial,
    eq,
    eqEnabled,
    bassBoost,
    compression,
    ambience,
    analyser,
    playCollection,
    playAt,
    addToQueue,
    toggle,
    next: nextManual,
    previous,
    seek,
    setVolume,
    adjustVolume,
    toggleMute,
    setShuffle,
    cycleRepeat,
    setCrossfade,
    setSpatial,
    setEqBand,
    setEqCurve,
    setEqEnabled,
    setBassBoost,
    setCompression,
    setAmbience,
    stop,
    reorderQueue,
  }
}
