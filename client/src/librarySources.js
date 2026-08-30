const AUDIO_EXTENSION_PATTERN = /\.(mp3|flac|wav|ogg|m4a|aac)$/i
const LYRIC_EXTENSION_PATTERN = /\.(lrc|txt|vtt|srt)$/i
const COVER_FILE_PATTERN = /^(cover|folder|front|album)\.(jpe?g|png|webp)$/i

function pathParts(file) {
  return String(file.webkitRelativePath || file.name || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
}

function pathWithoutExtension(value) {
  return String(value || '').replace(/\.[^./\\]+$/, '')
}

function extensionOf(value) {
  return String(value || '').match(/\.([^.?#/]+)(?:[?#].*)?$/)?.[1]?.toLowerCase() || ''
}

function formatFromName(value, fallback = 'txt') {
  const extension = extensionOf(value)
  return ['lrc', 'txt', 'vtt', 'srt'].includes(extension) ? extension : fallback
}

function text(value, fallback = '') {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || fallback
  return String(value ?? '').trim() || fallback
}

function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function identifier(prefix, value, index) {
  let hash = 2166136261
  const input = `${value}:${index}`
  for (let cursor = 0; cursor < input.length; cursor += 1) {
    hash ^= input.charCodeAt(cursor)
    hash = Math.imul(hash, 16777619)
  }
  return `${prefix}:${(hash >>> 0).toString(36)}`
}

function absoluteHttpUrl(value, baseUrl) {
  if (!value) return null
  let url
  try {
    url = baseUrl ? new URL(String(value), baseUrl) : new URL(String(value))
  } catch {
    throw new Error(`El enlace “${value}” no es una URL válida.`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`El enlace “${value}” debe usar http o https.`)
  }
  return url.href
}

function filenameFromUrl(value) {
  try {
    const pathname = new URL(value).pathname
    return decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) || 'Pista sin título')
  } catch {
    return decodeURIComponent(String(value || '').split(/[?#]/)[0].split('/').filter(Boolean).at(-1) || 'Pista sin título')
  }
}

function lyricsDescriptor(entry, baseUrl) {
  const candidate = entry.lyrics ?? entry.subtitles ?? entry.captions ?? entry.lyric
  const explicitUrl = entry.lyricsUrl ?? entry.subtitlesUrl ?? entry.captionsUrl
  const objectCandidate = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : null
  const rawContent = objectCandidate?.content ?? (typeof candidate === 'string' && /\r|\n|\[\d{1,3}:\d{2}/.test(candidate) ? candidate : null)
  const rawUrl = explicitUrl ?? objectCandidate?.url ?? (typeof candidate === 'string' && !rawContent ? candidate : null)
  const sourceName = text(objectCandidate?.name || entry.lyricsName || (rawUrl ? filenameFromUrl(rawUrl) : ''), 'Subtítulos')
  const format = text(objectCandidate?.format || entry.lyricsFormat, formatFromName(rawUrl || sourceName))

  if (rawContent) {
    return {
      sourceName,
      content: String(rawContent).replace(/\r\n?/g, '\n').trim(),
      format,
      synced: format !== 'txt',
    }
  }
  if (rawUrl) {
    return {
      sourceName,
      url: absoluteHttpUrl(rawUrl, baseUrl),
      format,
      synced: format !== 'txt',
    }
  }
  return null
}

export function normalizeJsonCatalog(payload, { baseUrl = null, sourceName = 'Catálogo JSON' } = {}) {
  const entries = Array.isArray(payload)
    ? payload
    : payload?.tracks || payload?.songs || payload?.music || payload?.library
  if (!Array.isArray(entries)) {
    throw new Error('El JSON debe ser una lista de canciones o contener una propiedad “tracks”.')
  }

  const errors = []
  const tracks = entries.flatMap((rawEntry, index) => {
    const entry = typeof rawEntry === 'string' ? { url: rawEntry } : rawEntry
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`Entrada ${index + 1}: no es una canción válida.`)
      return []
    }
    try {
      const rawAudioUrl = entry.audio ?? entry.url ?? entry.src ?? entry.streamUrl ?? entry.music ?? entry.link
      if (!rawAudioUrl) throw new Error('falta el enlace de audio.')
      const streamUrl = absoluteHttpUrl(rawAudioUrl, baseUrl)
      const fileName = filenameFromUrl(streamUrl)
      const title = text(entry.title || entry.name, pathWithoutExtension(fileName))
      const artworkValue = entry.cover ?? entry.coverUrl ?? entry.artwork ?? entry.artworkUrl ?? entry.image
      const container = text(entry.container || entry.format, extensionOf(streamUrl) || 'audio')
      const lyrics = lyricsDescriptor(entry, baseUrl)
      return [{
        id: identifier('json', entry.id || streamUrl, index),
        sourceKey: `json:${streamUrl}`,
        sourceKind: 'json',
        sourceName,
        browserOnly: true,
        file_name: fileName,
        title,
        artist: text(entry.artist, 'Artista desconocido'),
        album: text(entry.album, 'Álbum desconocido'),
        album_artist: text(entry.albumArtist || entry.album_artist, ''),
        year: number(entry.year, 0) || null,
        genre: text(entry.genre, 'Sin género'),
        duration: number(entry.duration),
        bitrate: number(entry.bitrate) || null,
        sample_rate: number(entry.sampleRate || entry.sample_rate) || null,
        bit_depth: number(entry.bitDepth || entry.bit_depth) || null,
        channels: number(entry.channels) || null,
        codec: text(entry.codec, container),
        container,
        quality: text(entry.quality, 'stream'),
        favorite: false,
        play_count: 0,
        added_at: new Date().toISOString(),
        artworkUrl: artworkValue ? absoluteHttpUrl(artworkValue, baseUrl) : null,
        streamUrl,
        location: streamUrl,
        mood: text(entry.mood, 'Sin analizar'),
        lyrics,
      }]
    } catch (error) {
      errors.push(`Entrada ${index + 1}: ${error.message}`)
      return []
    }
  })

  if (!tracks.length) {
    throw new Error(errors[0] || 'El catálogo no contiene canciones reproducibles.')
  }
  return { tracks, errors, sourceName }
}

export async function importJsonFile(file) {
  if (!file) throw new Error('Elige un archivo JSON.')
  let payload
  try {
    payload = JSON.parse(await file.text())
  } catch {
    throw new Error('El archivo no contiene un JSON válido.')
  }
  return normalizeJsonCatalog(payload, { sourceName: file.name })
}

export async function importJsonUrl(value) {
  const url = absoluteHttpUrl(value)
  let response
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } })
  } catch {
    throw new Error('No se pudo descargar el JSON. Comprueba la URL y su permiso CORS.')
  }
  if (!response.ok) throw new Error(`El servidor del JSON respondió ${response.status}.`)
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('La URL no devuelve un JSON válido.')
  }
  return normalizeJsonCatalog(payload, { baseUrl: url, sourceName: new URL(url).hostname })
}

