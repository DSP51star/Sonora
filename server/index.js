import express from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  db,
  MODULE_STREAM_EURO_CENTS,
  MODULE_STREAM_TOKEN_COST,
  rowToTrack,
  tokenCostForTrack,
  tokenPriceCents,
  TOKEN_EURO_CENTS_PER_1000,
} from './db.js'
import {
  AUDIO_EXTENSIONS,
  classifyMood,
  dataDir,
  indexLibraryFile,
  readConfig,
  scanConfiguredLibrary,
  scanLibrary,
  scanState,
  writeConfig,
} from './library.js'
import {
  ANALYSIS_VERSION,
  generateSession,
  recommendationMetrics,
  recordInteraction,
} from './recommender.js'
import {
  appleAlbumMetadata,
  appleArtistMetadata,
  appleMusicSearch,
  downloadModuleAudio,
  lrclibLyrics,
} from './externalServices.js'

const execFileAsync = promisify(execFile)
const app = express()

function envFlag(name, fallback = false) {
  const value = process.env[name]
  if (value == null || value === '') return fallback
  return ['1', 'true', 'yes', 'on', 'si', 'sí'].includes(String(value).trim().toLowerCase())
}

const PORT = Number(process.env.PORT || 3000)
const HOST = String(process.env.HOST || '0.0.0.0').trim()
const PUBLIC_URL = String(process.env.SONORA_PUBLIC_URL || '').trim().replace(/\/$/, '') || null
const TRUST_PROXY = String(process.env.SONORA_TRUST_PROXY || 'loopback').trim()
const ADDITIONAL_REGISTRATION_ENABLED = envFlag('SONORA_ALLOW_REGISTRATION')
const DISCOVER_PUBLIC_IP = envFlag('SONORA_DISCOVER_PUBLIC_IP')
const ALLOW_INSECURE_REMOTE = envFlag('SONORA_ALLOW_INSECURE_REMOTE')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientDist = path.resolve(__dirname, '../client/dist')
const importedDir = path.join(dataDir, 'imported')
const SESSION_COOKIE = 'sonora_session'
const SESSION_DAYS = 30
const DEFAULT_APPEARANCE = { accent: 'olive', surface: 'ink', density: 'comfortable' }
const DEFAULT_AUDIO = { bassBoost: 0, compression: false, ambience: 0 }
const SEED_DEFAULT_ADMIN = envFlag('SONORA_SEED_DEFAULT_ADMIN')
const DEFAULT_ADMIN_EMAIL = String(process.env.SONORA_ADMIN_EMAIL || 'admin@sonora.local').trim().toLowerCase()
const DEFAULT_ADMIN_PASSWORD = String(process.env.SONORA_ADMIN_PASSWORD || 'Sonora59!')
const BUILT_IN_MOODS = ['Gimnasio', 'Relax', 'Focus', 'Fiesta', 'Melancólico', 'Equilibrio']
const MOOD_NAME_MAX_LENGTH = 48
const CUSTOM_LINK_HOST = 'web.sonora.com'
const CUSTOM_LINK_TYPES = new Set(['music', 'product', 'section', 'artist', 'album'])
const CUSTOM_LINK_SECTIONS = new Map([
  ['home', 'Inicio'],
  ['songs', 'Canciones'],
  ['albums', 'Álbumes'],
  ['artists', 'Artistas'],
  ['playlists', 'Playlists'],
  ['genres', 'Géneros'],
  ['stats', 'Tu resumen'],
  ['tokens', 'Consumo'],
  ['shop', 'Tienda'],
  ['account', 'Cuenta'],
  ['admin', 'Administración'],
])
await fsp.mkdir(importedDir, { recursive: true })

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT debe ser un número entre 1 y 65535.')
}

app.disable('x-powered-by')
if (TRUST_PROXY) app.set('trust proxy', TRUST_PROXY === '1' || TRUST_PROXY === 'true' ? 1 : TRUST_PROXY)

app.use((req, res, next) => {
  const isEightSpineWorker = /^\/assets\/eightSpineModuleWorker-[A-Za-z0-9_-]+\.js$/.test(req.path)
  res.set({
    'Content-Security-Policy': isEightSpineWorker
      ? "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src https:; object-src 'none'"
      : "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; connect-src 'self' https:; object-src 'none'",
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  })
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000')
  next()
})

const configuredPublicOrigin = (() => {
  try {
    return PUBLIC_URL ? new URL(PUBLIC_URL).origin : null
  } catch {
    throw new Error('SONORA_PUBLIC_URL debe ser una URL completa, por ejemplo https://musica.ejemplo.com.')
  }
})()
const extraAllowedOrigins = new Set(String(process.env.SONORA_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean))
if (configuredPublicOrigin) extraAllowedOrigins.add(configuredPublicOrigin)

app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const origin = req.get('origin')
  if (!origin) return next()
  try {
    const requestOrigin = new URL(origin)
    if (requestOrigin.host === req.get('host') || extraAllowedOrigins.has(requestOrigin.origin)) return next()
  } catch {
    // Una cabecera Origin inválida se rechaza igual que un origen distinto.
  }
  return res.status(403).json({ error: 'Origen de petición no permitido.' })
})

app.use(express.json({ limit: '2mb' }))

function rateLimit({ windowMs, max, message }) {
  const buckets = new Map()
  return (req, res, next) => {
    const now = Date.now()
    const key = req.ip || req.socket.remoteAddress || 'unknown'
    const current = buckets.get(key)
    const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current
    bucket.count += 1
    buckets.set(key, bucket)
    res.set('RateLimit-Limit', String(max))
    res.set('RateLimit-Remaining', String(Math.max(0, max - bucket.count)))
    res.set('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)))
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)))
      return res.status(429).json({ error: message })
    }
    if (buckets.size > 500) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey)
      }
    }
    return next()
  }
}

const authRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  message: 'Demasiados intentos de acceso. Espera unos minutos antes de volver a intentarlo.',
})
const remoteDownloadRateLimit = rateLimit({
  windowMs: 60_000,
  max: 8,
  message: 'Hay demasiadas descargas en curso. Espera un minuto antes de continuar.',
})
const providerRateLimit = rateLimit({
  windowMs: 60_000,
  max: 50,
  message: 'Hay demasiadas consultas de metadatos. Espera un minuto antes de continuar.',
})

function readPreference(userId, key, fallback) {
  const row = db.prepare('SELECT preference_value FROM user_preferences WHERE user_id = ? AND preference_key = ?').get(userId, key)
  try {
    return row ? JSON.parse(row.preference_value) : fallback
  } catch {
    return fallback
  }
}

function ownsItem(userId, itemId) {
  return Boolean(db.prepare('SELECT 1 FROM purchases WHERE user_id = ? AND item_id = ? AND refunded_at IS NULL').get(userId, itemId))
}

function userPayload(row) {
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role || 'listener',
    isAdmin: row.role === 'admin',
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((part) => {
    const [key, ...value] = part.trim().split('=')
    return [key, decodeURIComponent(value.join('='))]
  }).filter(([key]) => key))
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex')
}

function passwordMatches(password, user) {
  const expected = Buffer.from(user.password_hash, 'hex')
  const actual = Buffer.from(hashPassword(password, user.password_salt), 'hex')
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}

function sessionUser(req) {
  const rawToken = parseCookies(req.headers.cookie)[SESSION_COOKIE]
  if (!rawToken) return null
  const row = db.prepare(`
    SELECT u.*, s.id session_id
    FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
  `).get(hashSessionToken(rawToken))
  if (row) db.prepare('UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.session_id)
  return row || null
}

function issueSession(req, res, userId) {
  const rawToken = crypto.randomBytes(32).toString('base64url')
  db.prepare(`
    INSERT INTO auth_sessions (user_id, token_hash, expires_at)
    VALUES (?, ?, datetime('now', ?))
  `).run(userId, hashSessionToken(rawToken), `+${SESSION_DAYS} days`)
  const secure = req.secure ? '; Secure' : ''
  res.append('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(rawToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`)
}

function clearSession(req, res) {
  const rawToken = parseCookies(req.headers.cookie)[SESSION_COOKIE]
  if (rawToken) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashSessionToken(rawToken))
  const secure = req.secure ? '; Secure' : ''
  res.append('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`)
}

function recordUserActivity(userId, activityType, entityType = null, entityId = null, details = {}) {
  db.prepare(`
    INSERT INTO user_activity (user_id, activity_type, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, activityType, entityType, entityId == null ? null : String(entityId), JSON.stringify(details || {}))
}

function walletForUser(userId) {
  db.prepare('INSERT OR IGNORE INTO user_wallets (user_id, notes, streak) VALUES (?, 120, 1)').run(userId)
  return db.prepare('SELECT notes points, streak, last_active lastActive FROM user_wallets WHERE user_id = ?').get(userId)
}

function claimLegacyData(userId) {
  for (const table of ['playlists', 'listening_history', 'purchases', 'payment_profiles', 'wallet_transactions', 'interaction_events', 'recommendation_runs', 'token_payments', 'token_usage']) {
    db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).run(userId)
  }
  const legacyWallet = db.prepare('SELECT notes, streak, last_active FROM wallet WHERE id = 1').get()
  db.prepare(`
    INSERT OR IGNORE INTO user_wallets (user_id, notes, streak, last_active)
    VALUES (?, ?, ?, ?)
  `).run(userId, legacyWallet?.notes ?? 120, legacyWallet?.streak ?? 1, legacyWallet?.last_active || null)
  db.prepare(`
    INSERT OR IGNORE INTO user_equipped_items (user_id, slot, item_id, updated_at)
    SELECT ?, slot, item_id, updated_at FROM equipped_items
  `).run(userId)
  db.prepare(`
    INSERT OR IGNORE INTO user_preferences (user_id, preference_key, preference_value, updated_at)
    SELECT ?, preference_key, preference_value, updated_at FROM app_preferences
  `).run(userId)
  db.prepare(`
    INSERT OR IGNORE INTO taste_profiles (
      scope, positive_vector, negative_vector, positive_weight, negative_weight, updated_at
    )
    SELECT 'user:' || ? || ':' || scope, positive_vector, negative_vector,
      positive_weight, negative_weight, updated_at
    FROM taste_profiles WHERE scope NOT LIKE 'user:%'
  `).run(userId)
  db.prepare(`
    INSERT OR IGNORE INTO user_track_lyrics (user_id, track_id, source_name, content, synced, updated_at)
    SELECT ?, track_id, source_name, content, synced, updated_at FROM track_lyrics
  `).run(userId)
}

function ensureAdminAccount() {
  const existingAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get()
  if (existingAdmin) return existingAdmin.id
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(DEFAULT_ADMIN_EMAIL)
  if (existing) {
    if (existing.role !== 'admin') db.prepare("UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(existing.id)
    return existing.id
  }

  const salt = crypto.randomBytes(16).toString('hex')
  const existingUsers = db.prepare('SELECT COUNT(*) count FROM users').get().count
  return db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO users (email, display_name, role, password_hash, password_salt)
      VALUES (?, 'Administrador', 'admin', ?, ?)
    `).run(DEFAULT_ADMIN_EMAIL, hashPassword(DEFAULT_ADMIN_PASSWORD, salt), salt)
    const userId = Number(result.lastInsertRowid)
    if (existingUsers === 0) claimLegacyData(userId)
    else walletForUser(userId)
    recordUserActivity(userId, 'admin_account_created', 'user', userId)
    return userId
  })()
}

if (SEED_DEFAULT_ADMIN) ensureAdminAccount()

function paymentSummary(methodValue, cardValue) {
  const method = methodValue === 'paypal' ? 'paypal' : 'card'
  const cardNumber = String(cardValue || '').replace(/\D/g, '')
  const brand = cardNumber.startsWith('4') ? 'Visa' : cardNumber.startsWith('5') ? 'Mastercard' : 'Tarjeta'
  return {
    method,
    brand: method === 'card' ? brand : null,
    last4: method === 'card' ? cardNumber.slice(-4) : null,
  }
}

function tokenAccountPayload(userId) {
  const localPending = db.prepare(`
    SELECT
      u.id,
      u.event_id eventId,
      u.track_id trackId,
      u.cost,
      u.full_cost fullCost,
      u.listened_seconds listenedSeconds,
      u.completion_ratio completionRatio,
      u.file_size fileSize,
      u.duration,
      u.bitrate,
      u.created_at createdAt,
      t.title,
      t.artist,
      t.album,
      t.artwork_path artworkPath,
      t.artwork_url artworkUrl
    FROM token_usage u
    JOIN tracks t ON t.id = u.track_id
    WHERE u.user_id = ? AND u.paid_at IS NULL
    ORDER BY u.created_at DESC, u.id DESC
  `).all(userId).map((row) => ({
    ...row,
    artworkUrl: row.artworkPath ? `/api/tracks/${row.trackId}/artwork` : row.artworkUrl || null,
  }))
  const streamPending = db.prepare(`
    SELECT
      'stream-' || id id,
      event_id eventId,
      '8spine:' || module_id || ':' || module_track_id trackId,
      cost,
      cost fullCost,
      0 listenedSeconds,
      1 completionRatio,
      0 fileSize,
      0 duration,
      0 bitrate,
      created_at createdAt,
      title,
      artist,
      album,
      artwork_url artworkUrl,
      module_id moduleId,
      1 isStream
    FROM stream_token_usage
    WHERE user_id = ? AND paid_at IS NULL
    ORDER BY created_at DESC, id DESC
  `).all(userId)
  const pending = [...localPending, ...streamPending]
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
  const payments = db.prepare(`
    SELECT
      id,
      amount_tokens amount,
      amount_cents amountCents,
      method,
      brand,
      last4,
      created_at createdAt
    FROM token_payments
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 30
  `).all(userId).map((payment) => ({
    ...payment,
    amountCents: payment.amountCents || tokenPriceCents(payment.amount),
  }))
  const pendingTotal = Math.round(pending.reduce((sum, item) => sum + Number(item.cost || 0), 0) * 100) / 100
  pending.forEach((item) => { item.amountCents = tokenPriceCents(item.cost) })
  return {
    pending,
    pendingTotal,
    pendingAmountCents: tokenPriceCents(pendingTotal),
    payments,
    pricing: {
      currency: 'EUR',
      euroCentsPer1000Tokens: TOKEN_EURO_CENTS_PER_1000,
      moduleStreamEuroCents: MODULE_STREAM_EURO_CENTS,
      moduleStreamTokens: MODULE_STREAM_TOKEN_COST,
    },
  }
}

