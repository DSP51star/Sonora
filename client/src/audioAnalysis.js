import Meyda from 'meyda'
import { api } from './api'

const FRAME_SIZE = 2048
const ANALYSIS_VERSION = 2
const SEGMENT_POSITIONS = [0.05, 0.2, 0.4, 0.6, 0.8, 0.95]

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value || 0)))
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length)
}

function standardDeviation(values) {
  const average = mean(values)
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)))
}

function meanVectors(vectors, length) {
  return Array.from({ length }, (_, index) => mean(vectors.map((vector) => vector[index] || 0)))
}

function normalizeVector(vector) {
  const magnitude = Math.sqrt(vector.reduce((total, value) => total + value ** 2, 0))
  return magnitude ? vector.map((value) => value / magnitude) : vector
}

function estimateTempo(channel, sampleRate) {
  const hop = Math.max(1, Math.floor(sampleRate * 0.05))
  const envelope = []
  for (let offset = 0; offset < channel.length; offset += hop) {
    let sum = 0
    const end = Math.min(offset + hop, channel.length)
    for (let index = offset; index < end; index += 1) sum += channel[index] ** 2
    envelope.push(Math.sqrt(sum / Math.max(1, end - offset)))
  }

  const average = mean(envelope)
  const centered = envelope.map((value) => value - average)
  let bestLag = 0
  let bestCorrelation = -Infinity
  const minLag = Math.floor(60 / 190 / 0.05)
  const maxLag = Math.floor(60 / 65 / 0.05)
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0
    for (let index = 0; index < centered.length - lag; index += 1) {
      correlation += centered[index] * centered[index + lag]
    }
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation
      bestLag = lag
    }
  }
  return bestLag ? Math.round(60 / (bestLag * 0.05)) : 0
}

function normalizeMfcc(values = []) {
  return Array.from({ length: 8 }, (_, index) => Math.tanh(Number(values[index] || 0) / 28))
}

function normalizeChroma(values = []) {
  const chroma = Array.from({ length: 12 }, (_, index) => Math.max(0, Number(values[index] || 0)))
  const total = chroma.reduce((sum, value) => sum + value, 0)
  return total ? chroma.map((value) => value / total) : chroma
}

function frameFeatures(signal, sampleRate) {
  const features = Meyda.extract([
    'rms',
    'spectralCentroid',
    'spectralFlatness',
    'spectralRolloff',
    'spectralSpread',
    'perceptualSharpness',
    'zcr',
    'mfcc',
    'chroma',
  ], signal)
  const nyquist = sampleRate / 2
  const centroid = Number(features.spectralCentroid || 0)
  const rolloff = Number(features.spectralRolloff || 0)
  const spread = Number(features.spectralSpread || 0)
  return {
    rms: clamp(features.rms),
    centroid: clamp(centroid > 1 ? centroid / (FRAME_SIZE / 2) : centroid),
    flatness: clamp(features.spectralFlatness),
    rolloff: clamp(rolloff > 1 ? rolloff / nyquist : rolloff),
    spread: clamp(spread > 1 ? spread / (FRAME_SIZE / 2) : spread),
    sharpness: clamp(Number(features.perceptualSharpness || 0) / 4),
    zcr: clamp(Number(features.zcr || 0) / FRAME_SIZE),
    mfcc: normalizeMfcc(features.mfcc),
    chroma: normalizeChroma(features.chroma),
  }
}