function fallbackMetadata(file) {
  const parts = pathParts(file)
  const fileName = parts.at(-1) || file.name
  const album = parts.at(-2) || 'Álbum desconocido'
  const artist = parts.at(-3) || 'Artista desconocido'
  return { fileName, album, artist, title: pathWithoutExtension(fileName) }
}

function pictureUrl(picture) {
  if (!picture?.data?.length) return null
  const bytes = picture.data instanceof Uint8Array ? picture.data : new Uint8Array(picture.data)
  return URL.createObjectURL(new Blob([bytes], { type: picture.format || 'image/jpeg' }))
}

export async function importMusicFolder(fileList, onProgress = () => {}) {
  const files = [...(fileList || [])]
  const audioFiles = files.filter((file) => AUDIO_EXTENSION_PATTERN.test(file.name))
  if (!audioFiles.length) throw new Error('La carpeta no contiene MP3, FLAC, WAV, OGG, M4A o AAC.')

  const sidecarsByTrack = new Map(files
    .filter((file) => LYRIC_EXTENSION_PATTERN.test(file.name))
    .map((file) => [pathWithoutExtension(pathParts(file).join('/')).toLocaleLowerCase('es'), file]))
  const coversByFolder = new Map()
  files.forEach((file) => {
    if (!COVER_FILE_PATTERN.test(file.name)) return
    const folder = pathParts(file).slice(0, -1).join('/').toLocaleLowerCase('es')
    if (!coversByFolder.has(folder)) coversByFolder.set(folder, file)
  })
  const coverUrls = new Map()
  const errors = []
  const tracks = []
  const { parseBlob } = await import('music-metadata')

  for (const [index, file] of audioFiles.entries()) {
    const relativePath = pathParts(file).join('/') || file.name
    const fallback = fallbackMetadata(file)
    onProgress({ current: index + 1, total: audioFiles.length, name: file.name })
    let metadata = { common: {}, format: {} }
    try {
      metadata = await parseBlob(file, { duration: true, skipCovers: false })
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`)
    }
    const common = metadata.common || {}
    const format = metadata.format || {}
    const basePath = pathWithoutExtension(relativePath).toLocaleLowerCase('es')
    const sidecar = sidecarsByTrack.get(basePath)
    let lyrics = null
    if (sidecar) {
      const lyricFormat = formatFromName(sidecar.name)
      lyrics = {
        sourceName: sidecar.name,
        content: (await sidecar.text()).replace(/\r\n?/g, '\n').trim(),
        format: lyricFormat,
        synced: lyricFormat !== 'txt',
      }
    }

    let artworkUrl = pictureUrl(common.picture?.[0])
    if (!artworkUrl) {
      const folder = pathParts(file).slice(0, -1).join('/').toLocaleLowerCase('es')
      const cover = coversByFolder.get(folder)
      if (cover) {
        if (!coverUrls.has(cover)) coverUrls.set(cover, URL.createObjectURL(cover))
        artworkUrl = coverUrls.get(cover)
      }
    }
    const extension = extensionOf(file.name)
    tracks.push({
      id: identifier('folder', `${relativePath}:${file.lastModified}:${file.size}`, index),
      sourceKey: `folder:${relativePath.toLocaleLowerCase('es')}`,
      sourceKind: 'folder',
      sourceName: pathParts(file)[0] || 'Carpeta del dispositivo',
      browserOnly: true,
      file_name: fallback.fileName,
      title: text(common.title, fallback.title),
      artist: text(common.artist, fallback.artist),
      album: text(common.album, fallback.album),
      album_artist: text(common.albumartist, ''),
      year: number(common.year) || null,
      genre: text(common.genre, 'Sin género'),
      duration: number(format.duration),
      bitrate: number(format.bitrate) || null,
      sample_rate: number(format.sampleRate) || null,
      bit_depth: number(format.bitsPerSample) || null,
      channels: number(format.numberOfChannels) || null,
      codec: text(format.codec, extension),
      container: text(format.container, extension),
      quality: 'local',
      favorite: false,
      play_count: 0,
      added_at: new Date(file.lastModified || Date.now()).toISOString(),
      fileSize: file.size,
      artworkUrl,
      streamUrl: URL.createObjectURL(file),
      location: relativePath,
      mood: 'Sin analizar',
      lyrics,
    })
  }
  return { tracks, errors, sourceName: tracks[0]?.sourceName || 'Carpeta del dispositivo' }
}

export function revokeBrowserTrackUrls(tracks) {
  const urls = new Set()
  tracks.forEach((track) => {
    if (track?.sourceKind !== 'folder') return
    if (track.streamUrl?.startsWith('blob:')) urls.add(track.streamUrl)
    if (track.artworkUrl?.startsWith('blob:')) urls.add(track.artworkUrl)
  })
  urls.forEach((url) => URL.revokeObjectURL(url))
}