function addTokenUsage(userId, track, rawEventId, listenedSeconds, completed = false) {
  const eventId = String(rawEventId || '').trim().slice(0, 120)
  if (!track || !eventId) return 0
  let fileSize = 0
  try {
    fileSize = fs.statSync(track.path).size
  } catch {
    // El coste puede seguir calculándose con duración y bitrate si el archivo se ha movido.
  }
  const duration = Number(track.duration || 0)
  const seconds = Math.max(0, Math.min(duration || Number(listenedSeconds || 0), Number(listenedSeconds || 0)))
  const completionRatio = completed ? 1 : duration > 0 ? Math.max(0, Math.min(1, seconds / duration)) : 0
  const fullCost = tokenCostForTrack({ ...track, file_size: fileSize })
  const cost = completionRatio > 0 ? Math.max(0.01, Math.round(fullCost * completionRatio * 100) / 100) : 0
  if (!cost) return 0
  const result = db.prepare(`
    INSERT OR IGNORE INTO token_usage (
      event_id, user_id, track_id, cost, full_cost, listened_seconds, completion_ratio,
      file_size, duration, bitrate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(eventId, userId, track.id, cost, fullCost, completed ? duration : seconds, completionRatio, fileSize, duration, Number(track.bitrate || 0))
  return result.changes ? cost : 0
}

function addStreamTokenUsage(userId, payload) {
  const eventId = String(payload.eventId || '').trim().slice(0, 120)
  const moduleId = String(payload.moduleId || '').trim().slice(0, 180)
  const moduleTrackId = String(payload.moduleTrackId || '').trim().slice(0, 240)
  if (!eventId || !moduleId || !moduleTrackId) return 0
  const result = db.prepare(`
    INSERT OR IGNORE INTO stream_token_usage (
      event_id, user_id, module_id, module_track_id, title, artist, album, artwork_url, cost
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    userId,
    moduleId,
    moduleTrackId,
    String(payload.title || 'Pista sin título').trim().slice(0, 240),
    String(payload.artist || 'Artista desconocido').trim().slice(0, 240),
    String(payload.album || 'Álbum desconocido').trim().slice(0, 240),
    /^https:\/\//i.test(String(payload.artworkUrl || '')) ? String(payload.artworkUrl).slice(0, 1600) : null,
    MODULE_STREAM_TOKEN_COST,
  )
  return result.changes ? MODULE_STREAM_TOKEN_COST : 0
}

function parseShopConfig(value) {
  try {
    return value ? JSON.parse(value) : {}
  } catch {
    return {}
  }
}

function shopItemPayload(row) {
  if (!row) return null
  return {
    ...row,
    owned: Boolean(row.owned),
    equipped: Boolean(row.equipped),
    moneyPriceCents: row.money_price_cents,
    config: parseShopConfig(row.config_json),
  }
}

function customLinkTarget(type, targetId) {
  if (type === 'music') {
    const track = db.prepare('SELECT id, title, artist FROM tracks WHERE id = ?').get(targetId)
    return track ? { id: String(track.id), label: track.title, detail: track.artist } : null
  }
  if (type === 'product') {
    const item = db.prepare('SELECT id, name, category FROM shop_items WHERE id = ? AND active = 1').get(targetId)
    return item ? { id: item.id, label: item.name, detail: item.category } : null
  }
  if (type === 'section' && CUSTOM_LINK_SECTIONS.has(targetId)) {
    return { id: targetId, label: CUSTOM_LINK_SECTIONS.get(targetId), detail: 'Apartado de Sonora' }
  }
  if (type === 'artist') {
    const name = String(targetId || '').replace(/\s+/g, ' ').trim().slice(0, 180)
    return name ? { id: name, label: name, detail: 'Perfil de artista', data: { name } } : null
  }
  if (type === 'album') {
    try {
      const source = JSON.parse(String(targetId || ''))
      const name = String(source?.name || source?.album || '').replace(/\s+/g, ' ').trim().slice(0, 240)
      const artist = String(source?.artist || '').replace(/\s+/g, ' ').trim().slice(0, 180)
      const collectionId = String(source?.collectionId || '').replace(/\D/g, '').slice(0, 24) || null
      if (!name || !artist) return null
      const data = { name, artist, collectionId }
      return { id: JSON.stringify(data), label: name, detail: artist, data }
    } catch {
      return null
    }
  }
  return null
}

function customLinkPayload(row) {
  const target = customLinkTarget(row.target_type, row.target_id)
  return {
    id: row.id,
    label: row.label,
    type: row.target_type,
    targetId: row.target_id,
    targetLabel: target?.label || 'Destino no disponible',
    targetDetail: target?.detail || '',
    targetData: target?.data || null,
    targetAvailable: Boolean(target),
    uri: `sonora://${CUSTOM_LINK_HOST}/${row.target_type}/${row.code}`,
    code: row.code,
    createdAt: row.created_at,
  }
}

function createCustomLinkCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const value = crypto.randomBytes(6).toString('hex')
    const code = `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`
    if (!db.prepare('SELECT 1 FROM custom_links WHERE code = ?').get(code)) return code
  }
  throw new Error('No se pudo generar un código de enlace único.')
}

function equippedItems(userId) {
  return db.prepare(`
    SELECT e.slot, e.item_id itemId, s.name, s.config_json
    FROM user_equipped_items e JOIN shop_items s ON s.id = e.item_id
    WHERE e.user_id = ? AND s.active = 1
    ORDER BY e.slot
  `).all(userId).map((row) => ({
    ...row,
    config: parseShopConfig(row.config_json),
  }))
}

const upload = multer({
  dest: importedDir,
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    callback(null, AUDIO_EXTENSIONS.has(path.extname(file.originalname).toLowerCase()))
  },
})

let publicIpCache = { value: null, checkedAt: 0 }

async function publicIpAddress() {
  if (process.env.SONORA_PUBLIC_IP) return process.env.SONORA_PUBLIC_IP
  if (!DISCOVER_PUBLIC_IP) return null
  if (Date.now() - publicIpCache.checkedAt < 15 * 60_000) return publicIpCache.value
  try {
    const response = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(1800) })
    const payload = await response.json()
    publicIpCache = { value: String(payload.ip || '') || null, checkedAt: Date.now() }
  } catch {
    publicIpCache = { value: null, checkedAt: Date.now() }
  }
  return publicIpCache.value
}

function ipv4Parts(address) {
  const parts = String(address).split('.').map(Number)
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null
}

function isPrivateIpv4(address) {
  const parts = ipv4Parts(address)
  if (!parts) return false
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
}

function isCarrierGradeNat(address) {
  const parts = ipv4Parts(address)
  return Boolean(parts && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
}

function networkAddresses() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, entries]) => (entries || []).filter((entry) => (
    entry && (entry.family === 'IPv4' || entry.family === 4) && !entry.internal
  )).map((entry) => ({ name, address: entry.address })))
}

async function networkPayload() {
  const addresses = networkAddresses()
  const vpnPattern = /tailscale|zerotier|wireguard|hamachi|vpn/i
  const virtualPattern = /vethernet|virtualbox|vmware|docker|wsl/i
  const vpnAddresses = addresses.filter(({ name, address }) => vpnPattern.test(name) || isCarrierGradeNat(address))
  let localAddresses = addresses.filter(({ name, address }) => isPrivateIpv4(address) && !vpnPattern.test(name) && !virtualPattern.test(name))
  if (!localAddresses.length) localAddresses = addresses.filter(({ address }) => isPrivateIpv4(address))
  const urlFor = ({ address }) => `http://${address}:${PORT}`
  const localUrls = [...new Set(localAddresses.map(urlFor))]
  const vpnUrls = [...new Set(vpnAddresses.map(urlFor))]
  const publicIp = await publicIpAddress()
  return {
    hostname: os.hostname(),
    host: HOST,
    port: PORT,
    localUrls,
    vpnUrls,
    publicIp,
    remoteUrl: PUBLIC_URL || (ALLOW_INSECURE_REMOTE && publicIp ? `http://${publicIp}:${PORT}` : null),
    remoteConfigured: Boolean(PUBLIC_URL),
    remoteRequiresRouter: !PUBLIC_URL,
    insecureRemoteEnabled: ALLOW_INSECURE_REMOTE,
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.get('/api/system/network', async (_req, res) => res.json(await networkPayload()))

app.get('/api/auth/me', (req, res) => {
  const user = sessionUser(req)
  const hasUsers = db.prepare('SELECT EXISTS(SELECT 1 FROM users) value').get().value === 1
  res.json({ user: userPayload(user), hasUsers, registrationOpen: !hasUsers || ADDITIONAL_REGISTRATION_ENABLED })
})

app.post('/api/auth/register', authRateLimit, (req, res) => {
  const displayName = String(req.body.displayName || '').trim().slice(0, 80)
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 180)
  const password = String(req.body.password || '')
  const existingUsers = db.prepare('SELECT COUNT(*) count FROM users').get().count
  if (existingUsers > 0 && !ADDITIONAL_REGISTRATION_ENABLED) {
    return res.status(403).json({ error: 'El registro de cuentas nuevas está cerrado en este servidor.' })
  }
  if (displayName.length < 2) return res.status(400).json({ error: 'Escribe un nombre de al menos 2 caracteres.' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Escribe un correo válido.' })
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' })
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' })

  const firstUser = existingUsers === 0
  const salt = crypto.randomBytes(16).toString('hex')
  const userId = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO users (email, display_name, role, password_hash, password_salt, last_login_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(email, displayName, firstUser ? 'admin' : 'listener', hashPassword(password, salt), salt)
    const id = Number(result.lastInsertRowid)
    if (firstUser) claimLegacyData(id)
    else walletForUser(id)
    recordUserActivity(id, 'account_registered', 'user', id)
    return id
  })()
  issueSession(req, res, userId)
  res.status(201).json({
    user: userPayload(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)),
    registrationOpen: ADDITIONAL_REGISTRATION_ENABLED,
  })
})

app.post('/api/auth/login', authRateLimit, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase()
  const password = String(req.body.password || '')
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user || !passwordMatches(password, user)) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' })
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id)
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= CURRENT_TIMESTAMP').run()
  issueSession(req, res, user.id)
  recordUserActivity(user.id, 'session_started', 'user', user.id)
  res.json({ user: userPayload(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) })
})

app.post('/api/auth/logout', (req, res) => {
  const user = sessionUser(req)
  if (user) recordUserActivity(user.id, 'session_ended', 'user', user.id)
  clearSession(req, res)
  res.status(204).end()
})

app.use('/api', (req, res, next) => {
  const user = sessionUser(req)
  if (!user) return res.status(401).json({ error: 'Inicia sesión para continuar.', code: 'AUTH_REQUIRED' })
  req.user = userPayload(user)
  next()
})

const listenerMutations = [
  ['POST', /^\/history$/],
  ['POST', /^\/interactions$/],
  ['POST', /^\/recommendations\/session$/],
  ['POST', /^\/token-usage$/],
  ['POST', /^\/token-usage\/stream$/],
  ['POST', /^\/share-links$/],
  ['POST', /^\/token-account\/pay$/],
  ['POST', /^\/wallet\/topup$/],
  ['PUT', /^\/preferences$/],
  ['POST', /^\/shop\/checkout$/],
  ['PUT', /^\/shop\/equip$/],
  ['POST', /^\/shop\/purchases\/\d+\/refund$/],
]

app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.user.role === 'admin') return next()
  if (listenerMutations.some(([method, pattern]) => method === req.method && pattern.test(req.path))) return next()
  return res.status(403).json({
    error: 'Tu cuenta es de oyente. Solo el administrador puede modificar la biblioteca.',
    code: 'ADMIN_REQUIRED',
  })
})

app.get('/api/admin/users', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Se necesita una cuenta administradora.' })
  const users = db.prepare(`
    SELECT
      u.id,
      u.email,
      u.display_name displayName,
      u.role,
      u.created_at createdAt,
      u.last_login_at lastLoginAt,
      COUNT(DISTINCT h.id) listens,
      COUNT(DISTINCT p.id) purchases
    FROM users u
    LEFT JOIN listening_history h ON h.user_id = u.id
    LEFT JOIN purchases p ON p.user_id = u.id AND p.refunded_at IS NULL
    GROUP BY u.id
    ORDER BY CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END, u.created_at
  `).all()
  res.json(users)
})

