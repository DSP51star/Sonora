import dns from 'node:dns'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const APP_USER_AGENT = 'SonoraLocal/1.0 (+https://github.com/)'
const JSON_TIMEOUT_MS = 10_000
const DOWNLOAD_TIMEOUT_MS = 30_000
const MAX_AUDIO_BYTES = 600 * 1024 * 1024
const providerCache = new Map()

function cached(key, ttl, loader) {
  const existing = providerCache.get(key)
  if (existing && existing.expiresAt > Date.now()) return existing.promise
  const promise = Promise.resolve().then(loader).catch((error) => {
    providerCache.delete(key)
    throw error
  })
  providerCache.set(key, { expiresAt: Date.now() + ttl, promise })
  return promise
}

async function fetchJson(url, provider) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), JSON_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': APP_USER_AGENT },
      signal: controller.signal,
    })
    if (!response.ok) {
      const error = new Error(`${provider} respondió ${response.status}.`)
      error.status = response.status
      throw error
    }
    return await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`${provider} tardó demasiado en responder.`, { cause: error })
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function text(value, fallback = '') {
  return String(value || '').trim() || fallback
}

function appleArtwork(value, size = 600) {
  const source = text(value)
  if (!source) return null
  return source.replace(/\/\d+x\d+(?:bb)?(?=\.[a-z]+(?:$|\?))/i, `/${size}x${size}bb`)
}

function appleTrack(row) {
  return {
    appleId: row.trackId ? String(row.trackId) : null,
    artistId: row.artistId ? String(row.artistId) : null,
    collectionId: row.collectionId ? String(row.collectionId) : null,
    title: text(row.trackName),
    artist: text(row.artistName, 'Artista desconocido'),
    album: text(row.collectionName, 'Álbum desconocido'),
    artworkUrl: appleArtwork(row.artworkUrl100),
    releaseDate: row.releaseDate || null,
    year: row.releaseDate ? new Date(row.releaseDate).getUTCFullYear() : null,
    genre: text(row.primaryGenreName),
    duration: Math.max(0, Number(row.trackTimeMillis || 0) / 1000),
    previewUrl: text(row.previewUrl) || null,
    appleUrl: text(row.trackViewUrl) || null,
    explicit: row.trackExplicitness === 'explicit',
    provider: 'Apple Music España',
  }
}

function uniqueBy(rows, key) {
  const seen = new Set()
  return rows.filter((row) => {
    const value = key(row)
    if (!value || seen.has(value)) return false
    seen.add(value)
    return true
  })
}

export async function appleMusicSearch(term, limit = 30) {
  const query = text(term).slice(0, 180)
  if (query.length < 2) return { provider: 'Apple Music España', country: 'ES', tracks: [], artists: [], albums: [] }
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 30))
  const key = `apple:${query.toLocaleLowerCase('es')}:${safeLimit}`
  return cached(key, 30 * 60_000, async () => {
    const url = new URL('https://itunes.apple.com/search')
    url.search = new URLSearchParams({ term: query, country: 'ES', media: 'music', entity: 'musicTrack', limit: String(safeLimit) })
    const payload = await fetchJson(url, 'Apple Music España')
    const tracks = (payload.results || []).filter((row) => row.kind === 'song').map(appleTrack).filter((row) => row.title)
    const artists = uniqueBy(tracks, (row) => row.artist.toLocaleLowerCase('es')).map((row) => ({
      id: row.artistId || row.artist,
      name: row.artist,
      artworkUrl: row.artworkUrl,
      genre: row.genre,
      appleUrl: row.appleUrl,
    }))
    const albums = uniqueBy(tracks, (row) => `${row.artist}\u0000${row.album}`.toLocaleLowerCase('es')).map((row) => ({
      id: row.collectionId || `${row.artist}:${row.album}`,
      name: row.album,
      artist: row.artist,
      artworkUrl: row.artworkUrl,
      releaseDate: row.releaseDate,
      year: row.year,
      genre: row.genre,
    }))
    return { provider: 'Apple Music España', country: 'ES', tracks, artists, albums }
  })
}

export async function appleArtistMetadata(name) {
  const artistName = text(name).slice(0, 180)
  if (!artistName) return null
  const result = await appleMusicSearch(artistName, 40)
  const normalized = artistName.toLocaleLowerCase('es')
  const matches = result.tracks.filter((track) => track.artist.toLocaleLowerCase('es') === normalized)
  const rows = matches.length ? matches : result.tracks.filter((track) => track.artist.toLocaleLowerCase('es').includes(normalized)).slice(0, 12)
  if (!rows.length) return null
  return {
    provider: result.provider,
    artistId: rows[0].artistId,
    name: rows[0].artist,
    artworkUrl: rows.find((row) => row.artworkUrl)?.artworkUrl || null,
    genres: [...new Set(rows.map((row) => row.genre).filter(Boolean))].slice(0, 4),
    albums: uniqueBy(rows, (row) => row.album.toLocaleLowerCase('es')).map((row) => ({
      id: row.collectionId || row.album,
      name: row.album,
      artist: row.artist,
      artworkUrl: row.artworkUrl,
      year: row.year,
      genre: row.genre,
    })).slice(0, 12),
    releases: rows.slice(0, 12),
  }
}

