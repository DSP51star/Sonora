import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

export const dataDir = path.resolve(process.env.SONORA_DATA_DIR || path.join(process.cwd(), 'data'))
fs.mkdirSync(dataDir, { recursive: true })

export const db = new Database(path.join(dataDir, 'sonora.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'listener',
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_wallets (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    notes INTEGER NOT NULL DEFAULT 120,
    streak INTEGER NOT NULL DEFAULT 1,
    last_active TEXT
  );

  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    preference_key TEXT NOT NULL,
    preference_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, preference_key)
  );

  CREATE TABLE IF NOT EXISTS user_activity (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS custom_links (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('music', 'product', 'section', 'artist', 'album')),
    target_id TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT 'Artista desconocido',
    album TEXT NOT NULL DEFAULT 'Álbum desconocido',
    album_artist TEXT,
    year INTEGER,
    genre TEXT,
    duration REAL NOT NULL DEFAULT 0,
    bitrate INTEGER,
    sample_rate INTEGER,
    bit_depth INTEGER,
    channels INTEGER,
    codec TEXT,
    container TEXT,
    artwork_path TEXT,
    quality TEXT NOT NULL DEFAULT 'hi-res',
    favorite INTEGER NOT NULL DEFAULT 0,
    play_count INTEGER NOT NULL DEFAULT 0,
    last_played TEXT,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    bpm REAL,
    energy REAL,
    brightness REAL,
    dynamics REAL,
    auto_mood TEXT,
    manual_mood TEXT,
    analysis_status TEXT NOT NULL DEFAULT 'pending'
  );

  CREATE TABLE IF NOT EXISTS custom_styles (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
  );

  CREATE TABLE IF NOT EXISTS playlist_external_tracks (
    id INTEGER PRIMARY KEY,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    source_key TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_name TEXT NOT NULL,
    module_id TEXT NOT NULL,
    module_track_id TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT NOT NULL,
    year INTEGER,
    genre TEXT,
    duration REAL NOT NULL DEFAULT 0,
    bitrate INTEGER,
    sample_rate INTEGER,
    bit_depth INTEGER,
    channels INTEGER,
    codec TEXT,
    container TEXT,
    quality TEXT,
    artwork_url TEXT,
    stream_url TEXT NOT NULL,
    position INTEGER NOT NULL,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (playlist_id, source_key)
  );

  CREATE TABLE IF NOT EXISTS listening_history (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    playback_event_id TEXT,
    listened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    seconds REAL NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    mood_context TEXT
  );

  CREATE TABLE IF NOT EXISTS wallet (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    notes INTEGER NOT NULL DEFAULT 120,
    streak INTEGER NOT NULL DEFAULT 1,
    last_active TEXT
  );

  CREATE TABLE IF NOT EXISTS shop_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    price INTEGER NOT NULL,
    preview TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES shop_items(id),
    purchased_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    refunded_at TEXT
  );

  CREATE TABLE IF NOT EXISTS payment_profiles (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    brand TEXT,
    last4 TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS wallet_transactions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    transaction_type TEXT NOT NULL,
    notes INTEGER NOT NULL,
    method TEXT,
    brand TEXT,
    last4 TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS equipped_items (
    slot TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS app_preferences (
    preference_key TEXT PRIMARY KEY,
    preference_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS track_audio_profiles (
    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    analysis_version INTEGER NOT NULL,
    embedding TEXT NOT NULL,
    segment_embeddings TEXT NOT NULL,
    feature_summary TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS interaction_events (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    value REAL NOT NULL DEFAULT 1,
    session_id TEXT,
    recommendation_run_id TEXT,
    context TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS taste_profiles (
    scope TEXT PRIMARY KEY,
    positive_vector TEXT,
    negative_vector TEXT,
    positive_weight REAL NOT NULL DEFAULT 0,
    negative_weight REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS recommendation_runs (
    id TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    intent TEXT NOT NULL,
    context TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS recommendation_items (
    run_id TEXT NOT NULL REFERENCES recommendation_runs(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    total_score REAL NOT NULL,
    score_breakdown TEXT NOT NULL,
    explanation TEXT NOT NULL,
    outcome TEXT,
    PRIMARY KEY (run_id, track_id)
  );

  CREATE TABLE IF NOT EXISTS track_lyrics (
    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    source_name TEXT,
    content TEXT NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_track_lyrics (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    source_name TEXT,
    content TEXT NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, track_id)
  );

  CREATE TABLE IF NOT EXISTS artist_profiles (
    name TEXT PRIMARY KEY COLLATE NOCASE,
    birth_date TEXT,
    origin TEXT,
    biography TEXT,
    image_url TEXT,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS token_payments (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    amount_tokens REAL NOT NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    method TEXT NOT NULL,
    brand TEXT,
    last4 TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS token_usage (
    id INTEGER PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    cost REAL NOT NULL,
    full_cost REAL NOT NULL DEFAULT 0,
    listened_seconds REAL NOT NULL DEFAULT 0,
    completion_ratio REAL NOT NULL DEFAULT 0,
    file_size INTEGER NOT NULL DEFAULT 0,
    duration REAL NOT NULL DEFAULT 0,
    bitrate INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TEXT,
    payment_id INTEGER REFERENCES token_payments(id)
  );

  CREATE TABLE IF NOT EXISTS stream_token_usage (
    id INTEGER PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    module_id TEXT NOT NULL,
    module_track_id TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT,
    artwork_url TEXT,
    cost REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TEXT,
    payment_id INTEGER REFERENCES token_payments(id)
  );

  CREATE TABLE IF NOT EXISTS user_equipped_items (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot TEXT NOT NULL,
    item_id TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, slot)
  );

  CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id, expires_at);
  CREATE INDEX IF NOT EXISTS user_activity_recent ON user_activity(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS custom_links_recent ON custom_links(created_at DESC);
  CREATE INDEX IF NOT EXISTS interactions_track_date ON interaction_events(track_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS interactions_session ON interaction_events(session_id, created_at);
  CREATE INDEX IF NOT EXISTS recommendation_items_track ON recommendation_items(track_id);
  CREATE INDEX IF NOT EXISTS token_usage_pending ON token_usage(paid_at, created_at DESC);
  CREATE INDEX IF NOT EXISTS stream_token_usage_pending ON stream_token_usage(user_id, paid_at, created_at DESC);
  CREATE INDEX IF NOT EXISTS playlist_external_tracks_order ON playlist_external_tracks(playlist_id, position);
`)

function ensureCustomLinkTargetTypes() {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'custom_links'").get()
  if (!table?.sql || /'artist'/.test(table.sql)) return
  db.exec(`
    BEGIN;
    DROP INDEX IF EXISTS custom_links_recent;
    ALTER TABLE custom_links RENAME TO custom_links_legacy;
    CREATE TABLE custom_links (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK (target_type IN ('music', 'product', 'section', 'artist', 'album')),
      target_id TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO custom_links (id, code, label, target_type, target_id, created_by, created_at)
    SELECT id, code, label, target_type, target_id, created_by, created_at FROM custom_links_legacy;
    DROP TABLE custom_links_legacy;
    CREATE INDEX custom_links_recent ON custom_links(created_at DESC);
    COMMIT;
  `)
}

ensureCustomLinkTargetTypes()

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

ensureColumn('listening_history', 'session_id', 'TEXT')
ensureColumn('listening_history', 'recommendation_run_id', 'TEXT')
ensureColumn('listening_history', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE')
ensureColumn('listening_history', 'playback_event_id', 'TEXT')
ensureColumn('shop_items', 'money_price_cents', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('shop_items', 'slot', 'TEXT')
ensureColumn('shop_items', 'config_json', "TEXT NOT NULL DEFAULT '{}'")
ensureColumn('shop_items', 'active', 'INTEGER NOT NULL DEFAULT 1')
ensureColumn('purchases', 'currency', "TEXT NOT NULL DEFAULT 'notes'")
ensureColumn('purchases', 'notes_paid', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('purchases', 'money_paid_cents', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('purchases', 'payment_method', 'TEXT')
ensureColumn('purchases', 'brand', 'TEXT')
ensureColumn('purchases', 'last4', 'TEXT')
ensureColumn('purchases', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE')
ensureColumn('purchases', 'refunded_at', 'TEXT')
ensureColumn('payment_profiles', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE')
ensureColumn('wallet_transactions', 'money_cents', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('wallet_transactions', 'item_id', 'TEXT')
ensureColumn('wallet_transactions', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE')
ensureColumn('wallet_transactions', 'purchase_id', 'INTEGER REFERENCES purchases(id) ON DELETE SET NULL')
ensureColumn('interaction_events', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE')
ensureColumn('recommendation_runs', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE')
ensureColumn('token_payments', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE')
ensureColumn('token_payments', 'amount_cents', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('token_usage', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE')
ensureColumn('token_usage', 'full_cost', 'REAL NOT NULL DEFAULT 0')
ensureColumn('token_usage', 'listened_seconds', 'REAL NOT NULL DEFAULT 0')
ensureColumn('token_usage', 'completion_ratio', 'REAL NOT NULL DEFAULT 0')
ensureColumn('playlists', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE')
ensureColumn('tracks', 'channels', 'INTEGER')
ensureColumn('tracks', 'style', 'TEXT')
ensureColumn('tracks', 'artwork_url', 'TEXT')
ensureColumn('users', 'role', "TEXT NOT NULL DEFAULT 'listener'")

// Las primeras versiones guardaban los estilos personalizados como ambientes
// manuales. Se separan sin perder las selecciones que ya hizo el usuario.
const hasLegacyCustomMoods = db.prepare(`
  SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'custom_moods'
`).get()
if (hasLegacyCustomMoods) {
  db.exec(`
    INSERT OR IGNORE INTO custom_styles (name, created_at)
    SELECT name, created_at FROM custom_moods;
    UPDATE tracks
    SET style = manual_mood, manual_mood = NULL
    WHERE manual_mood IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM custom_moods legacy
        WHERE legacy.name = tracks.manual_mood COLLATE NOCASE
      );
  `)
}

// La calidad es una promesa del servicio, no una clasificación del archivo.
db.prepare("UPDATE tracks SET quality = 'hi-res' WHERE quality <> 'hi-res'").run()

db.exec(`
  DROP INDEX IF EXISTS purchases_item_id_unique;
  CREATE UNIQUE INDEX IF NOT EXISTS purchases_user_item_unique
    ON purchases(user_id, item_id)
    WHERE user_id IS NOT NULL AND refunded_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS listening_history_playback_unique
    ON listening_history(user_id, playback_event_id)
    WHERE user_id IS NOT NULL AND playback_event_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS listening_history_user_recent ON listening_history(user_id, listened_at DESC);
  CREATE INDEX IF NOT EXISTS token_usage_user_pending ON token_usage(user_id, paid_at, created_at DESC);
`)

db.prepare('INSERT OR IGNORE INTO wallet (id, notes, streak) VALUES (1, 120, 1)').run()

const seedShopItem = db.prepare(`
  INSERT INTO shop_items (
    id, name, description, category, price, money_price_cents, preview, slot, config_json, active
  ) VALUES (
    @id, @name, @description, @category, @price, @moneyPriceCents, @preview, @slot, @configJson, 1
  )
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    price = excluded.price,
    money_price_cents = excluded.money_price_cents,
    preview = excluded.preview,
    slot = excluded.slot,
    config_json = excluded.config_json,
    active = 1
`);

[
  { id: 'eq-night', name: 'EQ Sesión nocturna', description: 'Un preset cálido que suaviza agudos y da cuerpo a escuchas largas.', category: 'Sonido', price: 55, moneyPriceCents: 79, preview: 'eq', slot: 'equalizerPreset', configJson: JSON.stringify({ eq: [4, 3, 2, 1, 0, -1, -2, -3, -4] }) },
  { id: 'frame-studio', name: 'Marco estudio', description: 'Aluminio oscuro, profundidad física y detalle de tornillos para cada carátula.', category: 'Carátulas', price: 70, moneyPriceCents: 99, preview: 'studio', slot: 'coverFrame', configJson: JSON.stringify({ frame: 'studio' }) },
  { id: 'visualizer-ribbon', name: 'Cinta magnética', description: 'Convierte el espectro en una cinta continua que respira con la mezcla.', category: 'Visualizadores', price: 95, moneyPriceCents: 129, preview: 'ribbon', slot: 'visualizer', configJson: JSON.stringify({ visualizer: 'ribbon' }) },
  { id: 'customization-suite', name: 'Estudio de color', description: 'Paletas, tonos de superficie y densidad a tu gusto.', category: 'Personalización', price: 160, moneyPriceCents: 199, preview: 'palette', slot: null, configJson: JSON.stringify({ panel: 'appearance' }) },
  { id: 'theme-ink', name: 'Tinta profunda', description: 'Un tema negro absoluto que hace flotar carátulas, controles y espectros.', category: 'Temas', price: 180, moneyPriceCents: 229, preview: 'ink', slot: 'theme', configJson: JSON.stringify({ theme: 'deep-ink' }) },
  { id: 'theme-liquid-glass', name: 'Liquid Glass', description: 'Una capa de cristal líquido premium para toda Sonora: profundidad, refracción y luz contenida, siempre reversible.', category: 'Temas', price: 4285, moneyPriceCents: 5999, preview: 'glass', slot: 'theme', configJson: JSON.stringify({ theme: 'liquid-glass' }) },
  { id: 'visualizer-aurora', name: 'Aurora espectral', description: 'Capas de luz y partículas que se abren con cada banda de frecuencia.', category: 'Visualizadores', price: 210, moneyPriceCents: 269, preview: 'aurora', slot: 'visualizer', configJson: JSON.stringify({ visualizer: 'aurora' }) },
  { id: 'effects-constellation', name: 'Constelación', description: 'Una variante cósmica para las estaciones con trazas, estrellas y órbitas.', category: 'Efectos', price: 220, moneyPriceCents: 279, preview: 'constellation', slot: 'stationFx', configJson: JSON.stringify({ stationFx: 'constellation' }) },
  { id: 'sound-lab-pro', name: 'Sound Lab Pro', description: 'Graves, compresión dinámica y ambiente de sala.', category: 'Sonido', price: 240, moneyPriceCents: 299, preview: 'soundlab', slot: null, configJson: JSON.stringify({ panel: 'audio' }) },
].forEach((item) => seedShopItem.run(item))

// Bento Studio fue una incorporación temporal. Se retira de instalaciones
// existentes y se devuelven los Puntos de cualquier compra activa antes de
// borrar sus registros; el resto del catálogo permanece intacto.
db.transaction(() => {
  const retiredItemId = 'theme-apple-bento'
  const refunds = db.prepare(`
    SELECT user_id userId, SUM(notes_paid) points
    FROM purchases
    WHERE item_id = ?
      AND refunded_at IS NULL
      AND currency IN ('notes', 'points')
      AND notes_paid > 0
    GROUP BY user_id
  `).all(retiredItemId)
  for (const refund of refunds) {
    if (refund.userId == null) db.prepare('UPDATE wallet SET notes = notes + ? WHERE id = 1').run(refund.points)
    else db.prepare('UPDATE user_wallets SET notes = notes + ? WHERE user_id = ?').run(refund.points, refund.userId)
  }

  const purchases = db.prepare('SELECT id FROM purchases WHERE item_id = ?').all(retiredItemId)
  for (const purchase of purchases) {
    db.prepare("DELETE FROM user_activity WHERE entity_type = 'purchase' AND entity_id = ?").run(String(purchase.id))
  }
  db.prepare("DELETE FROM user_activity WHERE entity_type = 'shop_item' AND entity_id = ?").run(retiredItemId)
  db.prepare('DELETE FROM user_equipped_items WHERE item_id = ?').run(retiredItemId)
  db.prepare('DELETE FROM equipped_items WHERE item_id = ?').run(retiredItemId)
  db.prepare('DELETE FROM wallet_transactions WHERE item_id = ?').run(retiredItemId)
  db.prepare('DELETE FROM purchases WHERE item_id = ?').run(retiredItemId)
  db.prepare('DELETE FROM shop_items WHERE id = ?').run(retiredItemId)
})()

db.prepare(`
  UPDATE shop_items SET active = 0
  WHERE id IN ('cursor-orbit', 'cursor-prism', 'icon-pack-imbox')
`).run()
db.prepare("DELETE FROM equipped_items WHERE slot = 'cursor'").run()

db.prepare(`
  INSERT OR IGNORE INTO app_preferences (preference_key, preference_value)
  VALUES ('appearance', ?)
`).run(JSON.stringify({ accent: 'olive', surface: 'ink', density: 'comfortable' }))

db.prepare(`
  INSERT OR IGNORE INTO app_preferences (preference_key, preference_value)
  VALUES ('audio', ?)
`).run(JSON.stringify({ bassBoost: 0, compression: false, ambience: 0 }))

function fileSizeForPath(filePath) {
  try {
    return fs.statSync(filePath).size
  } catch {
    return 0
  }
}

export function tokenCostForTrack(row) {
  if (!row) return 0
  const fileSize = Number(row.file_size || fileSizeForPath(row.path))
  const duration = Number(row.duration || 0)
  const bitrate = Number(row.bitrate || 0)
  if (!fileSize && !duration && !bitrate) return 0

  // La referencia acordada pondera por igual 20,6 MB, 3:31 y 817 kbps = 1,4 tokens.
  const normalized = (
    fileSize / 20_600_000
    + duration / 211
    + bitrate / 817_000
  ) / 3
  return Math.max(0.1, Math.round(normalized * 14) / 10)
}

export const TOKEN_EURO_CENTS_PER_1000 = 1400
export const MODULE_STREAM_EURO_CENTS = 18
export const MODULE_STREAM_TOKEN_COST = Math.round(MODULE_STREAM_EURO_CENTS * 1000 / TOKEN_EURO_CENTS_PER_1000 * 100) / 100

export function tokenPriceCents(tokens) {
  return Math.max(0, Math.round(Number(tokens || 0) * TOKEN_EURO_CENTS_PER_1000 / 1000))
}

export function rowToTrack(row) {
  if (!row) return null
  const fileSize = fileSizeForPath(row.path)
  return {
    ...row,
    favorite: Boolean(row.favorite),
    fileSize,
    tokenCost: tokenCostForTrack({ ...row, file_size: fileSize }),
    location: row.path,
    artworkUrl: row.artwork_path ? `/api/tracks/${row.id}/artwork` : row.artwork_url || null,
    streamUrl: `/api/tracks/${row.id}/stream`,
    mood: row.manual_mood || row.auto_mood || 'Sin analizar',
  }
}
