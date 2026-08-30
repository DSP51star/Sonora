const MODULE_MAGIC = '8SM1.'
const EIGHT_SPINE_ALPHABET = '8spinezkxvqrwmht'
const SECRET_ENVELOPE = 'wkriekqeswpwtzesmeiwqttqxenqkekenrwrqrpmehptsvvxkkkwpnzrzknvxisswxxzinxtzi8wte8vvkpqtzq8mnnekv'
const SECRET_SEED = 2233412666
const UTF8_ENCODER = new TextEncoder()
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })
const DECODE_TABLE = Object.fromEntries([...EIGHT_SPINE_ALPHABET].map((symbol, index) => [symbol, index]))

export const EIGHT_SPINE_STREAM_EURO_CENTS = 18
export const EIGHT_SPINE_STREAM_TOKEN_COST = 12.86

function concatBytes(...parts) {
  const arrays = parts.map((part) => part instanceof Uint8Array ? part : new Uint8Array(part))
  const result = new Uint8Array(arrays.reduce((total, part) => total + part.length, 0))
  let offset = 0
  arrays.forEach((part) => {
    result.set(part, offset)
    offset += part.length
  })
  return result
}

async function sha256(...parts) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Este navegador no ofrece el cifrado necesario para abrir módulos 8SPINE.')
  return new Uint8Array(await subtle.digest('SHA-256', concatBytes(...parts)))
}

function decode8sx(value) {
  if (value.length % 2 !== 0) throw new Error('El módulo 8SPINE tiene una longitud incorrecta.')
  const bytes = new Uint8Array(value.length / 2)
  for (let cursor = 0; cursor < value.length; cursor += 2) {
    const high = DECODE_TABLE[value[cursor]]
    const low = DECODE_TABLE[value[cursor + 1]]
    if (high === undefined || low === undefined) throw new Error('El módulo 8SPINE contiene símbolos desconocidos.')
    bytes[cursor / 2] = (high << 4) | low
  }
  return bytes
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

function counterBytes(value) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

async function moduleSecret() {
  const seedHash = await sha256(UTF8_ENCODER.encode(String(SECRET_SEED)))
  const concealed = decode8sx(SECRET_ENVELOPE)
  const revealed = concealed.map((byte, index) => byte ^ seedHash[index % seedHash.length])
  return UTF8_DECODER.decode(revealed)
}

async function moduleKeystream(seed, length) {
  const output = new Uint8Array(length)
  for (let offset = 0, counter = 0; offset < length; counter += 1) {
    const block = await sha256(seed, counterBytes(counter))
    output.set(block.subarray(0, Math.min(block.length, length - offset)), offset)
    offset += block.length
  }
  return output
}

export function isEncryptedEightSpineModule(value) {
  return typeof value === 'string' && value.replace(/^\uFEFF/, '').trim().startsWith(MODULE_MAGIC)
}

export async function decryptEightSpineModule(value) {
  const envelope = String(value ?? '').replace(/^\uFEFF/, '').trim()
  if (!envelope) throw new Error('El módulo 8SPINE está vacío.')
  if (!envelope.startsWith(MODULE_MAGIC)) return envelope

  const payload = decode8sx(envelope.slice(MODULE_MAGIC.length))
  if (payload.length < 32) throw new Error('El módulo 8SPINE está incompleto.')
  const nonce = payload.slice(0, 16)
  const tag = payload.slice(16, 32)
  const ciphertext = payload.slice(32)
  const key = await sha256(UTF8_ENCODER.encode(await moduleSecret()))
  const expectedTag = (await sha256(key, nonce, ciphertext)).slice(0, 16)
  if (!equalBytes(tag, expectedTag)) throw new Error('El módulo 8SPINE está dañado o no pertenece a una versión compatible.')

  const streamSeed = await sha256(key, nonce)
  const stream = await moduleKeystream(streamSeed, ciphertext.length)
  const cleartext = ciphertext.map((byte, index) => byte ^ stream[index])
  try {
    return UTF8_DECODER.decode(cleartext)
  } catch {
    throw new Error('El contenido descodificado del módulo 8SPINE no es JavaScript válido.')
  }
}

export function normalizeEightSpineInputUrl(value) {
  let url
  try {
    url = new URL(String(value || '').trim())
  } catch {
    throw new Error('Escribe una URL completa para el catálogo o repositorio de módulos.')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('La fuente de módulos debe usar http o https.')

  if (url.hostname.toLowerCase() === 'github.com') {
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length < 2) throw new Error('La URL de GitHub debe apuntar a un repositorio 8SPINE.')
    const owner = parts[0]
    const repository = parts[1].replace(/\.git$/i, '')
    if (parts[2] === 'blob' && parts.length >= 5) {
      return `https://raw.githubusercontent.com/${owner}/${repository}/refs/heads/${parts[3]}/${parts.slice(4).join('/')}`
    }
    if (parts[2] === 'tree' && parts.length >= 4) {
      const suffix = parts.slice(4).join('/')
      return `https://raw.githubusercontent.com/${owner}/${repository}/refs/heads/${parts[3]}/${suffix ? `${suffix}/` : ''}index.json`
    }
    return `https://raw.githubusercontent.com/${owner}/${repository}/refs/heads/main/index.json`
  }

  if (url.hostname.toLowerCase() === 'raw.githubusercontent.com' && !/\.(?:json|8spine|js)$/i.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/index.json`
  }
  return url.href
}

function sourceEntries(payload) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  if (Array.isArray(payload.modules)) return payload.modules
  if (payload.download && (payload.id || payload.name)) return [payload]
  return Object.entries(payload)
    .filter(([key, value]) => key.startsWith('category:') && Array.isArray(value))
    .flatMap(([, value]) => value)
}

function moduleDownloadUrl(entry, sourceUrl) {
  const candidate = entry.download || entry.url || entry.file
  if (!candidate) return null
  try {
    return new URL(String(candidate), sourceUrl).href
  } catch {
    return null
  }
}

export function normalizeEightSpineSourceIndex(payload, { sourceUrl }) {
  const entries = sourceEntries(payload)
  const seen = new Set()
  const modules = entries.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const type = String(entry.type || 'MODULE').toUpperCase()
    if (!['MODULE', 'STREAM'].includes(type)) return []
    const downloadUrl = moduleDownloadUrl(entry, sourceUrl)
    if (!downloadUrl || !/\.(?:8spine|js)(?:$|[?#])/i.test(downloadUrl)) return []
    const id = String(entry.id || entry.pkg || entry.name || `module-${index + 1}`).trim()
    const key = `${id}\u0000${downloadUrl}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{
      catalogId: id,
      id,
      name: String(entry.name || id).trim(),
      author: String(entry.author || '').trim(),
      version: String(entry.version || '').replace(/^v/i, '').trim(),
      description: String(entry.description || '').trim(),
      labels: (entry.labels || entry.tags || []).map(String).filter(Boolean),
      trusted: entry.trusted === true,
      featured: entry.featured === true,
      downloadUrl,
      sourceUrl,
    }]
  })
  if (!modules.length) {
    const error = new Error('La URL devuelve JSON, pero no contiene módulos 8SPINE instalables.')
    error.code = 'NOT_EIGHTSPINE_SOURCE'
    throw error
  }
  return { sourceUrl, modules }
}

