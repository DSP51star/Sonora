import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { parseFile } from 'music-metadata'
import { dataDir, db } from './db.js'

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac'])
const coversDir = path.join(dataDir, 'covers')
const configPath = path.join(dataDir, 'config.json')
await fs.mkdir(coversDir, { recursive: true })

export async function readConfig() {
  try {
    return JSON.parse(await fs.readFile(configPath, 'utf8'))
  } catch {
    return { musicFolder: '' }
  }
}

export async function writeConfig(musicFolder) {
  const resolved = path.resolve(musicFolder)
  const stat = await fs.stat(resolved)
  if (!stat.isDirectory()) throw new Error('La ruta no es una carpeta válida.')
  const config = { musicFolder: resolved, updatedAt: new Date().toISOString() }
  await fs.writeFile(configPath, JSON.stringify(config, null, 2))
  return config
}

async function findAudioFiles(root) {
  const files = []
  const queue = [root]
  while (queue.length) {
    const current = queue.shift()
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) queue.push(fullPath)
      else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath)
    }
  }
  return files
}

function text(value, fallback) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || fallback
  return String(value || '').trim() || fallback
}

async function saveArtwork(audioPath, pictures) {
  const digest = crypto.createHash('sha1').update(audioPath).digest('hex')
  if (pictures?.length) {
    const picture = pictures[0]
    const extension = picture.format?.includes('png') ? '.png' : '.jpg'
    const output = path.join(coversDir, `${digest}${extension}`)
    await fs.writeFile(output, picture.data)
    return output
  }

  const folder = path.dirname(audioPath)
  for (const candidate of ['folder.jpg', 'cover.jpg', 'Folder.jpg', 'Cover.jpg', 'folder.png', 'cover.png']) {
    const candidatePath = path.join(folder, candidate)
    try {
      await fs.access(candidatePath)
      const extension = path.extname(candidatePath)
      const output = path.join(coversDir, `${digest}${extension}`)
      await fs.copyFile(candidatePath, output)
      return output
    } catch {
      // Continúa con el siguiente nombre de carátula conocido.
    }
  }
  return null
}

const upsertTrack = db.prepare(`
  INSERT INTO tracks (
    path, file_name, title, artist, album, album_artist, year, genre, duration,
    bitrate, sample_rate, bit_depth, channels, codec, container, artwork_path, quality
  ) VALUES (
    @path, @file_name, @title, @artist, @album, @album_artist, @year, @genre, @duration,
    @bitrate, @sample_rate, @bit_depth, @channels, @codec, @container, @artwork_path, @quality
  )
  ON CONFLICT(path) DO UPDATE SET
    file_name = excluded.file_name,
    title = excluded.title,
    artist = excluded.artist,
    album = excluded.album,
    album_artist = excluded.album_artist,
    year = excluded.year,
    genre = excluded.genre,
    duration = excluded.duration,
    bitrate = excluded.bitrate,
    sample_rate = excluded.sample_rate,
    bit_depth = excluded.bit_depth,
    channels = excluded.channels,
    codec = excluded.codec,
    container = excluded.container,
    artwork_path = COALESCE(excluded.artwork_path, tracks.artwork_path),
    quality = excluded.quality
`)

export const scanState = {
  running: false,
  discovered: 0,
  processed: 0,
  errors: 0,
  message: 'Sin escaneo activo',
}

export async function indexLibraryFile(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  const metadata = await parseFile(filePath, { duration: true, skipCovers: false })
  const common = metadata.common || {}
  const format = metadata.format || {}
  const artworkPath = await saveArtwork(filePath, common.picture)
  upsertTrack.run({
    path: filePath,
    file_name: path.basename(filePath),
    title: text(common.title, path.basename(filePath, extension)),
    artist: text(common.artist, 'Artista desconocido'),
    album: text(common.album, 'Álbum desconocido'),
    album_artist: text(common.albumartist, null),
    year: common.year || null,
    genre: text(common.genre, 'Sin género'),
    duration: Number(format.duration || 0),
    bitrate: Math.round(Number(format.bitrate || 0)),
    sample_rate: format.sampleRate || null,
    bit_depth: format.bitsPerSample || null,
    channels: format.numberOfChannels || null,
    codec: format.codec || null,
    container: format.container || extension.slice(1),
    artwork_path: artworkPath,
    quality: 'hi-res',
  })
}

export async function scanLibrary(root) {
  if (scanState.running) return scanState
  scanState.running = true
  scanState.processed = 0
  scanState.errors = 0
  scanState.message = 'Buscando archivos de audio…'

  try {
    const files = await findAudioFiles(root)
    scanState.discovered = files.length
    for (const [index, file] of files.entries()) {
      scanState.message = `Leyendo ${path.basename(file)}`
      try {
        await indexLibraryFile(file)
      } catch (error) {
        scanState.errors += 1
        console.warn(`No se pudo indexar ${file}:`, error.message)
      }
      scanState.processed = index + 1
    }
    scanState.message = `Biblioteca actualizada: ${scanState.processed - scanState.errors} canciones`
  } finally {
    scanState.running = false
  }
  return scanState
}

export async function scanConfiguredLibrary() {
  const config = await readConfig()
  if (!config.musicFolder) throw new Error('Primero elige tu carpeta de música.')
  return scanLibrary(config.musicFolder)
}

export function classifyMood({ bpm, energy, brightness, dynamics }) {
  const tempo = Number(bpm || 0)
  const rms = Number(energy || 0)
  const variation = Number(dynamics || 0)
  const bright = Number(brightness || 0)
  if (tempo >= 132 && rms >= 0.58) return 'Gimnasio'
  if (tempo >= 116 && variation >= 0.19) return 'Fiesta'
  if (tempo <= 100 && rms <= 0.34 && bright <= 0.48) return 'Relax'
  if (rms <= 0.5 && variation <= 0.16) return 'Focus'
  if (tempo <= 104 && rms <= 0.42) return 'Melancólico'
  return 'Equilibrio'
}

export { AUDIO_EXTENSIONS, dataDir }