app.post('/api/admin/users', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Se necesita una cuenta administradora.' })
  const displayName = String(req.body.displayName || '').trim().slice(0, 80)
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 180)
  const password = String(req.body.password || '')
  if (displayName.length < 2) return res.status(400).json({ error: 'Escribe un nombre de al menos 2 caracteres.' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Escribe un correo válido.' })
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' })
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' })
  const salt = crypto.randomBytes(16).toString('hex')
  const result = db.prepare(`
    INSERT INTO users (email, display_name, role, password_hash, password_salt)
    VALUES (?, ?, 'listener', ?, ?)
  `).run(email, displayName, hashPassword(password, salt), salt)
  const userId = Number(result.lastInsertRowid)
  walletForUser(userId)
  recordUserActivity(req.user.id, 'listener_account_created', 'user', userId, { email })
  res.status(201).json(userPayload(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)))
})

app.delete('/api/admin/users/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Se necesita una cuenta administradora.' })
  const targetId = Number(req.params.id)
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId)
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' })
  if (target.id === req.user.id || target.role === 'admin') return res.status(400).json({ error: 'La cuenta administradora principal no se puede eliminar.' })
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId)
  recordUserActivity(req.user.id, 'listener_account_deleted', 'user', targetId, { email: target.email })
  res.status(204).end()
})

app.get('/api/admin/custom-links', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Se necesita una cuenta administradora.' })
  const links = db.prepare(`
    SELECT id, code, label, target_type, target_id, created_at
    FROM custom_links
    ORDER BY created_at DESC, id DESC
  `).all().map(customLinkPayload)
  res.json(links)
})

app.post('/api/admin/custom-links', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Se necesita una cuenta administradora.' })
  const label = String(req.body.label || '').trim().slice(0, 80)
  const type = String(req.body.type || '').trim().toLowerCase()
  const targetId = String(req.body.targetId ?? '').trim()
  if (label.length < 2) return res.status(400).json({ error: 'Escribe un nombre de al menos 2 caracteres para el enlace.' })
  if (!CUSTOM_LINK_TYPES.has(type)) return res.status(400).json({ error: 'El tipo de destino no es válido.' })
  const target = customLinkTarget(type, targetId)
  if (!target) return res.status(404).json({ error: 'El destino seleccionado ya no está disponible.' })

  const code = createCustomLinkCode()
  const result = db.prepare(`
    INSERT INTO custom_links (code, label, target_type, target_id, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(code, label, type, target.id, req.user.id)
  const link = db.prepare(`
    SELECT id, code, label, target_type, target_id, created_at
    FROM custom_links WHERE id = ?
  `).get(result.lastInsertRowid)
  recordUserActivity(req.user.id, 'custom_link_created', 'custom_link', result.lastInsertRowid, {
    type,
    targetId: target.id,
  })
  res.status(201).json(customLinkPayload(link))
})

app.post('/api/share-links', (req, res) => {
  const type = String(req.body.type || '').trim().toLowerCase()
  if (!['artist', 'album'].includes(type)) return res.status(400).json({ error: 'Solo se pueden compartir artistas o álbumes desde esta vista.' })
  const targetId = String(req.body.targetId ?? '').trim()
  const target = customLinkTarget(type, targetId)
  if (!target) return res.status(400).json({ error: 'No se ha podido identificar el destino que quieres compartir.' })
  const existing = db.prepare(`
    SELECT id, code, label, target_type, target_id, created_at
    FROM custom_links WHERE target_type = ? AND target_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(type, target.id)
  if (existing) return res.json(customLinkPayload(existing))

  const requestedLabel = String(req.body.label || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  const label = requestedLabel || (type === 'artist' ? `Perfil de ${target.label}` : `${target.label} · ${target.detail}`)
  const code = createCustomLinkCode()
  const result = db.prepare(`
    INSERT INTO custom_links (code, label, target_type, target_id, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(code, label, type, target.id, req.user.id)
  const link = db.prepare(`
    SELECT id, code, label, target_type, target_id, created_at
    FROM custom_links WHERE id = ?
  `).get(result.lastInsertRowid)
  recordUserActivity(req.user.id, 'share_link_created', type, target.id, { code })
  res.status(201).json(customLinkPayload(link))
})

app.delete('/api/admin/custom-links/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Se necesita una cuenta administradora.' })
  const link = db.prepare('SELECT * FROM custom_links WHERE id = ?').get(req.params.id)
  if (!link) return res.status(404).json({ error: 'Enlace no encontrado.' })
  db.prepare('DELETE FROM custom_links WHERE id = ?').run(link.id)
  recordUserActivity(req.user.id, 'custom_link_deleted', 'custom_link', link.id, {
    type: link.target_type,
    targetId: link.target_id,
  })
  res.status(204).end()
})

function artistProfilePayload(row) {
  if (!row) return null
  return {
    name: row.name,
    birthDate: row.birth_date || null,
    origin: row.origin || null,
    biography: row.biography || null,
    imageUrl: row.image_url || null,
    updatedAt: row.updated_at || null,
  }
}

app.get('/api/admin/artist-profiles', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Se necesita una cuenta administradora.' })
  const rows = db.prepare(`
    SELECT name, birth_date, origin, biography, image_url, updated_at
    FROM artist_profiles ORDER BY name COLLATE NOCASE
  `).all()
  res.json(rows.map(artistProfilePayload))
})

app.put('/api/admin/artist-profiles/:name', (req, res) => {
  const name = String(req.params.name || '').replace(/\s+/g, ' ').trim().slice(0, 180)
  if (!name) return res.status(400).json({ error: 'Escribe el nombre del artista.' })
  const birthDate = String(req.body.birthDate || '').trim()
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return res.status(400).json({ error: 'La fecha debe usar el formato AAAA-MM-DD.' })
  const imageUrl = String(req.body.imageUrl || '').trim().slice(0, 1600)
  if (imageUrl && !/^https:\/\//i.test(imageUrl)) return res.status(400).json({ error: 'La imagen del artista debe usar HTTPS.' })
  const origin = String(req.body.origin || '').replace(/\s+/g, ' ').trim().slice(0, 180)
  const biography = String(req.body.biography || '').replace(/\r\n?/g, '\n').trim().slice(0, 6000)
  db.prepare(`
    INSERT INTO artist_profiles (name, birth_date, origin, biography, image_url, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      birth_date = excluded.birth_date,
      origin = excluded.origin,
      biography = excluded.biography,
      image_url = excluded.image_url,
      updated_by = excluded.updated_by,
      updated_at = CURRENT_TIMESTAMP
  `).run(name, birthDate || null, origin || null, biography || null, imageUrl || null, req.user.id)
  recordUserActivity(req.user.id, 'artist_profile_saved', 'artist', name)
  res.json(artistProfilePayload(db.prepare('SELECT * FROM artist_profiles WHERE name = ?').get(name)))
})

app.delete('/api/admin/artist-profiles/:name', (req, res) => {
  const result = db.prepare('DELETE FROM artist_profiles WHERE name = ?').run(req.params.name)
  if (!result.changes) return res.status(404).json({ error: 'Perfil de artista no encontrado.' })
  recordUserActivity(req.user.id, 'artist_profile_deleted', 'artist', req.params.name)
  res.status(204).end()
})

app.get('/api/artists/profile', providerRateLimit, async (req, res) => {
  const requestedName = String(req.query.name || '').replace(/\s+/g, ' ').trim().slice(0, 180)
  if (!requestedName) return res.status(400).json({ error: 'Falta el nombre del artista.' })
  const manual = artistProfilePayload(db.prepare(`
    SELECT name, birth_date, origin, biography, image_url, updated_at
    FROM artist_profiles WHERE name = ? COLLATE NOCASE
  `).get(requestedName))
  const local = db.prepare(`
    SELECT
      COUNT(*) trackCount,
      COUNT(DISTINCT album) albumCount,
      COALESCE(SUM(play_count), 0) playCount,
      MAX(artwork_url) artworkUrl
    FROM tracks WHERE artist = ? COLLATE NOCASE
  `).get(requestedName)
  const localAlbums = db.prepare(`
    SELECT album name, artist, MAX(year) year, MAX(artwork_url) artworkUrl, COUNT(*) trackCount
    FROM tracks WHERE artist = ? COLLATE NOCASE
    GROUP BY album, artist ORDER BY MAX(added_at) DESC LIMIT 16
  `).all(requestedName)
  let apple = null
  try {
    apple = await appleArtistMetadata(requestedName)
  } catch (error) {
    console.warn(`Apple Music no pudo completar el perfil de ${requestedName}:`, error.message)
  }
  const albumKeys = new Set()
  const albums = [...localAlbums, ...(apple?.albums || [])].filter((album) => {
    const key = `${album.artist || requestedName}\u0000${album.name || ''}`.toLocaleLowerCase('es')
    if (!album.name || albumKeys.has(key)) return false
    albumKeys.add(key)
    return true
  }).slice(0, 16)
  res.json({
    name: manual?.name || apple?.name || requestedName,
    birthDate: manual?.birthDate || null,
    origin: manual?.origin || null,
    biography: manual?.biography || null,
    imageUrl: manual?.imageUrl || apple?.artworkUrl || local?.artworkUrl || null,
    genres: apple?.genres || [],
    albums,
    trackCount: Number(local?.trackCount || 0),
    albumCount: Math.max(Number(local?.albumCount || 0), albums.length),
    playCount: Number(local?.playCount || 0),
    metadataProvider: apple ? 'Apple Music España' : null,
    manuallyEdited: Boolean(manual),
  })
})

app.get('/api/links/:type/:code', (req, res) => {
  const type = String(req.params.type || '').toLowerCase()
  const code = String(req.params.code || '').toLowerCase()
  if (!CUSTOM_LINK_TYPES.has(type)) return res.status(404).json({ error: 'Enlace Sonora no encontrado.' })
  const row = db.prepare(`
    SELECT id, code, label, target_type, target_id, created_at
    FROM custom_links WHERE code = ? AND target_type = ?
  `).get(code, type)
  if (!row) return res.status(404).json({ error: 'Enlace Sonora no encontrado.' })
  const payload = customLinkPayload(row)
  if (!payload.targetAvailable) return res.status(410).json({ error: 'El destino de este enlace ya no está disponible.' })
  if (payload.type === 'section' && ['admin', 'playlists'].includes(payload.targetId) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Este enlace abre un apartado reservado al administrador.' })
  }
  res.json(payload)
})

function cleanMoodName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function moodKey(value) {
  return cleanMoodName(value).toLocaleLowerCase('es')
}

function moodCatalogRows() {
  const counts = db.prepare(`
    SELECT COALESCE(manual_mood, auto_mood, 'Sin analizar') mood, COUNT(*) count
    FROM tracks GROUP BY mood
  `).all()
  const countMap = new Map(counts.map((row) => [moodKey(row.mood), Number(row.count || 0)]))
  return BUILT_IN_MOODS.map((name) => ({
    id: null,
    name,
    count: countMap.get(moodKey(name)) || 0,
    custom: false,
    createdAt: null,
  }))
}

function resolveAvailableMood(value) {
  const key = moodKey(value)
  if (!key) return null
  return BUILT_IN_MOODS.find((name) => moodKey(name) === key) || undefined
}

function customStyleNames() {
  return db.prepare('SELECT name FROM custom_styles ORDER BY name COLLATE NOCASE').all().map((row) => row.name)
}

function resolveAvailableStyle(value) {
  const key = moodKey(value)
  if (!key) return null
  return customStyleNames().find((name) => moodKey(name) === key) || undefined
}

function styleCatalogRows() {
  const counts = db.prepare(`SELECT style, COUNT(*) count FROM tracks WHERE style IS NOT NULL GROUP BY style`).all()
  const countMap = new Map(counts.map((row) => [moodKey(row.style), Number(row.count || 0)]))
  return db.prepare('SELECT id, name, created_at createdAt FROM custom_styles ORDER BY name COLLATE NOCASE').all().map((row) => ({
    ...row,
    count: countMap.get(moodKey(row.name)) || 0,
    custom: true,
  }))
}

function validateCustomStyleName(value) {
  const name = cleanMoodName(value)
  if (name.length < 2) throw new Error('El estilo debe tener al menos 2 caracteres.')
  if (name.length > MOOD_NAME_MAX_LENGTH) throw new Error(`El estilo no puede superar ${MOOD_NAME_MAX_LENGTH} caracteres.`)
  if ([...name].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })) throw new Error('El nombre del estilo contiene caracteres no permitidos.')
  return name
}

function portableTrack(row) {
  return {
    titulo: row.title,
    artista: row.artist,
    album: row.album,
    genero: row.genre || null,
    estilo: row.style || null,
    ambiente: row.manual_mood || row.auto_mood || 'Sin analizar',
    ambienteManual: row.manual_mood || null,
    ambienteAutomatico: row.auto_mood || null,
    duracionSegundos: Math.round(Number(row.duration || 0) * 100) / 100,
  }
}

function portableExternalTrack(row) {
  return {
    titulo: row.title,
    artista: row.artist,
    album: row.album,
    genero: row.genre || 'Streaming',
    duracionSegundos: Math.round(Number(row.duration || 0) * 100) / 100,
    tipoFuente: row.source_kind,
    fuente: row.source_name,
    moduloId: row.module_id,
    cancionModuloId: row.module_track_id,
    enlace: row.stream_url,
    caratula: row.artwork_url || null,
    formato: row.codec || row.container || null,
    calidad: row.quality || null,
  }
}

function portablePlaylistTracks(playlistId) {
  const localTracks = db.prepare(`
    SELECT t.*, pt.position
    FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
    WHERE pt.playlist_id = ?
  `).all(playlistId).map((row) => ({ position: row.position, track: portableTrack(row) }))
  const externalTracks = db.prepare(`
    SELECT * FROM playlist_external_tracks WHERE playlist_id = ?
  `).all(playlistId).map((row) => ({ position: row.position, track: portableExternalTrack(row) }))
  return [...localTracks, ...externalTracks]
    .sort((left, right) => left.position - right.position)
    .map((entry) => entry.track)
}

function portableText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function portableTrackKey(title, artist, album = '') {
  return [title, artist, album].map(portableText).join('\u0000')
}

function importedPlaylistName(rawName, usedNames) {
  const base = String(rawName || '').trim().slice(0, 120) || 'Playlist importada'
  let candidate = base
  let suffix = 1
  while (usedNames.has(portableText(candidate))) {
    suffix += 1
    const label = suffix === 2 ? ' (importada)' : ` (importada ${suffix - 1})`
    candidate = `${base.slice(0, Math.max(1, 120 - label.length))}${label}`
  }
  usedNames.add(portableText(candidate))
  return candidate
}

function libraryTrackMatcher(libraryTracks) {
  const exactMatches = new Map()
  const looseMatches = new Map()
  for (const track of libraryTracks) {
    const exactKey = portableTrackKey(track.title, track.artist, track.album)
    const looseKey = portableTrackKey(track.title, track.artist)
    exactMatches.set(exactKey, [...(exactMatches.get(exactKey) || []), track])
    looseMatches.set(looseKey, [...(looseMatches.get(looseKey) || []), track])
  }
  return (reference) => {
    const title = reference?.titulo ?? reference?.title
    const artist = reference?.artista ?? reference?.artist ?? reference?.autor ?? reference?.author
    const album = reference?.album
    if (!portableText(title) || !portableText(artist)) return null
    const exact = exactMatches.get(portableTrackKey(title, artist, album)) || []
    const candidates = exact.length ? exact : (looseMatches.get(portableTrackKey(title, artist)) || [])
    if (!candidates.length) return null
    const duration = Number(reference?.duracionSegundos ?? reference?.duration)
    if (!Number.isFinite(duration) || candidates.length === 1) return candidates[0]
    return [...candidates].sort((a, b) => Math.abs(Number(a.duration || 0) - duration) - Math.abs(Number(b.duration || 0) - duration))[0]
  }
}

app.get('/api/admin/export/catalog', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Se necesita una cuenta administradora.' })
  const songs = db.prepare(`
    SELECT title, artist, album, genre, style, duration, manual_mood, auto_mood
    FROM tracks
    ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, title COLLATE NOCASE
  `).all().map(portableTrack)
  res.json({
    formato: 'sonora-catalogo',
    version: 1,
    fechaExportacion: new Date().toISOString(),
    totalCanciones: songs.length,
    estilosPersonalizados: customStyleNames(),
    instrucciones: 'Edita solo el campo "estilo". Usa null para restaurar el estilo automático.',
    canciones: songs,
  })
})

app.get('/api/admin/export/playlists', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Se necesita una cuenta administradora.' })
  const playlists = db.prepare(`
    SELECT id, name FROM playlists WHERE user_id = ? ORDER BY created_at, id
  `).all(req.user.id).map((playlist) => ({
    nombre: playlist.name,
    canciones: portablePlaylistTracks(playlist.id),
  }))
  res.json({
    formato: 'sonora-playlists',
    version: 2,
    fechaExportacion: new Date().toISOString(),
    usuario: req.user.displayName,
    totalPlaylists: playlists.length,
    playlists,
  })
})

app.post('/api/admin/import/playlists', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Se necesita una cuenta administradora.' })
  const importedPlaylists = Array.isArray(req.body?.playlists) ? req.body.playlists : null
  if (!importedPlaylists) return res.status(400).json({ error: 'El archivo no contiene una lista de playlists válida.' })
  if (importedPlaylists.length > 200) return res.status(400).json({ error: 'El archivo supera el límite de 200 playlists.' })

  const libraryTracks = db.prepare(`
    SELECT id, title, artist, album, genre, style, duration, manual_mood, auto_mood FROM tracks
  `).all()
  const matchTrack = libraryTrackMatcher(libraryTracks)

  const usedNames = new Set(db.prepare('SELECT name FROM playlists WHERE user_id = ?').all(req.user.id).map((row) => portableText(row.name)))
  const insertPlaylist = db.prepare('INSERT INTO playlists (user_id, name) VALUES (?, ?)')
  const insertTrack = db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)')
  const insertExternalTrack = db.prepare(`
    INSERT OR IGNORE INTO playlist_external_tracks (
      playlist_id, source_key, source_kind, source_name, module_id, module_track_id,
      title, artist, album, genre, duration, codec, container, quality,
      artwork_url, stream_url, position
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const missingExamples = []
  const summary = { created: 0, matched: 0, linked: 0, missing: 0, skipped: 0, playlists: [] }

  const importTransaction = db.transaction(() => {
    for (const imported of importedPlaylists) {
      if (!imported || typeof imported !== 'object') {
        summary.skipped += 1
        continue
      }
      const references = Array.isArray(imported.canciones) ? imported.canciones : (Array.isArray(imported.tracks) ? imported.tracks : [])
      if (references.length > 5000) throw new Error('Una playlist supera el límite de 5.000 canciones.')
      const name = importedPlaylistName(imported.nombre ?? imported.name, usedNames)
      const playlistId = Number(insertPlaylist.run(req.user.id, name).lastInsertRowid)
      const seenTrackKeys = new Set()
      let added = 0
      let missing = 0
      for (const reference of references) {
        const track = matchTrack(reference)
        if (track) {
          const trackKey = `local:${track.id}`
          if (seenTrackKeys.has(trackKey)) continue
          seenTrackKeys.add(trackKey)
          if (insertTrack.run(playlistId, track.id, added).changes) {
            added += 1
            summary.matched += 1
          }
          continue
        }

        const sourceKind = String(reference?.tipoFuente ?? reference?.sourceKind ?? '').trim().toLowerCase()
        const moduleId = String(reference?.moduloId ?? reference?.moduleId ?? '').trim().slice(0, 800)
        const moduleTrackId = String(reference?.cancionModuloId ?? reference?.moduleTrackId ?? '').trim().slice(0, 800)
        const rawStreamUrl = reference?.enlace ?? reference?.streamUrl
        if (sourceKind === '8spine' && moduleId && moduleTrackId && rawStreamUrl) {
          try {
            const sourceKey = `8spine:${moduleId}:${moduleTrackId}`
            const trackKey = `external:${sourceKey}`
            if (seenTrackKeys.has(trackKey)) continue
            seenTrackKeys.add(trackKey)
            const title = String(reference?.titulo ?? reference?.title ?? 'Pista sin título').replace(/\s+/g, ' ').trim().slice(0, 240) || 'Pista sin título'
            const artist = String(reference?.artista ?? reference?.artist ?? reference?.autor ?? reference?.author ?? 'Artista desconocido').replace(/\s+/g, ' ').trim().slice(0, 240) || 'Artista desconocido'
            const album = String(reference?.album ?? 'Álbum desconocido').replace(/\s+/g, ' ').trim().slice(0, 240) || 'Álbum desconocido'
            const streamUrl = playlistExternalUrl(rawStreamUrl, { required: true, label: 'El enlace de audio' })
            const artworkUrl = playlistExternalUrl(reference?.caratula ?? reference?.artworkUrl, { label: 'El enlace de la carátula' })
            const duration = Number(reference?.duracionSegundos ?? reference?.duration)
            if (insertExternalTrack.run(
              playlistId, sourceKey, sourceKind, String(reference?.fuente ?? reference?.sourceName ?? '8SPINE').trim().slice(0, 160) || '8SPINE',
              moduleId, moduleTrackId, title, artist, album, String(reference?.genero ?? reference?.genre ?? 'Streaming').trim().slice(0, 240),
              Number.isFinite(duration) && duration >= 0 ? duration : 0,
              String(reference?.formato ?? reference?.codec ?? 'stream').trim().slice(0, 80),
              String(reference?.container ?? 'audio').trim().slice(0, 80),
              String(reference?.calidad ?? reference?.quality ?? 'stream').trim().slice(0, 80),
              artworkUrl, streamUrl, added,
            ).changes) {
              added += 1
              summary.matched += 1
              summary.linked += 1
            }
            continue
          } catch {
            // Una referencia externa inválida se informa como ausente sin abortar las demás playlists.
          }
        }

        missing += 1
        summary.missing += 1
        if (missingExamples.length < 20) missingExamples.push({
          titulo: reference?.titulo ?? reference?.title ?? 'Sin título',
          artista: reference?.artista ?? reference?.artist ?? reference?.autor ?? reference?.author ?? 'Sin artista',
        })
      }
      summary.created += 1
      summary.playlists.push({ id: playlistId, name, added, missing })
    }
  })

  try {
    importTransaction()
  } catch (error) {
    return res.status(400).json({ error: error.message || 'No se pudo importar el archivo.' })
  }
  recordUserActivity(req.user.id, 'playlists_imported', 'playlist', null, {
    created: summary.created,
    matched: summary.matched,
    linked: summary.linked,
    missing: summary.missing,
  })
  res.status(201).json({ ...summary, missingExamples })
})

app.get('/api/admin/styles', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Se necesita una cuenta administradora.' })
  res.json(styleCatalogRows())
})

app.post('/api/admin/styles', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Se necesita una cuenta administradora.' })
  let name
  try {
    name = validateCustomStyleName(req.body?.name)
  } catch (error) {
    return res.status(400).json({ error: error.message })
  }
  if (resolveAvailableStyle(name)) return res.status(409).json({ error: 'Ese estilo ya existe.' })
  const result = db.prepare('INSERT INTO custom_styles (name) VALUES (?)').run(name)
  recordUserActivity(req.user.id, 'custom_style_created', 'custom_style', result.lastInsertRowid, { name })
  res.status(201).json(styleCatalogRows().find((row) => row.id === Number(result.lastInsertRowid)))
})

app.delete('/api/admin/styles/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Se necesita una cuenta administradora.' })
  const style = db.prepare('SELECT id, name FROM custom_styles WHERE id = ?').get(req.params.id)
  if (!style) return res.status(404).json({ error: 'Estilo personalizado no encontrado.' })
  const usage = db.prepare('SELECT COUNT(*) count FROM tracks WHERE style = ?').get(style.name)
  if (usage.count) return res.status(409).json({ error: `No puedes eliminarlo mientras lo usen ${usage.count} canciones.` })
  db.prepare('DELETE FROM custom_styles WHERE id = ?').run(style.id)
  recordUserActivity(req.user.id, 'custom_style_deleted', 'custom_style', style.id, { name: style.name })
  res.status(204).end()
})