export function directEightSpineDescriptor(sourceUrl) {
  const url = new URL(sourceUrl)
  const filename = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) || 'Módulo 8SPINE')
  const name = filename.replace(/\.(?:8spine|js)$/i, '') || 'Módulo 8SPINE'
  return {
    catalogId: `direct:${url.href}`,
    id: `direct:${url.href}`,
    name,
    author: '',
    version: '',
    description: 'Módulo 8SPINE directo',
    labels: [],
    trusted: false,
    featured: false,
    downloadUrl: url.href,
    sourceUrl: url.href,
  }
}

function stableIdentifier(value) {
  let hash = 2166136261
  const input = String(value)
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function metadataText(value, fallback = '') {
  if (Array.isArray(value)) {
    const joined = value.map((entry) => metadataText(entry)).filter(Boolean).join(', ')
    return joined || fallback
  }
  if (value && typeof value === 'object') {
    return metadataText(value.name ?? value.title ?? value.label ?? value.artistName ?? value.value, fallback)
  }
  const text = String(value ?? '').trim()
  return text || fallback
}

export function normalizeEightSpineTrack(rawTrack, moduleInfo, index = 0) {
  const wrapper = rawTrack && typeof rawTrack === 'object' ? rawTrack : {}
  const nested = wrapper.track ?? wrapper.item ?? wrapper.song
  const raw = nested && typeof nested === 'object' ? { ...wrapper, ...nested } : wrapper
  const moduleTrackId = raw.id ?? raw.trackId ?? raw.track_id ?? raw.videoId ?? raw.songId ?? raw.playbackId ?? raw.url
  if (moduleTrackId === undefined || moduleTrackId === null || moduleTrackId === '') return null
  const title = metadataText(raw.title ?? raw.name, 'Pista sin título')
  const artist = metadataText(raw.artist ?? raw.artistName ?? raw.artists ?? raw.performers ?? raw.contributors, 'Artista desconocido')
  const album = metadataText(raw.album ?? raw.albumTitle ?? raw.albumName, 'Álbum desconocido')
  const artworkValue = raw.albumCover ?? raw.coverUrl ?? raw.cover ?? raw.artworkUrl ?? raw.artwork ?? raw.image ?? raw.thumbnail
  const artworkUrl = metadataText(artworkValue?.url ?? artworkValue?.src ?? artworkValue, '') || null
  const moduleId = moduleInfo.catalogId || moduleInfo.id
  const sourceKey = `8spine:${moduleId}:${String(moduleTrackId)}`
  return {
    id: `8spine:${stableIdentifier(`${sourceKey}:${index}`)}`,
    sourceKey,
    sourceKind: '8spine',
    sourceName: moduleInfo.name || '8SPINE',
    browserOnly: true,
    moduleId,
    moduleTrackId,
    file_name: title,
    title,
    artist,
    album,
    album_artist: '',
    year: finiteNumber(raw.year) || null,
    genre: metadataText(raw.genre ?? raw.genres, 'Streaming'),
    duration: finiteNumber(raw.duration || raw.durationSeconds),
    bitrate: finiteNumber(raw.bitrate) || null,
    sample_rate: finiteNumber(raw.sampleRate || raw.sample_rate) || null,
    bit_depth: finiteNumber(raw.bitDepth || raw.bit_depth) || null,
    channels: finiteNumber(raw.channels) || null,
    codec: metadataText(raw.codec ?? raw.format, 'stream'),
    container: metadataText(raw.container ?? raw.format, 'audio'),
    quality: metadataText(raw.audioQuality ?? raw.quality, 'stream'),
    favorite: false,
    play_count: 0,
    tokenCost: EIGHT_SPINE_STREAM_TOKEN_COST,
    streamPriceEuroCents: EIGHT_SPINE_STREAM_EURO_CENTS,
    added_at: new Date().toISOString(),
    artworkUrl: artworkUrl ? String(artworkUrl) : null,
    streamUrl: null,
    location: `${moduleInfo.name || '8SPINE'} · ${String(moduleTrackId)}`,
    mood: 'Sin analizar',
    lyrics: null,
  }
}