export async function appleAlbumMetadata({ collectionId, album, artist } = {}) {
  const requestedAlbum = text(album).slice(0, 240)
  const requestedArtist = text(artist).slice(0, 180)
  let resolvedCollectionId = text(collectionId).replace(/\D/g, '').slice(0, 24)

  if (!resolvedCollectionId) {
    if (!requestedAlbum) throw new Error('Apple Music necesita el nombre o el identificador del álbum.')
    const search = await appleMusicSearch([requestedAlbum, requestedArtist].filter(Boolean).join(' '), 50)
    const normalize = (value) => text(value).toLocaleLowerCase('es')
    const exact = search.albums.find((item) => normalize(item.name) === normalize(requestedAlbum)
      && (!requestedArtist || normalize(item.artist) === normalize(requestedArtist)))
    const close = exact || search.albums.find((item) => normalize(item.name) === normalize(requestedAlbum))
    resolvedCollectionId = text(close?.id).replace(/\D/g, '').slice(0, 24)
  }

  if (!resolvedCollectionId) return null
  const key = `apple-album:${resolvedCollectionId}`
  return cached(key, 6 * 60 * 60_000, async () => {
    const url = new URL('https://itunes.apple.com/lookup')
    url.search = new URLSearchParams({ id: resolvedCollectionId, entity: 'song', country: 'ES' })
    const payload = await fetchJson(url, 'Apple Music España')
    const collection = (payload.results || []).find((row) => row.wrapperType === 'collection')
    const tracks = (payload.results || [])
      .filter((row) => row.wrapperType === 'track' && row.kind === 'song')
      .map(appleTrack)
      .filter((row) => row.title)
    if (!collection && !tracks.length) return null
    const sample = tracks[0]
    const releaseDate = collection?.releaseDate || sample?.releaseDate || null
    return {
      provider: 'Apple Music España',
      country: 'ES',
      collectionId: resolvedCollectionId,
      name: text(collection?.collectionName || sample?.album, requestedAlbum || 'Álbum desconocido'),
      artist: text(collection?.artistName || sample?.artist, requestedArtist || 'Artista desconocido'),
      artworkUrl: appleArtwork(collection?.artworkUrl100 || sample?.artworkUrl, 900),
      releaseDate,
      year: releaseDate ? new Date(releaseDate).getUTCFullYear() : null,
      genre: text(collection?.primaryGenreName || sample?.genre),
      appleUrl: text(collection?.collectionViewUrl) || null,
      trackCount: Math.max(Number(collection?.trackCount || 0), tracks.length),
      tracks,
    }
  })
}

export async function lrclibLyrics({ title, artist, album, duration }) {
  const trackName = text(title).slice(0, 240)
  const artistName = text(artist).slice(0, 240)
  if (!trackName || !artistName) throw new Error('LRCLIB necesita el título y el artista.')
  const params = new URLSearchParams({ track_name: trackName, artist_name: artistName })
  if (text(album)) params.set('album_name', text(album).slice(0, 240))
  if (Number(duration) > 0) params.set('duration', String(Math.round(Number(duration))))
  const key = `lrclib:${params.toString().toLocaleLowerCase('es')}`
  return cached(key, 12 * 60 * 60_000, async () => {
    let match
    try {
      match = await fetchJson(`https://lrclib.net/api/get?${params}`, 'LRCLIB')
    } catch (error) {
      if (error.status !== 404) throw error
      const searchParams = new URLSearchParams({ track_name: trackName, artist_name: artistName })
      if (text(album)) searchParams.set('album_name', text(album).slice(0, 240))
      const results = await fetchJson(`https://lrclib.net/api/search?${searchParams}`, 'LRCLIB')
      match = Array.isArray(results) ? results.find((item) => item.syncedLyrics) || results[0] : null
    }
    if (!match) {
      const error = new Error('LRCLIB no encontró letras para esta canción.')
      error.status = 404
      throw error
    }
    const content = text(match.syncedLyrics || match.plainLyrics)
    if (!content) {
      const error = new Error(match.instrumental ? 'LRCLIB marca esta canción como instrumental.' : 'LRCLIB no tiene una letra disponible.')
      error.status = 404
      throw error
    }
    const synced = Boolean(match.syncedLyrics)
    return {
      provider: 'LRCLIB',
      providerId: match.id ? String(match.id) : null,
      sourceName: `LRCLIB-${match.id || 'letras'}.${synced ? 'lrc' : 'txt'}`,
      content,
      synced,
      format: synced ? 'lrc' : 'txt',
      trackName: match.trackName || trackName,
      artistName: match.artistName || artistName,
      albumName: match.albumName || text(album),
      duration: Number(match.duration || duration || 0),
    }
  })
}