app.post('/api/admin/import/catalog', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Se necesita una cuenta administradora.' })
  const importedSongs = Array.isArray(req.body?.canciones) ? req.body.canciones : (Array.isArray(req.body?.songs) ? req.body.songs : null)
  if (!importedSongs) return res.status(400).json({ error: 'El archivo no contiene una lista de canciones válida.' })
  if (importedSongs.length > 30_000) return res.status(400).json({ error: 'El archivo supera el límite de 30.000 canciones.' })
  const suppliedCustomStyles = Array.isArray(req.body?.estilosPersonalizados) ? req.body.estilosPersonalizados : []
  if (suppliedCustomStyles.length > 200) return res.status(400).json({ error: 'El archivo supera el límite de 200 estilos personalizados.' })

  let cleanCustomStyles
  try {
    cleanCustomStyles = [...new Map(suppliedCustomStyles.map((value) => {
      const name = validateCustomStyleName(value)
      return [moodKey(name), name]
    })).values()]
  } catch (error) {
    return res.status(400).json({ error: error.message })
  }

  const libraryTracks = db.prepare('SELECT id, title, artist, album, duration, style FROM tracks').all()
  const matchTrack = libraryTrackMatcher(libraryTracks)
  const updateStyle = db.prepare('UPDATE tracks SET style = ? WHERE id = ?')
  const insertCustomStyle = db.prepare('INSERT OR IGNORE INTO custom_styles (name) VALUES (?)')
  const summary = {
    updated: 0,
    unchanged: 0,
    missing: 0,
    skipped: 0,
    invalidStyles: 0,
    createdStyles: [],
  }
  const missingExamples = []
  const invalidStyleExamples = []

  const importTransaction = db.transaction(() => {
    for (const name of cleanCustomStyles) {
      if (resolveAvailableStyle(name)) continue
      if (insertCustomStyle.run(name).changes) summary.createdStyles.push(name)
    }
    const availableByKey = new Map(customStyleNames().map((name) => [moodKey(name), name]))
    const seenTrackIds = new Set()
    for (const reference of importedSongs) {
      if (!reference || typeof reference !== 'object') {
        summary.skipped += 1
        continue
      }
      const styleProperty = ['estilo', 'ambienteManual', 'style', 'manualMood'].find((key) => Object.hasOwn(reference, key))
      if (!styleProperty) {
        summary.skipped += 1
        continue
      }
      const requestedStyle = cleanMoodName(reference[styleProperty])
      const resolvedStyle = requestedStyle ? availableByKey.get(moodKey(requestedStyle)) : null
      if (requestedStyle && !resolvedStyle) {
        summary.invalidStyles += 1
        if (invalidStyleExamples.length < 20) invalidStyleExamples.push(requestedStyle)
        continue
      }
      const track = matchTrack(reference)
      if (!track) {
        summary.missing += 1
        if (missingExamples.length < 20) missingExamples.push({
          titulo: reference?.titulo ?? reference?.title ?? 'Sin título',
          artista: reference?.artista ?? reference?.artist ?? 'Sin artista',
        })
        continue
      }
      if (seenTrackIds.has(track.id)) {
        summary.skipped += 1
        continue
      }
      seenTrackIds.add(track.id)
      if ((track.style || null) === resolvedStyle) {
        summary.unchanged += 1
        continue
      }
      updateStyle.run(resolvedStyle, track.id)
      summary.updated += 1
    }
  })

  try {
    importTransaction()
  } catch (error) {
    return res.status(400).json({ error: error.message || 'No se pudo importar el catálogo.' })
  }
  recordUserActivity(req.user.id, 'catalog_styles_imported', 'track', null, summary)
  res.json({ ...summary, missingExamples, invalidStyleExamples })
})

