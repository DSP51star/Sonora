import assert from 'node:assert/strict'
import { File } from 'node:buffer'
import {
  importMusicFolder,
  normalizeJsonCatalog,
  revokeBrowserTrackUrls,
} from '../client/src/librarySources.js'
import {
  decryptEightSpineModule,
  normalizeEightSpineInputUrl,
  normalizeEightSpineSourceIndex,
  normalizeEightSpineTrack,
} from '../client/src/eightSpineFormat.js'
import { removeEightSpineModule } from '../client/src/eightSpineModules.js'
import { enrichPlaylistImport } from '../client/src/playlistImport.js'

function wavFile(name, relativePath) {
  const sampleRate = 8_000
  const sampleCount = 800
  const dataSize = sampleCount * 2
  const bytes = Buffer.alloc(44 + dataSize)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(36 + dataSize, 4)
  bytes.write('WAVE', 8)
  bytes.write('fmt ', 12)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(dataSize, 40)
  const file = new File([bytes], name, { type: 'audio/wav', lastModified: Date.now() })
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath })
  return file
}

function sidecarFile(name, relativePath, content) {
  const file = new File([content], name, { type: 'text/plain' })
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath })
  return file
}

const catalog = normalizeJsonCatalog({
  tracks: [
    {
      title: 'Prueba remota',
      artist: 'Sonora',
      audio: './audio/prueba.mp3',
      cover: './covers/prueba.jpg',
      subtitles: './lyrics/prueba.vtt',
    },
    { audio: 'ftp://example.com/no-admitido.mp3' },
  ],
}, { baseUrl: 'https://cdn.example.com/catalog/library.json', sourceName: 'Pruebas' })

assert.equal(catalog.tracks.length, 1)
assert.equal(catalog.errors.length, 1)
assert.equal(catalog.tracks[0].streamUrl, 'https://cdn.example.com/catalog/audio/prueba.mp3')
assert.equal(catalog.tracks[0].artworkUrl, 'https://cdn.example.com/catalog/covers/prueba.jpg')
assert.equal(catalog.tracks[0].lyrics.url, 'https://cdn.example.com/catalog/lyrics/prueba.vtt')
assert.equal(catalog.tracks[0].lyrics.format, 'vtt')

const localAudio = wavFile('Tema.wav', 'Mi música/Artista/Álbum/Tema.wav')
const localLyrics = sidecarFile('Tema.lrc', 'Mi música/Artista/Álbum/Tema.lrc', '[00:00.00]Primera línea')
const local = await importMusicFolder([localLyrics, localAudio])
assert.equal(local.tracks.length, 1)
assert.equal(local.tracks[0].title, 'Tema')
assert.equal(local.tracks[0].artist, 'Artista')
assert.equal(local.tracks[0].album, 'Álbum')
assert.equal(local.tracks[0].lyrics.format, 'lrc')
assert.match(local.tracks[0].lyrics.content, /Primera línea/)
assert.match(local.tracks[0].streamUrl, /^blob:/)
revokeBrowserTrackUrls(local.tracks)

const encryptedModuleVector = '8SM1.888s8p8i8n8e8z8k8x8v8q8r8w8m8h8txnpq8nxmew8vizmvpmhhrhhtnq8ppxtitqvsihkpswz8zmwzwsmrhpixvxwvxtznvxwhnztw8rnqq8hzispxixixszkkmniwqhqnssqrmewvhpqixmstrrqti8zhqttkthks8evzsrsps8shnermmtxseqezt8qhpvmxpmhmqwt8qveekqqv8t8iznninqrzxpzk8xrqsiwrs8nkxezezpphrmnssr8qrn8terxrinmmrviineqeqknv888kmwx88esniivipxmqewttz8rwt8enpvxkreshsnh8isn8wxvsestmnve8tmzrehwwvrvx8xq8qmvmshrwqnrmppwivmkrq88estsxtiqniqxess'
const decryptedModule = await decryptEightSpineModule(encryptedModuleVector)
assert.match(decryptedModule, /id: 'vector'/)
assert.match(decryptedModule, /getTrackStreamUrl/)

