function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function normalizePlaylistText(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function playlistReferenceFields(reference) {
  return {
    title: cleanText(reference?.titulo ?? reference?.title),
    artist: cleanText(reference?.artista ?? reference?.artist ?? reference?.autor ?? reference?.author),
    album: cleanText(reference?.album),
  }
}

function artistParts(value) {
  const full = normalizePlaylistText(value)
  const parts = cleanText(value)
    .split(/\s*(?:,|&|\+|;|\bx\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b)\s*/iu)
    .map(normalizePlaylistText)
    .filter(Boolean)
  return { full, parts: [...new Set(parts)] }
}

function sameArtist(left, right) {
  const a = artistParts(left)
  const b = artistParts(right)
  if (!a.full || !b.full) return false
  if (a.full === b.full) return true
  if (a.parts.length === 1 && b.parts.includes(a.parts[0])) return true
  if (b.parts.length === 1 && a.parts.includes(b.parts[0])) return true
  return a.parts.length === b.parts.length && a.parts.every((part) => b.parts.includes(part))
}

export function findPlaylistTrack(reference, tracks = []) {
  const wanted = playlistReferenceFields(reference)
  const wantedTitle = normalizePlaylistText(wanted.title)
  if (!wantedTitle || !wanted.artist) return null
  const candidates = tracks.filter((track) => (
    normalizePlaylistText(track?.title) === wantedTitle && sameArtist(wanted.artist, track?.artist)
  ))
  if (!candidates.length) return null
  const wantedAlbum = normalizePlaylistText(wanted.album)
  return (wantedAlbum && candidates.find((track) => normalizePlaylistText(track?.album) === wantedAlbum)) || candidates[0]
}

function playlistRows(playlist) {
  if (Array.isArray(playlist?.canciones)) return { key: 'canciones', rows: playlist.canciones }
  if (Array.isArray(playlist?.tracks)) return { key: 'tracks', rows: playlist.tracks }
  return { key: 'canciones', rows: [] }
}

function completeModuleReference(reference) {
  const sourceKind = cleanText(reference?.tipoFuente ?? reference?.sourceKind).toLowerCase()
  const moduleId = cleanText(reference?.moduloId ?? reference?.moduleId)
  const trackId = cleanText(reference?.cancionModuloId ?? reference?.moduleTrackId)
  const streamUrl = cleanText(reference?.enlace ?? reference?.streamUrl)
  return sourceKind === '8spine' && Boolean(moduleId && trackId && streamUrl)
}

function canonicalReference(reference) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return reference
  const fields = playlistReferenceFields(reference)
  return {
    ...reference,
    ...(fields.title ? { titulo: fields.title } : {}),
    ...(fields.artist ? { artista: fields.artist } : {}),
  }
}

function moduleReference(reference, track) {
  const fields = playlistReferenceFields(reference)
  return {
    ...reference,
    titulo: fields.title || track.title,
    artista: fields.artist || track.artist,
    album: fields.album || track.album || 'Álbum desconocido',
    genero: reference?.genero ?? reference?.genre ?? track.genre ?? 'Streaming',
    duracionSegundos: Number(reference?.duracionSegundos ?? reference?.duration ?? track.duration ?? 0),
    tipoFuente: '8spine',
    fuente: track.sourceName || '8SPINE',
    moduloId: String(track.moduleId),
    cancionModuloId: String(track.moduleTrackId),
    enlace: track.streamUrl,
    caratula: reference?.caratula ?? reference?.artworkUrl ?? track.artworkUrl ?? null,
    formato: reference?.formato ?? reference?.codec ?? track.codec ?? 'stream',
    container: reference?.container ?? track.container ?? 'audio',
    calidad: reference?.calidad ?? reference?.quality ?? track.quality ?? 'stream',
  }
}