app.get('/api/config', async (_req, res) => {
  res.json(await readConfig())
})

app.get('/api/metadata/apple/search', providerRateLimit, async (req, res) => {
  try {
    res.json(await appleMusicSearch(req.query.term, req.query.limit))
  } catch (error) {
    res.status(502).json({ error: error.message || 'No se pudieron consultar los metadatos de Apple Music España.' })
  }
})

app.get('/api/metadata/apple/album', providerRateLimit, async (req, res) => {
  try {
    const album = await appleAlbumMetadata({
      collectionId: req.query.id,
      album: req.query.album,
      artist: req.query.artist,
    })
    if (!album) return res.status(404).json({ error: 'Apple Music España no encontró ese álbum.' })
    res.json(album)
  } catch (error) {
    res.status(502).json({ error: error.message || 'No se pudo consultar el álbum en Apple Music España.' })
  }
})

app.get('/api/metadata/lyrics', providerRateLimit, async (req, res) => {
  try {
    res.json(await lrclibLyrics({
      title: req.query.title,
      artist: req.query.artist,
      album: req.query.album,
      duration: req.query.duration,
    }))
  } catch (error) {
    res.status(error.status === 404 ? 404 : 502).json({ error: error.message || 'No se pudieron consultar las letras de LRCLIB.' })
  }
})

app.post('/api/system/select-folder', async (_req, res) => {
  if (process.platform !== 'win32') {
    return res.status(501).json({ error: 'El selector automático está disponible en Windows.' })
  }
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = 'Elige tu carpeta de música'",
    '$dialog.ShowNewFolderButton = $false',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8',
    '  Write-Output $dialog.SelectedPath',
    '}',
  ].join('; ')
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
      windowsHide: false,
      encoding: 'utf8',
    })
    const selectedPath = stdout.trim()
    if (!selectedPath) return res.status(204).end()
    res.json({ path: selectedPath })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/config', async (req, res) => {
  try {
    const config = await writeConfig(req.body.musicFolder)
    scanConfiguredLibrary().catch((error) => console.error('Escaneo inicial:', error))
    res.json(config)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.post('/api/modules/download', remoteDownloadRateLimit, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede descargar música a la biblioteca.' })
  const streamUrl = String(req.body.streamUrl || '').trim().slice(0, 4000)
  const title = String(req.body.title || 'Pista sin título').replace(/\s+/g, ' ').trim().slice(0, 240)
  const artist = String(req.body.artist || 'Artista desconocido').replace(/\s+/g, ' ').trim().slice(0, 240)
  const album = String(req.body.album || 'Álbum desconocido').replace(/\s+/g, ' ').trim().slice(0, 240)
  if (!streamUrl) return res.status(400).json({ error: 'El módulo no devolvió una URL de audio descargable.' })
  const config = await readConfig()
  if (!config.musicFolder) return res.status(400).json({ error: 'Primero asigna una carpeta de música en Biblioteca local.' })
  let downloaded = null
  try {
    downloaded = await downloadModuleAudio({ streamUrl, musicFolder: config.musicFolder, title, artist, album })
    await indexLibraryFile(downloaded.path)
    const apple = await appleMusicSearch(`${title} ${artist}`, 12).catch(() => null)
    const normalizedTitle = title.toLocaleLowerCase('es')
    const normalizedArtist = artist.toLocaleLowerCase('es')
    const match = apple?.tracks?.find((track) => (
      track.title.toLocaleLowerCase('es') === normalizedTitle
      && track.artist.toLocaleLowerCase('es') === normalizedArtist
    )) || null
    db.prepare(`
      UPDATE tracks SET
        title = ?, artist = ?, album = ?, album_artist = ?,
        year = COALESCE(?, year), genre = COALESCE(NULLIF(?, ''), genre),
        artwork_url = COALESCE(?, artwork_url)
      WHERE path = ?
    `).run(title, artist, album, artist, match?.year || null, match?.genre || '', match?.artworkUrl || null, downloaded.path)
    const track = db.prepare('SELECT * FROM tracks WHERE path = ?').get(downloaded.path)
    recordUserActivity(req.user.id, 'module_track_downloaded', 'track', track.id, {
      moduleId: String(req.body.moduleId || '').slice(0, 180),
      moduleTrackId: String(req.body.moduleTrackId || '').slice(0, 240),
      bytes: downloaded.bytes,
    })
    res.status(201).json({ track: rowToTrack(track), savedTo: downloaded.path, metadataProvider: match ? 'Apple Music España' : null })
  } catch (error) {
    if (downloaded?.path && !db.prepare('SELECT 1 FROM tracks WHERE path = ?').get(downloaded.path)) {
      await fsp.rm(downloaded.path, { force: true }).catch(() => {})
    }
    res.status(400).json({ error: error.message || 'No se pudo descargar la canción del módulo.' })
  }
})

app.post('/api/library/scan', async (_req, res) => {
  if (!scanState.running) {
    scanConfiguredLibrary().catch((error) => {
      scanState.message = error.message
      scanState.running = false
    })
  }
  res.status(202).json(scanState)
})

app.get('/api/library/scan', (_req, res) => res.json(scanState))

app.get('/api/tracks', (req, res) => {
  const search = String(req.query.search || '').trim()
  const favoriteOnly = req.query.favorite === 'true'
  const clauses = []
  const values = {}
  if (search) {
    clauses.push('(title LIKE @search OR artist LIKE @search OR album LIKE @search OR genre LIKE @search)')
    values.search = `%${search}%`
  }
  if (favoriteOnly) clauses.push('favorite = 1')
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = db.prepare(`SELECT * FROM tracks ${where} ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, title COLLATE NOCASE`).all(values)
  res.json(rows.map(rowToTrack))
})

app.get('/api/library/summary', (req, res) => {
  const totals = db.prepare(`
    SELECT COUNT(*) tracks, COUNT(DISTINCT artist) artists, COUNT(DISTINCT album) albums,
           COALESCE(SUM(duration), 0) duration
    FROM tracks
  `).get()
  const recent = db.prepare('SELECT * FROM tracks ORDER BY added_at DESC LIMIT 12').all().map(rowToTrack)
  const albums = db.prepare(`
    SELECT album, artist, COUNT(*) trackCount, MAX(id) sampleTrackId
    FROM tracks GROUP BY album, artist ORDER BY MAX(added_at) DESC LIMIT 20
  `).all()
  const recentlyPlayed = db.prepare(`
    SELECT t.* FROM listening_history h
    JOIN tracks t ON t.id = h.track_id
    WHERE h.user_id = ?
    GROUP BY t.id
    ORDER BY MAX(h.listened_at) DESC LIMIT 12
  `).all(req.user.id).map(rowToTrack)
  res.json({ totals, recent, albums, recentlyPlayed })
})

app.get('/api/tracks/:id/stream', (req, res) => {
  const track = db.prepare('SELECT path FROM tracks WHERE id = ?').get(req.params.id)
  if (!track || !fs.existsSync(track.path)) return res.status(404).json({ error: 'Archivo no encontrado.' })
  const stat = fs.statSync(track.path)
  const range = req.headers.range
  const ext = path.extname(track.path).toLowerCase()
  const mime = {
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
  }[ext] || 'application/octet-stream'

  if (!range) {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': mime, 'Accept-Ranges': 'bytes' })
    return fs.createReadStream(track.path).pipe(res)
  }
  const [startText, endText] = range.replace(/bytes=/, '').split('-')
  const start = Number(startText)
  const end = endText ? Number(endText) : stat.size - 1
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Type': mime,
  })
  fs.createReadStream(track.path, { start, end }).pipe(res)
})

app.get('/api/tracks/:id/artwork', (req, res) => {
  const track = db.prepare('SELECT artwork_path FROM tracks WHERE id = ?').get(req.params.id)
  if (!track?.artwork_path || !fs.existsSync(track.artwork_path)) return res.status(404).end()
  res.type(path.extname(track.artwork_path))
  fs.createReadStream(track.artwork_path).pipe(res)
})

app.get('/api/tracks/:id/lyrics', (req, res) => {
  const track = db.prepare('SELECT id FROM tracks WHERE id = ?').get(req.params.id)
  if (!track) return res.status(404).json({ error: 'Canción no encontrada.' })
  const lyrics = db.prepare(`
    SELECT source_name sourceName, content, synced, updated_at updatedAt
    FROM user_track_lyrics WHERE user_id = ? AND track_id = ?
  `).get(req.user.id, req.params.id)
  res.json(lyrics ? {
    ...lyrics,
    synced: Boolean(lyrics.synced),
    format: String(lyrics.sourceName || '').toLowerCase().endsWith('.lrc') ? 'lrc' : 'txt',
  } : {
    sourceName: null,
    content: '',
    synced: false,
    format: 'lrc',
    updatedAt: null,
  })
})

app.put('/api/tracks/:id/lyrics', (req, res) => {
  const track = db.prepare('SELECT id FROM tracks WHERE id = ?').get(req.params.id)
  if (!track) return res.status(404).json({ error: 'Canción no encontrada.' })
  const content = String(req.body.content || '').replace(/\r\n?/g, '\n').trim()
  if (!content) return res.status(400).json({ error: 'El archivo de letras está vacío.' })
  if (Buffer.byteLength(content, 'utf8') > 1024 * 1024) {
    return res.status(413).json({ error: 'El archivo de letras supera 1 MB.' })
  }
  const requestedFormat = req.body.format === 'lrc' || req.body.format === 'txt' ? req.body.format : null
  const suppliedName = path.basename(String(req.body.sourceName || '')).slice(0, 180)
  const inferredFormat = requestedFormat || (suppliedName.toLowerCase().endsWith('.lrc') ? 'lrc' : 'txt')
  const sourceName = suppliedName || `letras.${inferredFormat}`
  const synced = inferredFormat === 'lrc' && /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?]/.test(content) ? 1 : 0
  db.prepare(`
    INSERT INTO user_track_lyrics (user_id, track_id, source_name, content, synced, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, track_id) DO UPDATE SET
      source_name = excluded.source_name,
      content = excluded.content,
      synced = excluded.synced,
      updated_at = CURRENT_TIMESTAMP
  `).run(req.user.id, req.params.id, sourceName, content, synced)
  recordUserActivity(req.user.id, 'lyrics_saved', 'track', req.params.id, { sourceName, format: inferredFormat })
  res.json({ sourceName, content, synced: Boolean(synced), format: inferredFormat, updatedAt: new Date().toISOString() })
})

app.patch('/api/tracks/:id/favorite', (req, res) => {
  const previous = db.prepare('SELECT favorite FROM tracks WHERE id = ?').get(req.params.id)
  db.prepare('UPDATE tracks SET favorite = ? WHERE id = ?').run(req.body.favorite ? 1 : 0, req.params.id)
  if (previous && Boolean(previous.favorite) !== Boolean(req.body.favorite)) {
    recordInteraction({
      userId: req.user.id,
      trackId: Number(req.params.id),
      eventType: req.body.favorite ? 'favorite' : 'unfavorite',
      context: { source: 'favorite_button' },
    })
  }
  res.json(rowToTrack(db.prepare('SELECT * FROM tracks WHERE id = ?').get(req.params.id)))
})

app.patch('/api/tracks/:id/style', (req, res) => {
  const requestedStyle = cleanMoodName(req.body.style)
  const style = requestedStyle ? resolveAvailableStyle(requestedStyle) : null
  if (requestedStyle && !style) return res.status(400).json({ error: 'Estilo no válido.' })
  if (!db.prepare('SELECT 1 FROM tracks WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Canción no encontrada.' })
  db.prepare('UPDATE tracks SET style = ? WHERE id = ?').run(style, req.params.id)
  res.json(rowToTrack(db.prepare('SELECT * FROM tracks WHERE id = ?').get(req.params.id)))
})

app.patch('/api/tracks/:id/mood', (req, res) => {
  const requestedMood = cleanMoodName(req.body.mood)
  const mood = requestedMood ? resolveAvailableMood(requestedMood) : null
  if (requestedMood && !mood) return res.status(400).json({ error: 'Estilo no válido.' })
  if (!db.prepare('SELECT 1 FROM tracks WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Canción no encontrada.' })
  db.prepare('UPDATE tracks SET manual_mood = ? WHERE id = ?').run(mood, req.params.id)
  res.json(rowToTrack(db.prepare('SELECT * FROM tracks WHERE id = ?').get(req.params.id)))
})

