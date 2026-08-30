import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = process.cwd()
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sonora-smoke-'))
const musicFolder = path.join(temporaryRoot, 'music')
const dataFolder = path.join(temporaryRoot, 'data')
const port = 3199
await fs.mkdir(musicFolder, { recursive: true })

function createWave(frequency = 440, amplitude = 0.2) {
  const sampleRate = 44100
  const seconds = 1
  const sampleCount = sampleRate * seconds
  const dataSize = sampleCount * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin(2 * Math.PI * frequency * index / sampleRate) * amplitude
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * 2)
  }
  return buffer
}

await fs.writeFile(path.join(musicFolder, 'Prueba de sonido.wav'), createWave())
await fs.writeFile(path.join(musicFolder, 'Pulso grave.wav'), createWave(120, 0.32))
await fs.writeFile(path.join(musicFolder, 'Textura aguda.wav'), createWave(1800, 0.12))

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    SONORA_DATA_DIR: dataFolder,
    SONORA_ALLOW_REGISTRATION: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const baseUrl = `http://127.0.0.1:${port}/api`
let sessionCookie = ''

async function request(endpoint, options) {
  const requestHeaders = new Headers(options?.headers || {})
  if (options?.body) requestHeaders.set('Content-Type', 'application/json')
  if (sessionCookie) requestHeaders.set('Cookie', sessionCookie)
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: requestHeaders,
  })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie) sessionCookie = setCookie.split(';')[0]
  const body = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(body?.error || `${response.status} ${endpoint}`)
  return body
}

async function waitUntil(check, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await check()
      if (result) return result
    } catch {
      // El servidor todavía está arrancando.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('La prueba agotó el tiempo de espera.')
}