const githubSourceUrl = normalizeEightSpineInputUrl('https://github.com/KissAnotherDay/Geolier2-8spine')
assert.equal(githubSourceUrl, 'https://raw.githubusercontent.com/KissAnotherDay/Geolier2-8spine/refs/heads/main/index.json')
const moduleSource = normalizeEightSpineSourceIndex({
  'category:modules': [
    {
      id: 'tidal-geolier2',
      name: 'Geolier2-Tidal',
      download: 'Geolier_tidal.8spine',
      version: 'v3.1.4',
      tags: ['HI-RES', 'TIDAL'],
      type: 'STREAM',
    },
    { id: 'artwork', download: 'cover.8spine', type: 'ARTWORK' },
  ],
}, { sourceUrl: githubSourceUrl })
assert.equal(moduleSource.modules.length, 1)
assert.equal(moduleSource.modules[0].catalogId, 'tidal-geolier2')
assert.equal(moduleSource.modules[0].version, '3.1.4')
assert.equal(moduleSource.modules[0].downloadUrl, 'https://raw.githubusercontent.com/KissAnotherDay/Geolier2-8spine/refs/heads/main/Geolier_tidal.8spine')

const moduleTrack = normalizeEightSpineTrack({
  id: '12345',
  title: 'Pista remota',
  artist: 'Artista remoto',
  album: 'Álbum remoto',
  albumCover: 'https://example.com/cover.jpg',
  duration: 210,
}, moduleSource.modules[0])
assert.equal(moduleTrack.sourceKind, '8spine')
assert.equal(moduleTrack.moduleTrackId, '12345')
assert.equal(moduleTrack.streamUrl, null)
assert.equal(moduleTrack.artworkUrl, 'https://example.com/cover.jpg')
assert.equal(moduleTrack.streamPriceEuroCents, 18)
assert.equal(moduleTrack.tokenCost, 12.86)

const nestedModuleTrack = normalizeEightSpineTrack({
  item: {
    trackId: 'nested-1',
    title: 'Respuesta anidada',
    artist: { name: 'Artista anidado' },
    album: { title: 'Álbum anidado' },
    artwork: { url: 'https://example.com/nested.jpg' },
  },
}, moduleSource.modules[0])
assert.equal(nestedModuleTrack.moduleTrackId, 'nested-1')
assert.equal(nestedModuleTrack.artist, 'Artista anidado')
assert.equal(nestedModuleTrack.album, 'Álbum anidado')
assert.equal(nestedModuleTrack.artworkUrl, 'https://example.com/nested.jpg')

const searchQueries = []
const importResult = await enrichPlaylistImport({
  formato: 'sonora-playlists',
  version: 2,
  playlists: [
    {
      nombre: 'Prueba de importación',
      canciones: [
        { titulo: 'Canción local', autor: 'Artista local' },
        { titulo: 'Pista remota', autor: 'Artista remoto' },
        { titulo: 'Error técnico', autor: 'Artista remoto' },
        { titulo: 'No existe', autor: 'Nadie' },
      ],
    },
  ],
}, {
  localTracks: [{ id: 1, title: 'Canción local', artist: 'Artista local', album: 'Álbum local' }],
  activeModule: moduleSource.modules[0],
  searchTracks: async (query) => {
    searchQueries.push(query)
    if (query === 'Error técnico') throw new Error('Fallo simulado del módulo')
    return { tracks: query === 'Pista remota' ? [moduleTrack] : [] }
  },
  resolveTrack: async (track) => ({ ...track, streamUrl: 'https://example.com/audio.flac' }),
})
assert.equal(importResult.attempted, 3)
assert.equal(importResult.resolved, 1)
assert.equal(importResult.notFound, 1)
assert.equal(importResult.failed, 1)
assert.equal(importResult.payload.playlists[0].canciones[0].artista, 'Artista local')
assert.equal(importResult.payload.playlists[0].canciones[1].tipoFuente, '8spine')
assert.equal(importResult.payload.playlists[0].canciones[1].enlace, 'https://example.com/audio.flac')
assert.deepEqual(searchQueries.slice(0, 2), ['Pista remota', 'Error técnico'])

await assert.rejects(
  enrichPlaylistImport({ playlists: [{ canciones: [{ titulo: 'Remota', autor: 'Artista' }] }] }),
  /Activa un módulo 8SPINE/,
)


const storedValues = new Map([
  ['sonora-eightspine-source-v1', JSON.stringify(moduleSource)],
  ['sonora-eightspine-active-v1', JSON.stringify(moduleSource.modules[0])],
])
const previousLocalStorage = globalThis.localStorage
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => storedValues.get(key) || null,
    setItem: (key, value) => storedValues.set(key, value),
    removeItem: (key) => storedValues.delete(key),
  },
})
const removal = removeEightSpineModule('tidal-geolier2')
assert.equal(removal.source, null)
assert.equal(removal.removedActive, true)
assert.equal(storedValues.has('sonora-eightspine-source-v1'), false)
assert.equal(storedValues.has('sonora-eightspine-active-v1'), false)
if (previousLocalStorage === undefined) delete globalThis.localStorage
else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousLocalStorage })

console.log('Fuentes de biblioteca, módulos 8SPINE e importación de playlists verificadas.')