app.get('/api/analysis/pending', (req, res) => {
  const limit = Math.min(Number(req.query.limit || 2), 5)
  const rows = db.prepare(`
    SELECT t.* FROM tracks t
    LEFT JOIN track_audio_profiles p ON p.track_id = t.id
    WHERE t.analysis_status = 'pending'
      OR (t.analysis_status = 'done' AND (p.track_id IS NULL OR p.analysis_version < ?))
    ORDER BY t.added_at LIMIT ?
  `).all(ANALYSIS_VERSION, limit)
  res.json(rows.map(rowToTrack))
})

app.post('/api/tracks/:id/analysis', (req, res) => {
  if (req.body.failed) {
    db.prepare("UPDATE tracks SET analysis_status = 'unsupported' WHERE id = ?").run(req.params.id)
    return res.json({ status: 'unsupported' })
  }
  const metrics = {
    bpm: Math.max(0, Math.min(240, Number(req.body.bpm || 0))),
    energy: Math.max(0, Math.min(1, Number(req.body.energy || 0))),
    brightness: Math.max(0, Math.min(1, Number(req.body.brightness || 0))),
    dynamics: Math.max(0, Math.min(1, Number(req.body.dynamics || 0))),
  }
  const mood = classifyMood(metrics)
  const embedding = Array.isArray(req.body.embedding) ? req.body.embedding.map(Number) : []
  const segments = Array.isArray(req.body.segments) ? req.body.segments : []
  const summary = req.body.summary && typeof req.body.summary === 'object' ? req.body.summary : metrics
  const version = Math.max(1, Number(req.body.version || 1))
  const saveAnalysis = db.transaction(() => {
    db.prepare(`
      UPDATE tracks SET bpm = @bpm, energy = @energy, brightness = @brightness,
        dynamics = @dynamics, auto_mood = @mood, analysis_status = 'done'
      WHERE id = @id
    `).run({ ...metrics, mood, id: req.params.id })
    if (embedding.length >= 16 && version >= ANALYSIS_VERSION) {
      db.prepare(`
        INSERT INTO track_audio_profiles (
          track_id, analysis_version, embedding, segment_embeddings, feature_summary, updated_at
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(track_id) DO UPDATE SET
          analysis_version = excluded.analysis_version,
          embedding = excluded.embedding,
          segment_embeddings = excluded.segment_embeddings,
          feature_summary = excluded.feature_summary,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        req.params.id,
        version,
        JSON.stringify(embedding),
        JSON.stringify(segments),
        JSON.stringify(summary),
      )
    }
  })
  saveAnalysis()
  res.json({ ...metrics, mood, version, profileSaved: embedding.length >= 16 })
})

app.post('/api/history', (req, res) => {
  const seconds = Math.max(0, Number(req.body.seconds || 0))
  const completed = req.body.completed ? 1 : 0
  const skipped = req.body.skipped ? 1 : 0
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(req.body.trackId)
  const sessionId = req.body.sessionId || null
  const recommendationRunId = req.body.recommendationRunId || null
  const transaction = db.transaction(() => {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO listening_history (
        user_id, track_id, playback_event_id, seconds, completed, skipped,
        mood_context, session_id, recommendation_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      req.body.trackId,
      req.body.playbackEventId || null,
      seconds,
      completed,
      skipped,
      req.body.moodContext || null,
      sessionId,
      recommendationRunId,
    )
    if (!insert.changes) return { earned: 0, recorded: false }
    if (completed) {
      db.prepare('UPDATE tracks SET play_count = play_count + 1, last_played = CURRENT_TIMESTAMP WHERE id = ?').run(req.body.trackId)
    }
    const earned = Math.max(1, Math.floor(seconds / 60)) + (completed ? 2 : 0)
    walletForUser(req.user.id)
    db.prepare("UPDATE user_wallets SET notes = notes + ?, last_active = date('now') WHERE user_id = ?").run(earned, req.user.id)
    return { earned, recorded: true }
  })
  const historyResult = transaction()
  const completionRatio = track?.duration ? clampHistoryRatio(seconds / track.duration) : 0
  const tokenCharge = addTokenUsage(req.user.id, track, req.body.playbackEventId, seconds, Boolean(completed))
  if (historyResult.recorded && completed) {
    recordInteraction({
      userId: req.user.id,
      trackId: Number(req.body.trackId),
      eventType: 'completed',
      value: Math.max(0.5, completionRatio),
      sessionId,
      recommendationRunId,
      context: { intent: req.body.moodContext || null, completionRatio },
    })
  } else if (historyResult.recorded && skipped) {
    recordInteraction({
      userId: req.user.id,
      trackId: Number(req.body.trackId),
      eventType: seconds < Math.min(30, Number(track?.duration || 120) * 0.25) ? 'skip_early' : 'skip_late',
      value: 1,
      sessionId,
      recommendationRunId,
      context: { intent: req.body.moodContext || null, seconds, completionRatio },
    })
  }
  if (historyResult.recorded) {
    recordUserActivity(req.user.id, 'track_listened', 'track', req.body.trackId, {
      seconds,
      completed: Boolean(completed),
      skipped: Boolean(skipped),
      completionRatio: completed ? 1 : completionRatio,
      tokenCharge,
    })
  }
  res.json({
    pointsEarned: historyResult.earned,
    wallet: walletForUser(req.user.id),
    tokenCharge,
    tokenAccount: tokenCharge ? tokenAccountPayload(req.user.id) : null,
  })
})

function clampHistoryRatio(value) {
  return Math.max(0, Math.min(1, Number(value || 0)))
}

app.post('/api/interactions', (req, res) => {
  const allowed = new Set(['queue_add', 'queue_remove', 'replay', 'search_play'])
  if (!allowed.has(req.body.eventType)) return res.status(400).json({ error: 'Interacción no válida.' })
  recordInteraction({
    userId: req.user.id,
    trackId: Number(req.body.trackId),
    eventType: req.body.eventType,
    value: Number(req.body.value || 1),
    sessionId: req.body.sessionId || null,
    recommendationRunId: req.body.recommendationRunId || null,
    context: req.body.context || {},
  })
  res.status(201).json({ ok: true })
})

app.post('/api/recommendations/session', (req, res) => {
  try {
    res.json(generateSession({ ...(req.body || {}), userId: req.user.id }))
  } catch (error) {
    console.error('Recomendador:', error)
    res.status(500).json({ error: 'No se pudo construir la sesión recomendada.' })
  }
})

app.get('/api/recommendations/metrics', (req, res) => {
  res.json(recommendationMetrics(req.user.id))
})

function playlistExternalUrl(value, { required = false, label = 'El enlace' } = {}) {
  const raw = String(value || '').trim()
  if (!raw && !required) return null
  if (!raw) throw new Error(`${label} es obligatorio.`)
  if (raw.length > 4000) throw new Error(`${label} es demasiado largo.`)
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${label} no es una URL válida.`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label} debe usar HTTP o HTTPS.`)
  return url.href
}

function playlistExternalTrackPayload(row) {
  return {
    id: row.source_key,
    playlistExternalId: row.id,
    playlistEntryKey: `external:${row.id}`,
    sourceKey: row.source_key,
    sourceKind: row.source_kind,
    sourceName: row.source_name,
    browserOnly: true,
    moduleId: row.module_id,
    moduleTrackId: row.module_track_id,
    file_name: row.title,
    title: row.title,
    artist: row.artist,
    album: row.album,
    album_artist: '',
    year: row.year,
    genre: row.genre || 'Streaming',
    duration: Number(row.duration || 0),
    bitrate: row.bitrate,
    sample_rate: row.sample_rate,
    bit_depth: row.bit_depth,
    channels: row.channels,
    codec: row.codec || 'stream',
    container: row.container || 'audio',
    quality: row.quality || 'stream',
    favorite: false,
    play_count: 0,
    tokenCost: MODULE_STREAM_TOKEN_COST,
    streamPriceEuroCents: MODULE_STREAM_EURO_CENTS,
    added_at: row.added_at,
    artworkUrl: row.artwork_url || null,
    streamUrl: row.stream_url,
    location: row.stream_url,
    style: null,
    mood: 'Sin analizar',
    lyrics: null,
  }
}

function playlistTracks(playlistId, userId) {
  const localTracks = db.prepare(`
    SELECT t.*, pt.position playlistPosition
    FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
    JOIN playlists p ON p.id = pt.playlist_id
    WHERE pt.playlist_id = ? AND p.user_id = ?
  `).all(playlistId, userId).map((row) => ({
    ...rowToTrack(row),
    playlistEntryKey: `local:${row.id}`,
    playlistPosition: row.playlistPosition,
  }))
  const externalTracks = db.prepare(`
    SELECT pet.*
    FROM playlist_external_tracks pet JOIN playlists p ON p.id = pet.playlist_id
    WHERE pet.playlist_id = ? AND p.user_id = ?
  `).all(playlistId, userId).map((row) => ({
    ...playlistExternalTrackPayload(row),
    playlistPosition: row.position,
  }))
  return [...localTracks, ...externalTracks]
    .sort((left, right) => left.playlistPosition - right.playlistPosition || left.playlistEntryKey.localeCompare(right.playlistEntryKey))
    .map(({ playlistPosition: _playlistPosition, ...track }) => track)
}

function nextPlaylistPosition(playlistId) {
  return db.prepare(`
    SELECT COALESCE(MAX(position), -1) + 1 next
    FROM (
      SELECT position FROM playlist_tracks WHERE playlist_id = ?
      UNION ALL
      SELECT position FROM playlist_external_tracks WHERE playlist_id = ?
    )
  `).get(playlistId, playlistId).next
}

app.get('/api/playlists', (req, res) => {
  const playlists = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id)
      + (SELECT COUNT(*) FROM playlist_external_tracks pet WHERE pet.playlist_id = p.id) trackCount
    FROM playlists p
    WHERE p.user_id = ?
    ORDER BY p.updated_at DESC
  `).all(req.user.id)
  res.json(playlists)
})

app.post('/api/playlists', (req, res) => {
  const name = String(req.body.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Escribe un nombre.' })
  const result = db.prepare('INSERT INTO playlists (user_id, name) VALUES (?, ?)').run(req.user.id, name)
  recordUserActivity(req.user.id, 'playlist_created', 'playlist', result.lastInsertRowid, { name })
  res.status(201).json(db.prepare('SELECT * FROM playlists WHERE id = ?').get(result.lastInsertRowid))
})

app.patch('/api/playlists/:id', (req, res) => {
  const name = String(req.body.name || '').trim()
  const result = db.prepare('UPDATE playlists SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(name, req.params.id, req.user.id)
  if (!result.changes) return res.status(404).json({ error: 'Playlist no encontrada.' })
  recordUserActivity(req.user.id, 'playlist_renamed', 'playlist', req.params.id, { name })
  res.json(db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id))
})

app.delete('/api/playlists/:id', (req, res) => {
  const result = db.prepare('DELETE FROM playlists WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id)
  if (!result.changes) return res.status(404).json({ error: 'Playlist no encontrada.' })
  recordUserActivity(req.user.id, 'playlist_deleted', 'playlist', req.params.id)
  res.status(204).end()
})

app.get('/api/playlists/:id/tracks', (req, res) => {
  const playlist = db.prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!playlist) return res.status(404).json({ error: 'Playlist no encontrada.' })
  res.json(playlistTracks(playlist.id, req.user.id))
})

app.post('/api/playlists/:id/tracks', (req, res) => {
  const playlist = db.prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!playlist) return res.status(404).json({ error: 'Playlist no encontrada.' })
  const externalTrack = req.body?.track?.sourceKind === '8spine' ? req.body.track : null
  const position = nextPlaylistPosition(playlist.id)

  if (externalTrack) {
    try {
      const sourceKind = '8spine'
      const moduleId = String(externalTrack.moduleId || '').trim().slice(0, 800)
      const moduleTrackId = String(externalTrack.moduleTrackId || '').trim().slice(0, 800)
      if (!moduleId || !moduleTrackId) throw new Error('La canción no incluye la referencia necesaria para volver a abrirla en el módulo.')
      const sourceKey = `8spine:${moduleId}:${moduleTrackId}`
      const defaultSourceName = '8SPINE'
      const sourceName = String(externalTrack.sourceName || defaultSourceName).replace(/\s+/g, ' ').trim().slice(0, 160) || defaultSourceName
      const title = String(externalTrack.title || 'Pista sin título').replace(/\s+/g, ' ').trim().slice(0, 240) || 'Pista sin título'
      const artist = String(externalTrack.artist || 'Artista desconocido').replace(/\s+/g, ' ').trim().slice(0, 240) || 'Artista desconocido'
      const album = String(externalTrack.album || 'Álbum desconocido').replace(/\s+/g, ' ').trim().slice(0, 240) || 'Álbum desconocido'
      const streamUrl = playlistExternalUrl(externalTrack.streamUrl, { required: true, label: 'El enlace de audio' })
      const artworkUrl = playlistExternalUrl(externalTrack.artworkUrl, { label: 'El enlace de la carátula' })
      const number = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null
      const result = db.prepare(`
        INSERT OR IGNORE INTO playlist_external_tracks (
          playlist_id, source_key, source_kind, source_name, module_id, module_track_id,
          title, artist, album, year, genre, duration, bitrate, sample_rate, bit_depth,
          channels, codec, container, quality, artwork_url, stream_url, position
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        playlist.id, sourceKey, sourceKind, sourceName, moduleId, moduleTrackId,
        title, artist, album, number(externalTrack.year), String(externalTrack.genre || 'Streaming').trim().slice(0, 240),
        number(externalTrack.duration) || 0, number(externalTrack.bitrate), number(externalTrack.sample_rate),
        number(externalTrack.bit_depth), number(externalTrack.channels), String(externalTrack.codec || 'stream').trim().slice(0, 80),
        String(externalTrack.container || 'audio').trim().slice(0, 80), String(externalTrack.quality || 'stream').trim().slice(0, 80),
        artworkUrl, streamUrl, position,
      )
      if (result.changes) {
        db.prepare('UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(playlist.id)
        recordUserActivity(req.user.id, 'playlist_external_track_added', 'playlist', playlist.id, {
          sourceKind,
          moduleId,
          moduleTrackId,
          title,
        })
      }
      const saved = db.prepare('SELECT * FROM playlist_external_tracks WHERE playlist_id = ? AND source_key = ?').get(playlist.id, sourceKey)
      return res.status(201).json({ ok: true, added: Boolean(result.changes), track: playlistExternalTrackPayload(saved) })
    } catch (error) {
      return res.status(400).json({ error: error.message || 'No se pudo guardar el enlace de la canción.' })
    }
  }

  const trackId = Number(req.body.trackId)
  if (!Number.isInteger(trackId) || !db.prepare('SELECT 1 FROM tracks WHERE id = ?').get(trackId)) {
    return res.status(400).json({ error: 'La canción local no existe.' })
  }
  const result = db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)').run(playlist.id, trackId, position)
  if (result.changes) {
    db.prepare('UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(playlist.id)
    recordInteraction({
      userId: req.user.id,
      trackId,
      eventType: 'playlist_add',
      context: { playlistId: playlist.id },
    })
    recordUserActivity(req.user.id, 'playlist_track_added', 'playlist', playlist.id, { trackId })
  }
  res.status(201).json({ ok: true, added: Boolean(result.changes) })
})

app.put('/api/playlists/:id/reorder', (req, res) => {
  const playlist = db.prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!playlist) return res.status(404).json({ error: 'Playlist no encontrada.' })
  const currentKeys = playlistTracks(playlist.id, req.user.id).map((track) => track.playlistEntryKey)
  const requestedKeys = Array.isArray(req.body.entryKeys)
    ? req.body.entryKeys.map(String)
    : (Array.isArray(req.body.trackIds) ? req.body.trackIds.map((trackId) => `local:${trackId}`) : [])
  const validKeys = new Set(currentKeys)
  const seen = new Set()
  const orderedKeys = [...requestedKeys, ...currentKeys].filter((key) => {
    if (!validKeys.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })
  const reorder = db.transaction((entryKeys) => {
    const updateLocal = db.prepare('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?')
    const updateExternal = db.prepare('UPDATE playlist_external_tracks SET position = ? WHERE playlist_id = ? AND id = ?')
    entryKeys.forEach((key, position) => {
      const [kind, rawId] = key.split(':', 2)
      const entryId = Number(rawId)
      if (!Number.isInteger(entryId)) return
      if (kind === 'local') updateLocal.run(position, playlist.id, entryId)
      if (kind === 'external') updateExternal.run(position, playlist.id, entryId)
    })
    db.prepare('UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(playlist.id)
  })
  reorder(orderedKeys)
  recordUserActivity(req.user.id, 'playlist_reordered', 'playlist', playlist.id, { entryKeys: orderedKeys })
  res.json({ ok: true })
})

app.get('/api/moods', (_req, res) => res.json(moodCatalogRows()))

app.get('/api/styles', (_req, res) => res.json(styleCatalogRows()))

app.get('/api/moods/:mood/tracks', (req, res) => {
  const rows = db.prepare(`
    SELECT t.*,
      COALESCE(SUM(CASE WHEN h.completed = 1 THEN 3 WHEN h.skipped = 1 THEN -2 ELSE 0 END), 0) affinity
    FROM tracks t LEFT JOIN listening_history h ON h.track_id = t.id AND h.user_id = ?
    WHERE COALESCE(t.manual_mood, t.auto_mood) = ?
    GROUP BY t.id ORDER BY affinity DESC, RANDOM()
  `).all(req.user.id, req.params.mood)
  res.json(rows.map(rowToTrack))
})

app.get('/api/stats', (req, res) => {
  const overview = db.prepare(`
    SELECT COALESCE(SUM(seconds), 0) seconds,
      COUNT(DISTINCT date(listened_at)) activeDays,
      COALESCE(SUM(completed), 0) completedTracks
    FROM listening_history WHERE user_id = ?
  `).get(req.user.id)
  const topArtists = db.prepare(`
    SELECT t.artist name, ROUND(SUM(h.seconds) / 60.0, 1) minutes
    FROM listening_history h JOIN tracks t ON t.id = h.track_id
    WHERE h.user_id = ?
    GROUP BY t.artist ORDER BY minutes DESC LIMIT 6
  `).all(req.user.id)
  const topAlbums = db.prepare(`
    SELECT t.album name, t.artist, ROUND(SUM(h.seconds) / 60.0, 1) minutes
    FROM listening_history h JOIN tracks t ON t.id = h.track_id
    WHERE h.user_id = ?
    GROUP BY t.album, t.artist ORDER BY minutes DESC LIMIT 6
  `).all(req.user.id)
  const moods = db.prepare(`
    SELECT COALESCE(h.mood_context, t.manual_mood, t.auto_mood, 'Otros') name,
      ROUND(SUM(h.seconds) / 60.0, 1) minutes
    FROM listening_history h JOIN tracks t ON t.id = h.track_id
    WHERE h.user_id = ?
    GROUP BY name ORDER BY minutes DESC
  `).all(req.user.id)
  const byDay = db.prepare(`
    SELECT strftime('%d/%m', listened_at) day, ROUND(SUM(seconds) / 60.0, 1) minutes
    FROM listening_history
    WHERE user_id = ? AND listened_at >= datetime('now', '-13 days')
    GROUP BY date(listened_at) ORDER BY date(listened_at)
  `).all(req.user.id)
  res.json({ overview, topArtists, topAlbums, moods, byDay, recommendations: recommendationMetrics(req.user.id) })
})

app.patch('/api/account/profile', (req, res) => {
  const displayName = String(req.body.displayName || '').trim().slice(0, 80)
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 180)
  if (displayName.length < 2) return res.status(400).json({ error: 'Escribe un nombre de al menos 2 caracteres.' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Escribe un correo válido.' })
  const duplicate = db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(email, req.user.id)
  if (duplicate) return res.status(409).json({ error: 'Ese correo ya pertenece a otra cuenta.' })
  db.prepare(`
    UPDATE users SET display_name = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(displayName, email, req.user.id)
  recordUserActivity(req.user.id, 'profile_updated', 'user', req.user.id, { displayName, email })
  res.json({ user: userPayload(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) })
})

app.get('/api/account/overview', (req, res) => {
  const userId = req.user.id
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM listening_history WHERE user_id = ?) listens,
      (SELECT COUNT(*) FROM playlists WHERE user_id = ?) playlists,
      (SELECT COUNT(*) FROM purchases WHERE user_id = ? AND refunded_at IS NULL) purchases,
      (SELECT COALESCE(SUM(cost), 0) FROM token_usage WHERE user_id = ?) consumedTokens
  `).get(userId, userId, userId, userId)
  const listens = db.prepare(`
    SELECT h.id, h.track_id trackId, h.playback_event_id playbackEventId, h.seconds,
      h.completed, h.skipped, h.listened_at listenedAt, t.title, t.artist, t.album, t.duration
    FROM listening_history h JOIN tracks t ON t.id = h.track_id
    WHERE h.user_id = ? ORDER BY h.listened_at DESC, h.id DESC LIMIT 80
  `).all(userId)
  const activities = db.prepare(`
    SELECT id, activity_type type, entity_type entityType, entity_id entityId,
      details, created_at createdAt
    FROM user_activity WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 80
  `).all(userId).map((row) => {
    try { return { ...row, details: JSON.parse(row.details || '{}') } } catch { return { ...row, details: {} } }
  })
  const playlists = db.prepare(`
    SELECT p.id, p.name, p.created_at createdAt, p.updated_at updatedAt,
      (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id)
      + (SELECT COUNT(*) FROM playlist_external_tracks pet WHERE pet.playlist_id = p.id) trackCount
    FROM playlists p
    WHERE p.user_id = ? ORDER BY p.updated_at DESC
  `).all(userId)
  res.json({
    user: userPayload(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)),
    wallet: walletForUser(userId),
    counts,
    listens,
    playlists,
    activities,
    tokenAccount: tokenAccountPayload(userId),
  })
})

app.delete('/api/account/listens/:id', (req, res) => {
  const listen = db.prepare('SELECT id, track_id trackId FROM listening_history WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!listen) return res.status(404).json({ error: 'Escucha no encontrada.' })
  db.prepare('DELETE FROM listening_history WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id)
  recordUserActivity(req.user.id, 'listen_removed', 'track', listen.trackId, { listenId: listen.id })
  res.status(204).end()
})

app.get('/api/token-account', (req, res) => {
  res.json(tokenAccountPayload(req.user.id))
})

app.post('/api/token-usage', (req, res) => {
  const eventId = String(req.body.eventId || '').trim().slice(0, 120)
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(req.body.trackId)
  if (!eventId) return res.status(400).json({ error: 'Falta el identificador de reproducción.' })
  if (!track) return res.status(404).json({ error: 'Canción no encontrada.' })
  const listenedSeconds = Number(req.body.listenedSeconds ?? req.body.seconds ?? track.duration)
  addTokenUsage(req.user.id, track, eventId, listenedSeconds, Boolean(req.body.completed ?? true))
  res.status(201).json(tokenAccountPayload(req.user.id))
})

app.post('/api/token-usage/stream', (req, res) => {
  const eventId = String(req.body.eventId || '').trim().slice(0, 120)
  const moduleId = String(req.body.moduleId || '').trim().slice(0, 180)
  const moduleTrackId = String(req.body.moduleTrackId || '').trim().slice(0, 240)
  if (!eventId) return res.status(400).json({ error: 'Falta el identificador de reproducción.' })
  if (!moduleId || !moduleTrackId) return res.status(400).json({ error: 'Falta identificar la canción y su módulo.' })
  const charged = addStreamTokenUsage(req.user.id, req.body)
  res.status(201).json({
    charged,
    euroCents: charged ? MODULE_STREAM_EURO_CENTS : 0,
    account: tokenAccountPayload(req.user.id),
  })
})

app.post('/api/token-account/pay', async (req, res) => {
  const account = tokenAccountPayload(req.user.id)
  if (!account.pending.length) return res.status(400).json({ error: 'No hay tokens pendientes.' })
  const payment = paymentSummary(req.body.method, req.body.cardNumber)

  // PAGO FICTICIO — no se procesa ni transmite ningún dato real.
  await new Promise((resolve) => setTimeout(resolve, 900))
  const paymentId = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO token_payments (user_id, amount_tokens, amount_cents, method, brand, last4)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.id, account.pendingTotal, account.pendingAmountCents, payment.method, payment.brand, payment.last4)
    db.prepare(`
      UPDATE token_usage
      SET paid_at = CURRENT_TIMESTAMP, payment_id = ?
      WHERE user_id = ? AND paid_at IS NULL
    `).run(result.lastInsertRowid, req.user.id)
    db.prepare(`
      UPDATE stream_token_usage
      SET paid_at = CURRENT_TIMESTAMP, payment_id = ?
      WHERE user_id = ? AND paid_at IS NULL
    `).run(result.lastInsertRowid, req.user.id)
    db.prepare('INSERT INTO payment_profiles (user_id, method, brand, last4) VALUES (?, ?, ?, ?)').run(
      req.user.id,
      payment.method,
      payment.brand,
      payment.last4,
    )
    recordUserActivity(req.user.id, 'tokens_paid', 'token_payment', result.lastInsertRowid, {
      amount: account.pendingTotal,
      amountCents: account.pendingAmountCents,
    })
    return Number(result.lastInsertRowid)
  })()
  res.json({
    ok: true,
    paymentId,
    paid: account.pendingTotal,
    paidAmountCents: account.pendingAmountCents,
    account: tokenAccountPayload(req.user.id),
  })
})

app.get('/api/wallet', (req, res) => {
  res.json(walletForUser(req.user.id))
})

app.post('/api/wallet/topup', async (req, res) => {
  const bundles = new Map([[100, 0.99], [300, 2.49], [750, 4.99]])
  const points = Number(req.body.points)
  if (!bundles.has(points)) return res.status(400).json({ error: 'Paquete de Puntos no válido.' })
  const payment = paymentSummary(req.body.method, req.body.cardNumber)

  // PAGO FICTICIO — no se procesa ni transmite ningún dato real.
  await new Promise((resolve) => setTimeout(resolve, 900))
  db.transaction(() => {
    walletForUser(req.user.id)
    db.prepare('UPDATE user_wallets SET notes = notes + ? WHERE user_id = ?').run(points, req.user.id)
    db.prepare(`
      INSERT INTO wallet_transactions (
        user_id, transaction_type, notes, money_cents, method, brand, last4
      ) VALUES (?, 'topup', ?, ?, ?, ?, ?)
    `).run(req.user.id, points, Math.round(bundles.get(points) * 100), payment.method, payment.brand, payment.last4)
    db.prepare('INSERT INTO payment_profiles (user_id, method, brand, last4) VALUES (?, ?, ?, ?)').run(
      req.user.id,
      payment.method,
      payment.brand,
      payment.last4,
    )
    recordUserActivity(req.user.id, 'wallet_topped_up', 'wallet', req.user.id, { points, euros: bundles.get(points) })
  })()
  res.json({
    ok: true,
    points,
    simulatedPrice: bundles.get(points),
    wallet: walletForUser(req.user.id),
  })
})

app.get('/api/preferences', (req, res) => {
  res.json({
    appearance: readPreference(req.user.id, 'appearance', DEFAULT_APPEARANCE),
    audio: readPreference(req.user.id, 'audio', DEFAULT_AUDIO),
    unlocks: {
      customization: ownsItem(req.user.id, 'customization-suite'),
      soundLab: ownsItem(req.user.id, 'sound-lab-pro'),
    },
  })
})

app.put('/api/preferences', (req, res) => {
  const allowedAccents = new Set(['olive', 'coral', 'blue', 'violet', 'silver', 'emerald', 'cyan', 'gold', 'pink', 'red'])
  const allowedSurfaces = new Set(['ink', 'midnight', 'graphite'])
  const allowedDensities = new Set(['comfortable', 'compact'])
  const save = db.prepare(`
    INSERT INTO user_preferences (user_id, preference_key, preference_value, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, preference_key) DO UPDATE SET
      preference_value = excluded.preference_value,
      updated_at = CURRENT_TIMESTAMP
  `)

  if (req.body.appearance) {
    if (!ownsItem(req.user.id, 'customization-suite')) return res.status(403).json({ error: 'Desbloquea Estudio de color para personalizar la interfaz.' })
    const appearance = {
      accent: allowedAccents.has(req.body.appearance.accent) ? req.body.appearance.accent : 'olive',
      surface: allowedSurfaces.has(req.body.appearance.surface) ? req.body.appearance.surface : 'ink',
      density: allowedDensities.has(req.body.appearance.density) ? req.body.appearance.density : 'comfortable',
    }
    save.run(req.user.id, 'appearance', JSON.stringify(appearance))
  }
  if (req.body.audio) {
    if (!ownsItem(req.user.id, 'sound-lab-pro')) return res.status(403).json({ error: 'Desbloquea Sound Lab Pro para guardar estos ajustes.' })
    const audio = {
      bassBoost: Math.max(0, Math.min(1, Number(req.body.audio.bassBoost || 0))),
      compression: Boolean(req.body.audio.compression),
      ambience: Math.max(0, Math.min(1, Number(req.body.audio.ambience || 0))),
    }
    save.run(req.user.id, 'audio', JSON.stringify(audio))
  }
  res.json({
    appearance: readPreference(req.user.id, 'appearance', DEFAULT_APPEARANCE),
    audio: readPreference(req.user.id, 'audio', DEFAULT_AUDIO),
  })
})

app.get('/api/shop', (req, res) => {
  const items = db.prepare(`
    SELECT
      s.*,
      CASE WHEN p.id IS NULL THEN 0 ELSE 1 END owned,
      CASE WHEN e.item_id IS NULL THEN 0 ELSE 1 END equipped
    FROM shop_items s
    LEFT JOIN purchases p ON p.item_id = s.id AND p.user_id = ? AND p.refunded_at IS NULL
    LEFT JOIN user_equipped_items e ON e.item_id = s.id AND e.user_id = ?
    WHERE s.active = 1
    ORDER BY s.price
  `).all(req.user.id, req.user.id).map(shopItemPayload)
  res.json(items)
})

app.post('/api/shop/checkout', async (req, res) => {
  const item = db.prepare('SELECT * FROM shop_items WHERE id = ? AND active = 1').get(req.body.itemId)
  const wallet = walletForUser(req.user.id)
  const currency = req.body.currency === 'money' ? 'money' : req.body.currency === 'points' ? 'points' : null
  if (!item) return res.status(404).json({ error: 'Artículo no encontrado.' })
  if (!currency) return res.status(400).json({ error: 'Elige Puntos o euros para completar la compra.' })
  if (ownsItem(req.user.id, item.id)) {
    return res.status(409).json({ error: 'Este artículo ya está desbloqueado.' })
  }
  if (currency === 'points' && wallet.points < item.price) {
    return res.status(400).json({ error: 'No tienes Puntos suficientes.' })
  }
  if (currency === 'money' && item.money_price_cents <= 0) {
    return res.status(400).json({ error: 'Este artículo no está disponible en euros.' })
  }

  // PAGO FICTICIO — no se procesa ni transmite ningún dato real.
  const payment = currency === 'money' ? paymentSummary(req.body.method, req.body.cardNumber) : null
  await new Promise((resolve) => setTimeout(resolve, currency === 'money' ? 900 : 320))
  const checkout = db.transaction(() => {
    if (currency === 'points') {
      db.prepare('UPDATE user_wallets SET notes = notes - ? WHERE user_id = ?').run(item.price, req.user.id)
    } else {
      db.prepare('INSERT INTO payment_profiles (user_id, method, brand, last4) VALUES (?, ?, ?, ?)').run(
        req.user.id,
        payment.method,
        payment.brand,
        payment.last4,
      )
    }
    const purchase = db.prepare(`
      INSERT INTO purchases (
        user_id, item_id, currency, notes_paid, money_paid_cents, payment_method, brand, last4
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      item.id,
      currency,
      currency === 'points' ? item.price : 0,
      currency === 'money' ? item.money_price_cents : 0,
      payment?.method || null,
      payment?.brand || null,
      payment?.last4 || null,
    )
    db.prepare(`
      INSERT INTO wallet_transactions (
        user_id, transaction_type, notes, money_cents, method, brand, last4, item_id, purchase_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      currency === 'points' ? 'purchase_points' : 'purchase_money',
      currency === 'points' ? -item.price : 0,
      currency === 'money' ? item.money_price_cents : 0,
      payment?.method || null,
      payment?.brand || null,
      payment?.last4 || null,
      item.id,
      purchase.lastInsertRowid,
    )
    recordUserActivity(req.user.id, 'shop_purchase', 'purchase', purchase.lastInsertRowid, {
      itemId: item.id,
      currency,
      points: currency === 'points' ? item.price : 0,
      moneyCents: currency === 'money' ? item.money_price_cents : 0,
    })
    return Number(purchase.lastInsertRowid)
  })
  const purchaseId = checkout()
  res.json({
    ok: true,
    purchaseId,
    unlocked: item.id,
    currency,
    wallet: walletForUser(req.user.id),
  })
})

app.put('/api/shop/equip', (req, res) => {
  const allowedSlots = new Set(['theme', 'coverFrame', 'visualizer', 'equalizerPreset', 'stationFx'])
  const slot = String(req.body.slot || '')
  const itemId = req.body.itemId == null ? null : String(req.body.itemId)
  if (!allowedSlots.has(slot)) return res.status(400).json({ error: 'Ranura de equipamiento no válida.' })

  if (!itemId) {
    db.prepare('DELETE FROM user_equipped_items WHERE user_id = ? AND slot = ?').run(req.user.id, slot)
    return res.json({ equipped: equippedItems(req.user.id) })
  }

  const item = db.prepare('SELECT * FROM shop_items WHERE id = ? AND active = 1').get(itemId)
  if (!item) return res.status(404).json({ error: 'Artículo no encontrado.' })
  if (item.slot !== slot) return res.status(400).json({ error: 'Este artículo no pertenece a esa ranura.' })
  if (!ownsItem(req.user.id, itemId)) return res.status(403).json({ error: 'Desbloquea el artículo antes de equiparlo.' })

  db.prepare(`
    INSERT INTO user_equipped_items (user_id, slot, item_id, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, slot) DO UPDATE SET
      item_id = excluded.item_id,
      updated_at = CURRENT_TIMESTAMP
  `).run(req.user.id, slot, itemId)
  recordUserActivity(req.user.id, 'shop_item_equipped', 'shop_item', itemId, { slot })
  res.json({ equipped: equippedItems(req.user.id) })
})

app.get('/api/shop/history', (req, res) => {
  const history = db.prepare(`
    SELECT
      wt.id,
      wt.transaction_type type,
      wt.notes points,
      wt.money_cents moneyCents,
      wt.method,
      wt.brand,
      wt.last4,
      wt.created_at createdAt,
      wt.item_id itemId,
      wt.purchase_id purchaseId,
      s.name itemName
    FROM wallet_transactions wt
    LEFT JOIN shop_items s ON s.id = wt.item_id
    WHERE wt.user_id = ?
    ORDER BY wt.created_at DESC, wt.id DESC
    LIMIT 100
  `).all(req.user.id)
  res.json(history)
})

app.get('/api/shop/purchases', (req, res) => {
  const purchases = db.prepare(`
    SELECT
      p.id,
      p.item_id itemId,
      s.name itemName,
      s.description,
      CASE WHEN p.currency = 'notes' THEN 'points' ELSE p.currency END currency,
      p.notes_paid pointsPaid,
      p.money_paid_cents moneyPaidCents,
      p.payment_method paymentMethod,
      p.brand,
      p.last4,
      p.purchased_at purchasedAt,
      datetime(p.purchased_at, '+7 days') refundableUntil,
      p.refunded_at refundedAt,
      CASE
        WHEN p.refunded_at IS NULL AND p.purchased_at >= datetime('now', '-7 days') THEN 1
        ELSE 0
      END canRefund
    FROM purchases p JOIN shop_items s ON s.id = p.item_id
    WHERE p.user_id = ?
    ORDER BY p.purchased_at DESC, p.id DESC
  `).all(req.user.id).map((purchase) => ({ ...purchase, canRefund: Boolean(purchase.canRefund) }))
  res.json(purchases)
})

app.post('/api/shop/purchases/:id/refund', async (req, res) => {
  const purchase = db.prepare(`
    SELECT p.*, s.name item_name, s.slot
    FROM purchases p JOIN shop_items s ON s.id = p.item_id
    WHERE p.id = ? AND p.user_id = ?
  `).get(req.params.id, req.user.id)
  if (!purchase) return res.status(404).json({ error: 'Compra no encontrada.' })
  if (purchase.refunded_at) return res.status(409).json({ error: 'Esta compra ya se restauró.' })
  const eligible = db.prepare(`SELECT ? >= datetime('now', '-7 days') eligible`).get(purchase.purchased_at).eligible
  if (!eligible) return res.status(400).json({ error: 'El plazo de restauración de 7 días ya ha terminado.' })

  await new Promise((resolve) => setTimeout(resolve, 500))
  db.transaction(() => {
    const update = db.prepare(`
      UPDATE purchases SET refunded_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND refunded_at IS NULL
    `).run(purchase.id, req.user.id)
    if (!update.changes) throw new Error('La compra ya no se puede restaurar.')
    db.prepare('DELETE FROM user_equipped_items WHERE user_id = ? AND item_id = ?').run(req.user.id, purchase.item_id)
    if (purchase.notes_paid > 0) {
      db.prepare('UPDATE user_wallets SET notes = notes + ? WHERE user_id = ?').run(purchase.notes_paid, req.user.id)
    }
    db.prepare(`
      INSERT INTO wallet_transactions (
        user_id, transaction_type, notes, money_cents, method, brand, last4, item_id, purchase_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      ['notes', 'points'].includes(purchase.currency) ? 'refund_points' : 'refund_money',
      purchase.notes_paid,
      purchase.money_paid_cents,
      purchase.payment_method,
      purchase.brand,
      purchase.last4,
      purchase.item_id,
      purchase.id,
    )
    recordUserActivity(req.user.id, 'purchase_refunded', 'purchase', purchase.id, {
      itemId: purchase.item_id,
      currency: purchase.currency,
      points: purchase.notes_paid,
      moneyCents: purchase.money_paid_cents,
    })
  })()
  res.json({
    ok: true,
    restored: purchase.item_id,
    refund: ['notes', 'points'].includes(purchase.currency)
      ? { currency: 'points', amount: purchase.notes_paid }
      : { currency: 'money', amountCents: purchase.money_paid_cents },
    wallet: walletForUser(req.user.id),
  })
})

app.post('/api/import', upload.array('files', 200), async (req, res) => {
  try {
    for (const file of req.files || []) {
      const safeName = path.basename(file.originalname).replace(/[^\p{L}\p{N}._ -]/gu, '_')
      const destination = path.join(importedDir, `${Date.now()}-${safeName}`)
      await fsp.rename(file.path, destination)
    }
    scanLibrary(importedDir).catch((error) => console.error('Importación:', error))
    res.status(202).json({ imported: req.files?.length || 0 })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist))
  app.get('*path', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')))
}

app.use((error, _req, res, _next) => {
  console.error(error)
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'El cuerpo JSON de la petición no es válido.' })
  }
  res.status(500).json({ error: error.message || 'Error interno.' })
})

app.listen(PORT, HOST, async () => {
  const network = await networkPayload()
  console.log(`Sonora Local está listo en http://localhost:${PORT}`)
  for (const url of network.localUrls) console.log(`Red local: ${url}`)
  for (const url of network.vpnUrls) console.log(`Red privada/VPN: ${url}`)
  if (network.remoteUrl) console.log(`Acceso remoto: ${network.remoteUrl}`)
})