function isPrivateAddress(address) {
  const normalized = String(address || '').toLowerCase().split('%')[0]
  if (!normalized) return true
  if (normalized.startsWith('::ffff:')) return isPrivateAddress(normalized.slice(7))
  if (net.isIPv4(normalized)) {
    const [a, b, c] = normalized.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113)
  }
  if (net.isIPv6(normalized)) {
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff') || normalized.startsWith('2001:db8')
  }
  return true
}

async function publicAddresses(hostname) {
  const normalizedHost = hostname.toLocaleLowerCase('en-US')
  if (normalizedHost === 'localhost' || normalizedHost.endsWith('.localhost') || normalizedHost.endsWith('.local')) {
    throw new Error('La descarga no puede apuntar a la red local.')
  }
  const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error('La descarga no puede apuntar a una dirección privada.')
  }
  return addresses
}

async function validateDownloadUrl(value) {
  let url
  try {
    url = new URL(String(value || ''))
  } catch {
    throw new Error('El módulo no devolvió una URL de descarga válida.')
  }
  if (url.protocol !== 'https:') throw new Error('Las descargas de módulos deben usar HTTPS.')
  await publicAddresses(url.hostname)
  return url
}

async function openPublicHttps(url, redirects = 0) {
  const target = await validateDownloadUrl(url)
  return new Promise((resolve, reject) => {
    const request = https.get(target, {
      headers: { Accept: 'audio/*, application/octet-stream;q=0.8', 'User-Agent': APP_USER_AGENT },
      timeout: DOWNLOAD_TIMEOUT_MS,
      lookup(hostname, options, callback) {
        publicAddresses(hostname).then((addresses) => {
          if (options?.all) callback(null, addresses)
          else callback(null, addresses[0].address, addresses[0].family)
        }).catch(callback)
      },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume()
        if (redirects >= 4) return reject(new Error('La descarga tiene demasiadas redirecciones.'))
        return openPublicHttps(new URL(response.headers.location, target), redirects + 1).then(resolve, reject)
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume()
        return reject(new Error(`El servidor de audio respondió ${response.statusCode}.`))
      }
      resolve(response)
    })
    request.on('timeout', () => request.destroy(new Error('La descarga tardó demasiado en responder.')))
    request.on('error', reject)
  })
}

function safeSegment(value, fallback) {
  const printable = [...text(value, fallback)].map((character) => character.charCodeAt(0) < 32 ? ' ' : character).join('')
  const cleaned = printable
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 96)
  return cleaned || fallback
}

function audioExtension(contentType, url) {
  const mime = text(contentType).split(';')[0].toLowerCase()
  const byMime = {
    'audio/flac': '.flac',
    'audio/x-flac': '.flac',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/aac': '.aac',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
  }[mime]
  if (byMime) return byMime
  const candidate = path.extname(new URL(url).pathname).toLowerCase()
  if (['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.wav'].includes(candidate)) return candidate
  throw new Error(`El servidor no devolvió un archivo de audio reconocido (${mime || 'tipo desconocido'}).`)
}

async function availablePath(directory, basename, extension) {
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = path.join(directory, `${basename}${suffix ? ` (${suffix + 1})` : ''}${extension}`)
    try {
      await fsp.access(candidate)
    } catch {
      return candidate
    }
  }
  throw new Error('No se pudo elegir un nombre libre para la descarga.')
}

export async function downloadModuleAudio({ streamUrl, musicFolder, title, artist, album }) {
  const response = await openPublicHttps(streamUrl)
  const declaredSize = Number(response.headers['content-length'] || 0)
  if (declaredSize > MAX_AUDIO_BYTES) {
    response.destroy()
    throw new Error('La canción supera el límite de descarga de 600 MB.')
  }
  const extension = audioExtension(response.headers['content-type'], streamUrl)
  const artistName = safeSegment(artist, 'Artista desconocido')
  const albumName = safeSegment(album, 'Álbum desconocido')
  const titleName = safeSegment(title, 'Pista sin título')
  const root = await fsp.realpath(path.resolve(musicFolder))
  const directory = path.resolve(root, artistName, albumName)
  if (directory !== root && !directory.startsWith(`${root}${path.sep}`)) throw new Error('La ruta de descarga no es segura.')
  await fsp.mkdir(directory, { recursive: true })
  const realDirectory = await fsp.realpath(directory)
  if (realDirectory !== root && !realDirectory.startsWith(`${root}${path.sep}`)) throw new Error('La carpeta de destino sale de la biblioteca configurada.')
  const outputPath = await availablePath(realDirectory, titleName, extension)
  const temporaryPath = path.join(realDirectory, `.sonora-${crypto.randomUUID?.() || Date.now()}.download`)
  let received = 0
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length
      if (received > MAX_AUDIO_BYTES) callback(new Error('La canción supera el límite de descarga de 600 MB.'))
      else callback(null, chunk)
    },
  })
  try {
    await pipeline(response, limiter, fs.createWriteStream(temporaryPath, { flags: 'wx' }))
    await fsp.rename(temporaryPath, outputPath)
    return { path: outputPath, bytes: received }
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}