async function searchExactTrack(reference, searchTracks) {
  const fields = playlistReferenceFields(reference)
  const queries = [...new Set([fields.title, `${fields.title} ${fields.artist}`].map(cleanText).filter(Boolean))]
  for (const query of queries) {
    const result = await searchTracks(query, 40)
    const match = findPlaylistTrack(reference, result?.tracks || result || [])
    if (match) return match
  }
  return null
}

export async function enrichPlaylistImport(payload, {
  localTracks = [],
  activeModule = null,
  searchTracks,
  resolveTrack,
  onProgress,
} = {}) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.playlists)) {
    throw new Error('El JSON debe contener un array "playlists".')
  }

  const playlists = payload.playlists.map((playlist) => {
    if (!playlist || typeof playlist !== 'object' || Array.isArray(playlist)) return playlist
    const { key, rows } = playlistRows(playlist)
    return { ...playlist, [key]: rows.map(canonicalReference) }
  })
  const enrichedPayload = { ...payload, playlists }
  const localByTitle = new Map()
  localTracks.forEach((track) => {
    const title = normalizePlaylistText(track?.title)
    if (!title) return
    localByTitle.set(title, [...(localByTitle.get(title) || []), track])
  })

  const groups = new Map()
  let invalid = 0
  playlists.forEach((playlist, playlistIndex) => {
    if (!playlist || typeof playlist !== 'object' || Array.isArray(playlist)) return
    const { key, rows } = playlistRows(playlist)
    rows.forEach((reference, trackIndex) => {
      if (!reference || typeof reference !== 'object' || Array.isArray(reference) || completeModuleReference(reference)) return
      const fields = playlistReferenceFields(reference)
      if (!fields.title || !fields.artist) {
        invalid += 1
        return
      }
      const local = findPlaylistTrack(reference, localByTitle.get(normalizePlaylistText(fields.title)) || [])
      if (local) {
        rows[trackIndex] = { ...reference, titulo: local.title, artista: local.artist, album: fields.album || local.album }
        return
      }
      const identity = `${normalizePlaylistText(fields.title)}\u0000${normalizePlaylistText(fields.artist)}\u0000${normalizePlaylistText(fields.album)}`
      const group = groups.get(identity) || { reference, fields, locations: [] }
      group.locations.push({ playlistIndex, key, trackIndex })
      groups.set(identity, group)
    })
  })

  const tasks = [...groups.values()]
  if (tasks.length && !activeModule) {
    throw new Error('Activa un módulo 8SPINE antes de importar canciones que no están descargadas.')
  }
  if (tasks.length && (typeof searchTracks !== 'function' || typeof resolveTrack !== 'function')) {
    throw new Error('El buscador del módulo 8SPINE no está disponible.')
  }

  let resolved = 0
  let notFound = 0
  let failed = 0
  const errors = []
  for (const [index, task] of tasks.entries()) {
    onProgress?.({ completed: index, total: tasks.length, title: task.fields.title, artist: task.fields.artist })
    try {
      const candidate = await searchExactTrack(task.reference, searchTracks)
      if (!candidate) {
        notFound += task.locations.length
        continue
      }
      const track = await resolveTrack(candidate)
      if (!track?.streamUrl || !track.moduleId || track.moduleTrackId === undefined || track.moduleTrackId === null || track.moduleTrackId === '') {
        throw new Error('El módulo no devolvió un enlace y un identificador reutilizables.')
      }
      task.locations.forEach(({ playlistIndex, key, trackIndex }) => {
        playlists[playlistIndex][key][trackIndex] = moduleReference(playlists[playlistIndex][key][trackIndex], track)
      })
      resolved += task.locations.length
    } catch (error) {
      failed += task.locations.length
      if (errors.length < 10) errors.push(`${task.fields.title} — ${task.fields.artist}: ${error.message}`)
    } finally {
      onProgress?.({ completed: index + 1, total: tasks.length, title: task.fields.title, artist: task.fields.artist })
    }
  }

  return {
    payload: enrichedPayload,
    attempted: tasks.reduce((total, task) => total + task.locations.length, 0),
    resolved,
    notFound,
    failed,
    invalid,
    errors,
  }
}