try {
  await waitUntil(async () => (await request('/health')).ok)
  const network = await request('/system/network')
  assert.equal(network.port, port)
  assert.ok(Array.isArray(network.localUrls))
  assert.ok(Array.isArray(network.vpnUrls))
  const initialAuth = await request('/auth/me')
  assert.equal(initialAuth.hasUsers, false)
  assert.equal(initialAuth.registrationOpen, true)
  const adminLogin = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ displayName: 'Administrador', email: 'admin@sonora.local', password: 'Sonora59!' }),
  })
  assert.equal(adminLogin.user.email, 'admin@sonora.local')
  assert.equal(adminLogin.user.role, 'admin')
  assert.equal((await request('/auth/me')).user.isAdmin, true)
  const listener = await request('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ displayName: 'Cuenta oyente', email: 'oyente@sonora.local', password: 'sonora-test-456' }),
  })
  assert.equal(listener.role, 'listener')
  assert.ok((await request('/admin/users')).some((user) => user.email === 'oyente@sonora.local'))
  await request('/config', {
    method: 'POST',
    body: JSON.stringify({ musicFolder }),
  })
  await waitUntil(async () => {
    const state = await request('/library/scan')
    return !state.running && state.processed === 3
  })

  const tracks = await request('/tracks')
  assert.equal(tracks.length, 3)
  const testTrack = tracks.find((track) => track.title === 'Prueba de sonido')
  assert.equal(testTrack.quality, 'hi-res')
  assert.equal(testTrack.channels, 1)
  assert.ok(testTrack.fileSize > 0)
  assert.ok(testTrack.tokenCost > 0)

  const rangeResponse = await fetch(`http://127.0.0.1:${port}${testTrack.streamUrl}`, {
    headers: { Range: 'bytes=0-99', Cookie: sessionCookie },
  })
  assert.equal(rangeResponse.status, 206)
  assert.equal((await rangeResponse.arrayBuffer()).byteLength, 100)

  const savedLyrics = await request(`/tracks/${testTrack.id}/lyrics`, {
    method: 'PUT',
    body: JSON.stringify({
      sourceName: 'prueba.lrc',
      content: '[00:00.00]Primera línea\n[00:00.50]Segunda línea',
    }),
  })
  assert.equal(savedLyrics.synced, true)
  assert.equal(savedLyrics.format, 'lrc')
  assert.match((await request(`/tracks/${testTrack.id}/lyrics`)).content, /Segunda línea/)

  const savedPlainLyrics = await request(`/tracks/${testTrack.id}/lyrics`, {
    method: 'PUT',
    body: JSON.stringify({
      sourceName: 'pegada.txt',
      format: 'txt',
      content: 'Primera línea sin marcas\nSegunda línea sin marcas',
    }),
  })
  assert.equal(savedPlainLyrics.format, 'txt')
  assert.equal(savedPlainLyrics.synced, false)

  const artistProfile = await request(`/admin/artist-profiles/${encodeURIComponent(testTrack.artist)}`, {
    method: 'PUT',
    body: JSON.stringify({
      birthDate: '1990-04-12',
      origin: 'Madrid, España',
      biography: 'Perfil manual para la prueba de integración.',
      imageUrl: 'https://example.com/artista.jpg',
    }),
  })
  assert.equal(artistProfile.birthDate, '1990-04-12')
  assert.equal(artistProfile.origin, 'Madrid, España')
  assert.ok((await request('/admin/artist-profiles')).some((profile) => profile.name === testTrack.artist))

  await assert.rejects(
    request('/modules/download', {
      method: 'POST',
      body: JSON.stringify({
        streamUrl: 'https://127.0.0.1/audio.flac',
        moduleId: 'smoke-module',
        moduleTrackId: 'private-address',
        title: 'No descargar',
        artist: 'Prueba',
        album: 'SSRF',
      }),
    }),
    /dirección privada/,
  )

  const partialListen = await request('/history', {
    method: 'POST',
    body: JSON.stringify({
      trackId: testTrack.id,
      seconds: testTrack.duration / 2,
      completed: false,
      skipped: true,
      playbackEventId: 'smoke-partial-playback',
    }),
  })
  const expectedPartialCharge = Math.max(0.01, Math.round(testTrack.tokenCost * 0.5 * 100) / 100)
  assert.equal(partialListen.tokenCharge, expectedPartialCharge)
  const partialAccount = await request('/token-account')
  assert.equal(partialAccount.pending.length, 1)
  assert.equal(partialAccount.pricing.currency, 'EUR')
  assert.equal(partialAccount.pricing.euroCentsPer1000Tokens, 1400)

  const completedListen = await request('/history', {
    method: 'POST',
    body: JSON.stringify({
      trackId: testTrack.id,
      seconds: testTrack.duration,
      completed: true,
      playbackEventId: 'smoke-completed-playback',
    }),
  })
  assert.equal(completedListen.tokenCharge, testTrack.tokenCost)
  assert.equal(completedListen.tokenAccount.pending.length, 2)
  assert.equal(completedListen.tokenAccount.pendingTotal, Math.round((testTrack.tokenCost + expectedPartialCharge) * 100) / 100)
  const streamCharge = await request('/token-usage/stream', {
    method: 'POST',
    body: JSON.stringify({
      eventId: 'smoke-module-playback',
      moduleId: 'qobuz-tidal',
      moduleTrackId: 'remote-track-1',
      title: 'Canción remota',
      artist: 'Artista remoto',
      album: 'Álbum remoto',
      artworkUrl: 'https://example.com/cover.jpg',
    }),
  })
  assert.equal(streamCharge.charged, 12.86)
  assert.equal(streamCharge.euroCents, 18)
  assert.equal(streamCharge.account.pricing.moduleStreamEuroCents, 18)
  assert.equal(streamCharge.account.pricing.moduleStreamTokens, 12.86)
  assert.equal(streamCharge.account.pending.find((entry) => entry.isStream).cost, 12.86)
  const duplicateStreamCharge = await request('/token-usage/stream', {
    method: 'POST',
    body: JSON.stringify({ eventId: 'smoke-module-playback', moduleId: 'qobuz-tidal', moduleTrackId: 'remote-track-1' }),
  })
  assert.equal(duplicateStreamCharge.charged, 0)
  const expectedPaymentTotal = Math.round((testTrack.tokenCost + expectedPartialCharge + 12.86) * 100) / 100
  const tokenPayment = await request('/token-account/pay', {
    method: 'POST',
    body: JSON.stringify({ method: 'card', cardNumber: '4242424242424242' }),
  })
  assert.equal(tokenPayment.paid, expectedPaymentTotal)
  assert.equal(tokenPayment.paidAmountCents, Math.round(tokenPayment.paid * 1.4))
  assert.equal(tokenPayment.account.pending.length, 0)
  assert.equal(tokenPayment.account.payments.length, 1)

  const favorite = await request(`/tracks/${testTrack.id}/favorite`, {
    method: 'PATCH',
    body: JSON.stringify({ favorite: true }),
  })
  assert.equal(favorite.favorite, true)

  let analysis
  for (const [index, track] of tracks.entries()) {
    const metrics = {
      version: 2,
      bpm: 138 - index * 24,
      energy: 0.74 - index * 0.2,
      brightness: 0.6 + index * 0.12,
      dynamics: 0.24 + index * 0.05,
      embedding: Array.from({ length: 32 }, (_, vectorIndex) => vectorIndex === index ? 0.94 : 0.01 * ((vectorIndex + index) % 5)),
      segments: [{ position: 0.5, embedding: Array.from({ length: 28 }, () => 0.1), features: { energy: 0.5 } }],
      summary: {
        bpm: 138 - index * 24,
        energy: 0.74 - index * 0.2,
        brightness: 0.6 + index * 0.12,
        dynamics: 0.24 + index * 0.05,
        flatness: 0.2 + index * 0.2,
      },
    }
    const result = await request(`/tracks/${track.id}/analysis`, {
      method: 'POST',
      body: JSON.stringify(metrics),
    })
    if (track.id === testTrack.id) analysis = result
  }
  assert.equal(analysis.mood, 'Gimnasio')
  assert.equal(analysis.profileSaved, true)

  const stats = await request('/stats')
  assert.equal(stats.overview.completedTracks, 1)

  const playlist = await request('/playlists', {
    method: 'POST',
    body: JSON.stringify({ name: 'Prueba' }),
  })
  await request(`/playlists/${playlist.id}/tracks`, {
    method: 'POST',
    body: JSON.stringify({ trackId: testTrack.id }),
  })
  const remotePlaylistTrack = {
    sourceKind: '8spine',
    sourceName: 'Módulo de prueba',
    moduleId: 'smoke-module',
    moduleTrackId: 'remote-playlist-track',
    title: 'Canción enlazada',
    artist: 'Artista remoto',
    album: 'Álbum remoto',
    duration: 193,
    artworkUrl: 'https://example.com/remote-cover.jpg',
    streamUrl: 'https://example.com/remote-track.flac',
  }
  const addedRemote = await request(`/playlists/${playlist.id}/tracks`, {
    method: 'POST',
    body: JSON.stringify({ track: remotePlaylistTrack }),
  })
  assert.equal(addedRemote.added, true)
  assert.equal(addedRemote.track.sourceKind, '8spine')
  assert.equal(addedRemote.track.streamUrl, remotePlaylistTrack.streamUrl)
  const duplicateRemote = await request(`/playlists/${playlist.id}/tracks`, {
    method: 'POST',
    body: JSON.stringify({ track: remotePlaylistTrack }),
  })
  assert.equal(duplicateRemote.added, false)
  const playlistTracks = await request(`/playlists/${playlist.id}/tracks`)
  assert.equal(playlistTracks.length, 2)
  assert.equal((await request('/playlists')).find((item) => item.id === playlist.id).trackCount, 2)
  await request(`/playlists/${playlist.id}/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ entryKeys: [...playlistTracks].reverse().map((track) => track.playlistEntryKey) }),
  })
  assert.equal((await request(`/playlists/${playlist.id}/tracks`))[0].sourceKind, '8spine')
  await assert.rejects(
    request(`/playlists/${playlist.id}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ track: { ...remotePlaylistTrack, moduleTrackId: 'invalid-link', streamUrl: 'file:///privado/audio.flac' } }),
    }),
    /HTTP o HTTPS/,
  )

  const powerStyle = await request('/admin/styles', {
    method: 'POST',
    body: JSON.stringify({ name: 'A tope de power' }),
  })
  assert.equal(powerStyle.name, 'A tope de power')
  assert.equal(powerStyle.custom, true)
  await assert.rejects(
    request('/admin/styles', { method: 'POST', body: JSON.stringify({ name: 'a TOPE de POWER' }) }),
    /ya existe/,
  )
  const styledTrack = await request(`/tracks/${testTrack.id}/style`, {
    method: 'PATCH',
    body: JSON.stringify({ style: powerStyle.name }),
  })
  assert.equal(styledTrack.style, powerStyle.name)
  assert.equal(styledTrack.manual_mood, null)
  assert.equal((await request('/styles')).find((style) => style.name === powerStyle.name).count, 1)

  const catalogExport = await request('/admin/export/catalog')
  assert.equal(catalogExport.formato, 'sonora-catalogo')
  assert.equal(catalogExport.totalCanciones, 3)
  assert.ok(catalogExport.estilosPersonalizados.includes(powerStyle.name))
  assert.equal(catalogExport.canciones.find((track) => track.titulo === testTrack.title).estilo, powerStyle.name)

  const catalogForImport = structuredClone(catalogExport)
  const importedStyleName = 'Noche eléctrica'
  catalogForImport.estilosPersonalizados.push(importedStyleName)
  const catalogTarget = catalogForImport.canciones.find((track) => track.titulo !== testTrack.title)
  catalogTarget.estilo = importedStyleName
  const catalogImport = await request('/admin/import/catalog', {
    method: 'POST',
    body: JSON.stringify(catalogForImport),
  })
  assert.equal(catalogImport.updated, 1)
  assert.equal(catalogImport.missing, 0)
  assert.ok(catalogImport.createdStyles.includes(importedStyleName))
  assert.equal((await request('/tracks')).find((track) => track.title === catalogTarget.titulo).style, importedStyleName)
  const invalidStyleImport = await request('/admin/import/catalog', {
    method: 'POST',
    body: JSON.stringify({
      canciones: [{ titulo: testTrack.title, artista: testTrack.artist, estilo: 'Estilo inexistente' }],
    }),
  })
  assert.equal(invalidStyleImport.updated, 0)
  assert.equal(invalidStyleImport.invalidStyles, 1)
  await assert.rejects(
    request(`/admin/styles/${powerStyle.id}`, { method: 'DELETE' }),
    /mientras lo usen/,
  )

  const playlistsExport = await request('/admin/export/playlists')
  assert.equal(playlistsExport.formato, 'sonora-playlists')
  assert.equal(playlistsExport.version, 2)
  assert.equal(playlistsExport.totalPlaylists, 1)
  assert.equal(playlistsExport.playlists[0].nombre, 'Prueba')
  assert.equal(playlistsExport.playlists[0].canciones.length, 2)
  assert.equal(playlistsExport.playlists[0].canciones.find((track) => track.tipoFuente === '8spine').enlace, remotePlaylistTrack.streamUrl)
  assert.equal(playlistsExport.playlists[0].canciones.find((track) => !track.tipoFuente).artista, testTrack.artist)

  const playlistImport = await request('/admin/import/playlists', {
    method: 'POST',
    body: JSON.stringify(playlistsExport),
  })
  assert.equal(playlistImport.created, 1)
  assert.equal(playlistImport.matched, 2)
  assert.equal(playlistImport.linked, 1)
  assert.equal(playlistImport.missing, 0)
  assert.equal(playlistImport.playlists[0].name, 'Prueba (importada)')
  assert.equal((await request(`/playlists/${playlistImport.playlists[0].id}/tracks`)).length, 2)
  await assert.rejects(
    request('/admin/import/playlists', { method: 'POST', body: JSON.stringify({ canciones: [] }) }),
    /lista de playlists válida/,
  )

  const sameStyleTarget = tracks.find((track) => track.id !== testTrack.id && track.title !== catalogTarget.titulo)
  const importedStyleTarget = tracks.find((track) => track.title === catalogTarget.titulo)
  await request(`/tracks/${sameStyleTarget.id}/style`, {
    method: 'PATCH',
    body: JSON.stringify({ style: powerStyle.name }),
  })

  const priorityRecommendation = await request('/recommendations/session', {
    method: 'POST',
    body: JSON.stringify({
      intent: 'flow',
      length: 2,
      currentTrackId: testTrack.id,
      collectionKey: 'priority:smoke',
    }),
  })
  const sameStyleRecommendation = priorityRecommendation.tracks.find((track) => track.id === sameStyleTarget.id)
  const sameGenreRecommendation = priorityRecommendation.tracks.find((track) => track.id === importedStyleTarget.id)
  assert.equal(priorityRecommendation.tracks[0].id, sameStyleTarget.id)
  assert.equal(sameStyleRecommendation.recommendation.breakdown.metadataTier, 3)
  assert.equal(sameStyleRecommendation.recommendation.breakdown.styleMatch, true)
  assert.equal(sameGenreRecommendation.recommendation.breakdown.metadataTier, 2)
  assert.ok(sameGenreRecommendation.recommendation.breakdown.genreMatch)
  assert.ok(
    sameStyleRecommendation.recommendation.breakdown.metadataPriority
      > sameGenreRecommendation.recommendation.breakdown.metadataPriority,
  )

  const recommendation = await request('/recommendations/session', {
    method: 'POST',
    body: JSON.stringify({ intent: 'discover', length: 3, collectionKey: 'weekly:smoke' }),
  })
  assert.equal(recommendation.algorithm, 'sonora-context-v4')
  assert.equal(recommendation.tracks.length, 3)
  assert.ok(recommendation.tracks[0].recommendation.reasons.length > 0)
  assert.equal(typeof recommendation.tracks[0].recommendation.breakdown.neighborAffinity, 'number')
  assert.equal(typeof recommendation.tracks[0].recommendation.breakdown.artistFatigue, 'number')
  assert.equal(typeof recommendation.tracks[0].recommendation.breakdown.categoryAffinity, 'number')
  assert.equal(typeof recommendation.tracks[0].recommendation.breakdown.metadataPriority, 'number')
  const styleAwareRecommendation = recommendation.tracks.find((track) => track.id === testTrack.id)
  assert.equal(styleAwareRecommendation.recommendation.breakdown.styleName, powerStyle.name)
  assert.ok(styleAwareRecommendation.recommendation.breakdown.categoryConfidence > 0)
  const repeatedWeeklyRecommendation = await request('/recommendations/session', {
    method: 'POST',
    body: JSON.stringify({ intent: 'discover', length: 3, collectionKey: 'weekly:smoke' }),
  })
  assert.deepEqual(
    repeatedWeeklyRecommendation.tracks.map((track) => track.id),
    recommendation.tracks.map((track) => track.id),
  )

  await request('/history', {
    method: 'POST',
    body: JSON.stringify({
      trackId: recommendation.tracks[0].id,
      seconds: 60,
      completed: true,
      moodContext: 'discover',
      sessionId: recommendation.sessionId,
      recommendationRunId: recommendation.runId,
    }),
  })
  const legacyRecommendation = await request('/recommendations/session', {
    method: 'POST',
    body: JSON.stringify({ intent: 'discover', length: 2, algorithm: 'legacy' }),
  })
  assert.equal(legacyRecommendation.algorithm, 'legacy-mood-v1')
  await request('/history', {
    method: 'POST',
    body: JSON.stringify({
      trackId: legacyRecommendation.tracks[0].id,
      seconds: 5,
      skipped: true,
      moodContext: 'discover',
      sessionId: legacyRecommendation.sessionId,
      recommendationRunId: legacyRecommendation.runId,
    }),
  })
  const recommendationStats = await request('/recommendations/metrics')
  assert.equal(recommendationStats.algorithms.find((item) => item.algorithm === 'sonora-context-v4').accepted, 1)
  assert.equal(recommendationStats.algorithms.find((item) => item.algorithm === 'legacy-mood-v1').skipped, 1)
  const adaptedRecommendation = await request('/recommendations/session', {
    method: 'POST',
    body: JSON.stringify({
      intent: 'discover',
      length: 3,
      currentTrackId: recommendation.tracks[0].id,
      recentSkipHint: 2,
    }),
  })
  assert.equal(adaptedRecommendation.exploration, 0.18)

  const shop = await request('/shop')
  assert.equal(shop.length, 9)
  assert.ok(!shop.some((item) => item.slot === 'cursor'))
  assert.ok(!shop.some((item) => item.id === 'icon-pack-imbox'))
  assert.ok(shop.every((item) => item.moneyPriceCents > 0))
  await assert.rejects(
    request('/shop/equip', {
      method: 'PUT',
      body: JSON.stringify({ slot: 'iconPack', itemId: null }),
    }),
    /Ranura de equipamiento no válida/,
  )
  const liquidGlass = shop.find((item) => item.id === 'theme-liquid-glass')
  assert.equal(liquidGlass.moneyPriceCents, 5999)
  assert.equal(liquidGlass.price, 4285)
  assert.equal(liquidGlass.config.theme, 'liquid-glass')
  assert.ok(!shop.some((item) => item.id === 'theme-apple-bento'))

  const musicLink = await request('/admin/custom-links', {
    method: 'POST',
    body: JSON.stringify({ label: 'Prueba favorita', type: 'music', targetId: testTrack.id }),
  })
  assert.match(musicLink.uri, /^sonora:\/\/web\.sonora\.com\/music\/[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}$/)
  assert.equal((await request(`/links/music/${musicLink.code}`)).targetId, String(testTrack.id))

  const productLink = await request('/admin/custom-links', {
    method: 'POST',
    body: JSON.stringify({ label: 'Abrir Liquid Glass', type: 'product', targetId: liquidGlass.id }),
  })
  assert.equal((await request(`/links/product/${productLink.code}`)).targetLabel, 'Liquid Glass')

  const artistLink = await request('/share-links', {
    method: 'POST',
    body: JSON.stringify({ type: 'artist', targetId: testTrack.artist, label: `Perfil de ${testTrack.artist}` }),
  })
  assert.match(artistLink.uri, /^sonora:\/\/web\.sonora\.com\/artist\/[a-f0-9-]+$/)
  const resolvedArtistLink = await request(`/links/artist/${artistLink.code}`)
  assert.equal(resolvedArtistLink.targetData.name, testTrack.artist)
  assert.equal(resolvedArtistLink.targetAvailable, true)
  const repeatedArtistLink = await request('/share-links', {
    method: 'POST',
    body: JSON.stringify({ type: 'artist', targetId: testTrack.artist }),
  })
  assert.equal(repeatedArtistLink.id, artistLink.id)

  const albumTargetId = JSON.stringify({ name: testTrack.album, artist: testTrack.artist, collectionId: '123456' })
  const albumLink = await request('/admin/custom-links', {
    method: 'POST',
    body: JSON.stringify({ label: 'Álbum de prueba', type: 'album', targetId: albumTargetId }),
  })
  const resolvedAlbumLink = await request(`/links/album/${albumLink.code}`)
  assert.deepEqual(resolvedAlbumLink.targetData, { name: testTrack.album, artist: testTrack.artist, collectionId: '123456' })

  const restrictedLink = await request('/admin/custom-links', {
    method: 'POST',
    body: JSON.stringify({ label: 'Panel privado', type: 'section', targetId: 'admin' }),
  })
  const disposableLink = await request('/admin/custom-links', {
    method: 'POST',
    body: JSON.stringify({ label: 'Abrir tienda', type: 'section', targetId: 'shop' }),
  })
  assert.ok((await request('/admin/custom-links')).some((link) => link.id === productLink.id))
  await request(`/admin/custom-links/${disposableLink.id}`, { method: 'DELETE' })
  await assert.rejects(request(`/links/section/${disposableLink.code}`), /no encontrado/)
  assert.equal((await request('/preferences')).unlocks.customization, false)
  await assert.rejects(
    request('/preferences', {
      method: 'PUT',
      body: JSON.stringify({ appearance: { accent: 'coral', surface: 'graphite', density: 'compact' } }),
    }),
    /Estudio de color/,
  )
  const inexpensiveItem = shop.find((item) => item.price <= 120)
  const walletBeforeCheckout = await request('/wallet')
  const checkout = await request('/shop/checkout', {
    method: 'POST',
    body: JSON.stringify({ itemId: inexpensiveItem.id, currency: 'points' }),
  })
  assert.equal(checkout.ok, true)
  assert.equal(checkout.currency, 'points')
  assert.equal(checkout.wallet.points, walletBeforeCheckout.points - inexpensiveItem.price)

  const topUp = await request('/wallet/topup', {
    method: 'POST',
    body: JSON.stringify({ points: 750, method: 'card', cardNumber: '4242424242424242' }),
  })
  assert.equal(topUp.ok, true)
  assert.equal(topUp.wallet.points, checkout.wallet.points + 750)

  const walletBeforeMoneyPurchase = await request('/wallet')
  const customizationPurchase = await request('/shop/checkout', {
    method: 'POST',
    body: JSON.stringify({
      itemId: 'customization-suite',
      currency: 'money',
      method: 'card',
      cardNumber: '4242424242424242',
    }),
  })
  assert.equal(customizationPurchase.unlocked, 'customization-suite')
  assert.equal(customizationPurchase.currency, 'money')
  assert.equal(customizationPurchase.wallet.points, walletBeforeMoneyPurchase.points)

  const soundPurchase = await request('/shop/checkout', {
    method: 'POST',
    body: JSON.stringify({ itemId: 'sound-lab-pro', currency: 'points' }),
  })
  assert.equal(soundPurchase.unlocked, 'sound-lab-pro')
  assert.equal(soundPurchase.wallet.points, walletBeforeMoneyPurchase.points - 240)
  const savedPreferences = await request('/preferences', {
    method: 'PUT',
    body: JSON.stringify({
      appearance: { accent: 'emerald', surface: 'graphite', density: 'compact' },
      audio: { bassBoost: 0.65, compression: true, ambience: 0.3 },
    }),
  })
  assert.equal(savedPreferences.appearance.accent, 'emerald')
  assert.equal(savedPreferences.audio.compression, true)
  const preferences = await request('/preferences')
  assert.equal(preferences.unlocks.customization, true)
  assert.equal(preferences.unlocks.soundLab, true)
  assert.equal(preferences.audio.bassBoost, 0.65)

  const visualizerPurchase = await request('/shop/checkout', {
    method: 'POST',
    body: JSON.stringify({ itemId: 'visualizer-aurora', currency: 'money', method: 'paypal' }),
  })
  assert.equal(visualizerPurchase.wallet.points, soundPurchase.wallet.points)
  const equippedVisualizer = await request('/shop/equip', {
    method: 'PUT',
    body: JSON.stringify({ slot: 'visualizer', itemId: 'visualizer-aurora' }),
  })
  assert.equal(equippedVisualizer.equipped.find((item) => item.slot === 'visualizer').itemId, 'visualizer-aurora')
  const shopAfterEquip = await request('/shop')
  assert.equal(shopAfterEquip.find((item) => item.id === 'visualizer-aurora').equipped, true)
  await assert.rejects(
    request('/shop/equip', {
      method: 'PUT',
      body: JSON.stringify({ slot: 'theme', itemId: 'visualizer-aurora' }),
    }),
    /ranura/,
  )

  const shopHistory = await request('/shop/history')
  assert.ok(shopHistory.some((entry) => entry.type === 'purchase_points' && entry.points < 0))
  assert.ok(shopHistory.some((entry) => entry.type === 'purchase_money' && entry.moneyCents > 0))
  assert.ok(shopHistory.some((entry) => entry.type === 'topup' && entry.points > 0))

  const librarySummary = await request('/library/summary')
  assert.ok(Array.isArray(librarySummary.recentlyPlayed))
  assert.ok(librarySummary.recentlyPlayed.some((track) => track.id === testTrack.id))

  const purchases = await request('/shop/purchases')
  const refundableVisualizer = purchases.find((purchase) => purchase.itemId === 'visualizer-aurora')
  assert.equal(refundableVisualizer.canRefund, true)
  const refund = await request(`/shop/purchases/${refundableVisualizer.id}/refund`, { method: 'POST' })
  assert.equal(refund.ok, true)
  assert.equal(refund.refund.amountCents, refundableVisualizer.moneyPaidCents)
  const shopAfterRefund = await request('/shop')
  assert.equal(shopAfterRefund.find((item) => item.id === 'visualizer-aurora').owned, false)
  assert.equal(shopAfterRefund.find((item) => item.id === 'visualizer-aurora').equipped, false)
  await assert.rejects(
    request(`/shop/purchases/${refundableVisualizer.id}/refund`, { method: 'POST' }),
    /ya se restauró/,
  )

  const account = await request('/account/overview')
  assert.ok(account.counts.listens >= 2)
  assert.ok(account.counts.playlists >= 1)
  assert.ok(account.activities.some((entry) => entry.type === 'purchase_refunded'))
  const profile = await request('/account/profile', {
    method: 'PATCH',
    body: JSON.stringify({ displayName: 'Admin actualizado', email: 'admin@sonora.local' }),
  })
  assert.equal(profile.user.displayName, 'Admin actualizado')

  await request('/auth/logout', { method: 'POST' })
  const listenerLogin = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'oyente@sonora.local', password: 'sonora-test-456' }),
  })
  assert.equal(listenerLogin.user.role, 'listener')
  assert.equal((await request('/playlists')).length, 0)
  assert.equal((await request('/token-account')).pending.length, 0)
  assert.equal((await request(`/tracks/${testTrack.id}/lyrics`)).content, '')
  assert.equal((await request('/shop')).find((item) => item.id === 'theme-liquid-glass').owned, false)
  await assert.rejects(
    request('/admin/export/catalog'),
    /cuenta administradora/,
  )
  await assert.rejects(
    request('/admin/import/catalog', { method: 'POST', body: JSON.stringify({ canciones: [] }) }),
    /administrador/,
  )
  await assert.rejects(
    request('/admin/styles', { method: 'POST', body: JSON.stringify({ name: 'Sin permiso' }) }),
    /administrador/,
  )
  await assert.rejects(request('/admin/custom-links'), /administradora/)
  await assert.rejects(request('/admin/artist-profiles'), /administradora/)
  await assert.rejects(
    request('/admin/custom-links', { method: 'POST', body: JSON.stringify({ label: 'Sin permiso', type: 'section', targetId: 'shop' }) }),
    /administrador/,
  )
  assert.equal((await request(`/links/music/${musicLink.code}`)).targetLabel, testTrack.title)
  assert.equal((await request(`/links/artist/${artistLink.code}`)).targetData.name, testTrack.artist)
  assert.equal((await request('/share-links', {
    method: 'POST',
    body: JSON.stringify({ type: 'album', targetId: albumTargetId }),
  })).id, albumLink.id)
  await assert.rejects(request(`/links/section/${restrictedLink.code}`), /reservado al administrador/)
  await assert.rejects(
    request('/library/scan', { method: 'POST' }),
    /administrador/,
  )
  assert.equal((await request('/tracks')).length, 3)
  await request('/auth/logout', { method: 'POST' })
  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@sonora.local', password: 'Sonora59!' }),
  })
  assert.equal(login.user.displayName, 'Admin actualizado')
  assert.equal((await request('/playlists')).length, 2)

  console.log('Smoke test completo: roles, red, audio, letras, tokens proporcionales, estilos personalizados, enlaces Sonora, catálogo, recomendaciones, tienda, historial y playlists.')
} finally {
  server.kill('SIGTERM')
  await Promise.race([
    once(server, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ])
  await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 })
}