function analyzeSegment(channel, sampleRate, position) {
  const segmentSamples = Math.min(channel.length, Math.floor(sampleRate * 18))
  const desiredCenter = Math.floor(channel.length * position)
  const start = Math.max(0, Math.min(channel.length - segmentSamples, desiredCenter - Math.floor(segmentSamples / 2)))
  const available = Math.max(FRAME_SIZE, segmentSamples - FRAME_SIZE)
  const step = Math.max(FRAME_SIZE, Math.floor(available / 16))
  const frames = []

  for (let offset = start; offset + FRAME_SIZE <= start + segmentSamples; offset += step) {
    frames.push(frameFeatures(channel.slice(offset, offset + FRAME_SIZE), sampleRate))
  }
  if (!frames.length) frames.push(frameFeatures(channel.slice(0, FRAME_SIZE), sampleRate))

  const rmsValues = frames.map((frame) => frame.rms)
  const centroidValues = frames.map((frame) => frame.centroid)
  const flatnessValues = frames.map((frame) => frame.flatness)
  const rolloffValues = frames.map((frame) => frame.rolloff)
  const spreadValues = frames.map((frame) => frame.spread)
  const sharpnessValues = frames.map((frame) => frame.sharpness)
  const zcrValues = frames.map((frame) => frame.zcr)
  const mfcc = meanVectors(frames.map((frame) => frame.mfcc), 8)
  const chroma = normalizeChroma(meanVectors(frames.map((frame) => frame.chroma), 12))
  const summary = {
    position,
    energy: clamp(mean(rmsValues) * 4.2),
    dynamics: clamp(standardDeviation(rmsValues) * 8),
    brightness: clamp(mean(centroidValues) * 3.2),
    flatness: mean(flatnessValues),
    rolloff: mean(rolloffValues),
    spread: mean(spreadValues),
    sharpness: mean(sharpnessValues),
    zcr: mean(zcrValues),
  }
  const vector = normalizeVector([
    summary.energy,
    summary.dynamics,
    summary.brightness,
    summary.flatness,
    summary.rolloff,
    summary.spread,
    summary.sharpness,
    summary.zcr,
    ...mfcc,
    ...chroma,
  ])
  return { summary, vector }
}

async function analyzeTrack(track, context) {
  const response = await fetch(track.streamUrl)
  const arrayBuffer = await response.arrayBuffer()
  const buffer = await context.decodeAudioData(arrayBuffer)
  const channel = buffer.getChannelData(0)
  if (channel.length < FRAME_SIZE) throw new Error('La pista es demasiado corta para analizarla.')

  Meyda.sampleRate = buffer.sampleRate
  Meyda.bufferSize = FRAME_SIZE
  Meyda.melBands = 26
  Meyda.numberOfMFCCCoefficients = 13

  const segments = SEGMENT_POSITIONS.map((position) => analyzeSegment(channel, buffer.sampleRate, position))
  const segmentEnergy = segments.map((segment) => segment.summary.energy)
  const segmentDynamics = segments.map((segment) => segment.summary.dynamics)
  const segmentBrightness = segments.map((segment) => segment.summary.brightness)
  const segmentFlatness = segments.map((segment) => segment.summary.flatness)
  const tempoSlice = channel.slice(0, Math.min(channel.length, buffer.sampleRate * 120))
  const bpm = estimateTempo(tempoSlice, buffer.sampleRate)
  const peakIndex = segmentEnergy.indexOf(Math.max(...segmentEnergy))
  const energyTrajectory = segmentEnergy.at(-1) - segmentEnergy[0]
  const baseEmbedding = meanVectors(segments.map((segment) => segment.vector), 28)
  const embedding = normalizeVector([
    ...baseEmbedding,
    clamp(bpm / 190),
    energyTrajectory,
    peakIndex / Math.max(1, segments.length - 1),
    standardDeviation(segmentEnergy),
  ])
  const summary = {
    bpm,
    energy: mean(segmentEnergy),
    dynamics: mean(segmentDynamics),
    brightness: mean(segmentBrightness),
    flatness: mean(segmentFlatness),
    energyTrajectory,
    peakPosition: peakIndex / Math.max(1, segments.length - 1),
    segmentVariation: standardDeviation(segmentEnergy),
    duration: buffer.duration,
  }

  return {
    version: ANALYSIS_VERSION,
    bpm,
    energy: summary.energy,
    brightness: summary.brightness,
    dynamics: summary.dynamics,
    embedding,
    segments: segments.map((segment) => ({
      position: segment.summary.position,
      embedding: segment.vector,
      features: segment.summary,
    })),
    summary,
  }
}

export async function runBackgroundAnalysis(onProgress) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return
  const context = new AudioContextClass()
  try {
    let pending = await api('/analysis/pending?limit=2')
    while (pending.length) {
      for (const track of pending) {
        onProgress?.({ track, status: 'analysing' })
        try {
          const metrics = await analyzeTrack(track, context)
          await api(`/tracks/${track.id}/analysis`, { method: 'POST', body: JSON.stringify(metrics) })
          onProgress?.({ track, status: 'done' })
        } catch {
          await api(`/tracks/${track.id}/analysis`, {
            method: 'POST',
            body: JSON.stringify({ failed: true, version: ANALYSIS_VERSION }),
          }).catch(() => {})
          onProgress?.({ track, status: 'skipped' })
        }
      }
      pending = await api('/analysis/pending?limit=2')
      await new Promise((resolve) => window.setTimeout(resolve, 800))
    }
  } finally {
    await context.close()
  }
}
