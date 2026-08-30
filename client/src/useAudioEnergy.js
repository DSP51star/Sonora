import { useEffect } from 'react'

export function useAudioEnergy(analyser, playing) {
  useEffect(() => {
    const root = document.documentElement
    if (!analyser || !playing) {
      root.style.setProperty('--audio-energy', '0')
      root.style.setProperty('--audio-bass', '0')
      root.style.setProperty('--audio-brightness', '0')
      return undefined
    }

    const data = new Uint8Array(analyser.frequencyBinCount)
    const bassBins = Math.max(3, Math.floor(data.length * 0.14))
    const highStart = Math.floor(data.length * 0.56)
    let frame = 0
    let lastSample = 0
    let energy = 0
    let bass = 0
    let brightness = 0
    let renderedEnergy = ''
    let renderedBass = ''
    let renderedBrightness = ''

    const update = (timestamp) => {
      frame = requestAnimationFrame(update)
      if (document.hidden || timestamp - lastSample < 32) return
      lastSample = timestamp

      analyser.getByteFrequencyData(data)
      let totalSum = 0
      let bassSum = 0
      let highSum = 0
      for (let index = 0; index < data.length; index += 1) {
        const value = data[index]
        totalSum += value
        if (index < bassBins) bassSum += value
        if (index >= highStart) highSum += value
      }
      const total = totalSum / data.length / 255
      const low = bassSum / bassBins / 255
      const high = highSum / Math.max(1, data.length - highStart) / 255
      energy += (total - energy) * 0.328
      bass += (low - bass) * 0.422
      brightness += (high - brightness) * 0.294

      const nextEnergy = energy.toFixed(3)
      const nextBass = bass.toFixed(3)
      const nextBrightness = brightness.toFixed(3)
      if (nextEnergy !== renderedEnergy) {
        root.style.setProperty('--audio-energy', nextEnergy)
        renderedEnergy = nextEnergy
      }
      if (nextBass !== renderedBass) {
        root.style.setProperty('--audio-bass', nextBass)
        renderedBass = nextBass
      }
      if (nextBrightness !== renderedBrightness) {
        root.style.setProperty('--audio-brightness', nextBrightness)
        renderedBrightness = nextBrightness
      }

    }

    frame = requestAnimationFrame(update)
    return () => {
      cancelAnimationFrame(frame)
      root.style.setProperty('--audio-energy', '0')
      root.style.setProperty('--audio-bass', '0')
      root.style.setProperty('--audio-brightness', '0')
    }
  }, [analyser, playing])
}
