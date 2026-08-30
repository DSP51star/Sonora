import crypto from 'node:crypto'
import { db, rowToTrack } from './db.js'

export const ANALYSIS_VERSION = 2

const INTENTS = new Set(['flow', 'focus', 'unwind', 'move', 'discover'])
const POSITIVE_EVENTS = new Map([
  ['completed', 1.2],
  ['favorite', 3],
  ['playlist_add', 2.4],
  ['queue_add', 1.4],
  ['replay', 2],
  ['search_play', 1.1],
])
const NEGATIVE_EVENTS = new Map([
  ['skip_early', 2.2],
  ['skip_late', 0.7],
  ['queue_remove', 1.4],
  ['unfavorite', 0.8],
])

function safeParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value || 0)))
}

function dot(left, right) {
  const length = Math.min(left?.length || 0, right?.length || 0)
  let total = 0
  for (let index = 0; index < length; index += 1) total += left[index] * right[index]
  return total
}

function magnitude(vector) {
  return Math.sqrt(dot(vector, vector))
}

export function cosine(left, right) {
  if (!left?.length || !right?.length) return 0
  const denominator = magnitude(left) * magnitude(right)
  return denominator ? dot(left, right) / denominator : 0
}

function similarity(left, right) {
  return clamp((cosine(left, right) + 1) / 2)
}

function weightedMean(current, currentWeight, incoming, incomingWeight) {
  if (!incoming?.length || incomingWeight <= 0) return current
  if (!current?.length || currentWeight <= 0) return [...incoming]
  const total = currentWeight + incomingWeight
  return incoming.map((value, index) => (
    ((current[index] || 0) * currentWeight + value * incomingWeight) / total
  ))
}

function averageVectors(items) {
  if (!items.length) return []
  const length = Math.max(...items.map((item) => item.vector.length))
  const result = Array.from({ length }, () => 0)
  let totalWeight = 0
  for (const { vector, weight } of items) {
    for (let index = 0; index < length; index += 1) result[index] += (vector[index] || 0) * weight
    totalWeight += weight
  }
  return totalWeight ? result.map((value) => value / totalWeight) : []
}

function timeScope(date = new Date()) {
  const hour = date.getHours()
  if (hour < 6) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  if (hour < 23) return 'evening'
  return 'night'
}

function deterministicNoise(key) {
  const bytes = crypto.createHash('sha1').update(String(key)).digest()
  return bytes.readUInt32BE(0) / 0xffffffff
}

function parseProfile(row) {
  if (!row) return null
  return {
    positive: safeParse(row.positive_vector, []),
    negative: safeParse(row.negative_vector, []),
    positiveWeight: row.positive_weight,
    negativeWeight: row.negative_weight,
    updatedAt: row.updated_at,
  }
}

function decayedProfile(profile, scope, now = new Date()) {
  if (!profile?.updatedAt || scope === 'general') return profile
  const updatedAt = new Date(`${profile.updatedAt}Z`)
  const ageDays = Math.max(0, (now - updatedAt) / 86_400_000)
  const halfLifeDays = scope === 'recent' ? 14 : 120
  const factor = 0.5 ** (ageDays / halfLifeDays)
  return {
    ...profile,
    positiveWeight: profile.positiveWeight * factor,
    negativeWeight: profile.negativeWeight * factor,
  }
}

function updateTasteProfile(scope, embedding, eventType, rawWeight = 1) {
  const positiveFactor = POSITIVE_EVENTS.get(eventType)
  const negativeFactor = NEGATIVE_EVENTS.get(eventType)
  if (!positiveFactor && !negativeFactor) return
  const row = db.prepare('SELECT * FROM taste_profiles WHERE scope = ?').get(scope)
  const profile = decayedProfile(parseProfile(row), scope) || {
    positive: [],
    negative: [],
    positiveWeight: 0,
    negativeWeight: 0,
  }
  const boundedWeight = clamp(rawWeight, 0.1, 4)

  if (positiveFactor) {
    const weight = positiveFactor * boundedWeight
    profile.positive = weightedMean(profile.positive, profile.positiveWeight, embedding, weight)
    profile.positiveWeight += weight
  }
  if (negativeFactor) {
    const weight = negativeFactor * boundedWeight
    profile.negative = weightedMean(profile.negative, profile.negativeWeight, embedding, weight)
    profile.negativeWeight += weight
  }

  db.prepare(`
    INSERT INTO taste_profiles (
      scope, positive_vector, negative_vector, positive_weight, negative_weight, updated_at
    ) VALUES (
      @scope, @positive, @negative, @positiveWeight, @negativeWeight, CURRENT_TIMESTAMP
    )
    ON CONFLICT(scope) DO UPDATE SET
      positive_vector = excluded.positive_vector,
      negative_vector = excluded.negative_vector,
      positive_weight = excluded.positive_weight,
      negative_weight = excluded.negative_weight,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    scope,
    positive: JSON.stringify(profile.positive),
    negative: JSON.stringify(profile.negative),
    positiveWeight: profile.positiveWeight,
    negativeWeight: profile.negativeWeight,
  })
}

export function recordInteraction({
  userId,
  trackId,
  eventType,
  value = 1,
  sessionId = null,
  recommendationRunId = null,
  context = {},
}) {
  const profile = db.prepare('SELECT embedding FROM track_audio_profiles WHERE track_id = ?').get(trackId)
  db.prepare(`
    INSERT INTO interaction_events (
      user_id, track_id, event_type, value, session_id, recommendation_run_id, context
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId || null, trackId, eventType, value, sessionId, recommendationRunId, JSON.stringify(context || {}))

  if (recommendationRunId) {
    const outcome = NEGATIVE_EVENTS.has(eventType) ? 'skipped' : POSITIVE_EVENTS.has(eventType) ? 'accepted' : eventType
    db.prepare(`
      UPDATE recommendation_items SET outcome = ?
      WHERE run_id = ? AND track_id = ?
    `).run(outcome, recommendationRunId, trackId)
  }

  if (!profile?.embedding) return
  const embedding = safeParse(profile.embedding, [])
  const now = new Date()
  const scopes = ['general', 'recent', `time:${timeScope(now)}`]
  if (context?.intent && INTENTS.has(context.intent)) scopes.push(`intent:${context.intent}`)
  scopes.forEach((scope) => updateTasteProfile(`user:${userId}:${scope}`, embedding, eventType, value))
}

function candidateRows(userId) {
  return db.prepare(`
    SELECT
      t.*,
      p.embedding,
      p.segment_embeddings,
      p.feature_summary,
      COALESCE(h.completes, 0) completes,
      COALESCE(h.skips, 0) skips,
      COALESCE(h.listens, 0) listens,
      h.last_listened,
      COALESCE(pl.playlist_adds, 0) playlist_adds,
      COALESCE(ix.positive_weight, 0) positive_events,
      COALESCE(ix.negative_weight, 0) negative_events,
      COALESCE(ix.early_skips, 0) early_skips,
      COALESCE(ix.late_skips, 0) late_skips,
      COALESCE(ix.replays, 0) replays,
      ix.last_interaction
    FROM tracks t
    JOIN track_audio_profiles p ON p.track_id = t.id
    LEFT JOIN (
      SELECT track_id, SUM(completed) completes, SUM(skipped) skips,
        COUNT(*) listens, MAX(listened_at) last_listened
      FROM listening_history WHERE user_id = ? GROUP BY track_id
    ) h ON h.track_id = t.id
    LEFT JOIN (
      SELECT pt.track_id, COUNT(*) playlist_adds
      FROM playlist_tracks pt JOIN playlists owner ON owner.id = pt.playlist_id
      WHERE owner.user_id = ? GROUP BY pt.track_id
    ) pl ON pl.track_id = t.id
    LEFT JOIN (
      SELECT
        track_id,
        SUM(CASE event_type
          WHEN 'favorite' THEN 3.0
          WHEN 'playlist_add' THEN 2.4
          WHEN 'replay' THEN 2.0
          WHEN 'queue_add' THEN 1.4
          WHEN 'completed' THEN 1.2
          WHEN 'search_play' THEN 1.1
          ELSE 0 END * value) positive_weight,
        SUM(CASE event_type
          WHEN 'skip_early' THEN 2.2
          WHEN 'queue_remove' THEN 1.4
          WHEN 'unfavorite' THEN 0.8
          WHEN 'skip_late' THEN 0.7
          ELSE 0 END * value) negative_weight,
        SUM(CASE WHEN event_type = 'skip_early' THEN value ELSE 0 END) early_skips,
        SUM(CASE WHEN event_type = 'skip_late' THEN value ELSE 0 END) late_skips,
        SUM(CASE WHEN event_type = 'replay' THEN value ELSE 0 END) replays,
        MAX(created_at) last_interaction
      FROM interaction_events
      WHERE user_id = ?
      GROUP BY track_id
    ) ix ON ix.track_id = t.id
    WHERE p.analysis_version = ?
  `).all(userId, userId, userId, ANALYSIS_VERSION).map((row) => ({
    ...row,
    embeddingVector: safeParse(row.embedding, []),
    segments: safeParse(row.segment_embeddings, []),
    features: safeParse(row.feature_summary, {}),
  }))
}

function storedProfiles(userId, intent, now) {
  const scopes = ['general', 'recent', `time:${timeScope(now)}`, `intent:${intent}`]
  const storedScopes = scopes.map((scope) => `user:${userId}:${scope}`)
  const rows = db.prepare(`SELECT * FROM taste_profiles WHERE scope IN (${storedScopes.map(() => '?').join(',')})`).all(...storedScopes)
  return Object.fromEntries(rows.map((row) => {
    const scope = row.scope.replace(`user:${userId}:`, '')
    return [scope, decayedProfile(parseProfile(row), scope, now)]
  }))
}

function bootstrapProfile(candidates) {
  const positive = []
  const negative = []
  for (const candidate of candidates) {
    const completionWeight = candidate.completes * 1.2
    const favoriteWeight = candidate.favorite ? 3 : 0
    const playlistWeight = candidate.playlist_adds * 2
    if (completionWeight + favoriteWeight + playlistWeight > 0) {
      positive.push({ vector: candidate.embeddingVector, weight: completionWeight + favoriteWeight + playlistWeight })
    }
    if (candidate.skips > 0) negative.push({ vector: candidate.embeddingVector, weight: candidate.skips })
  }
  return {
    positive: averageVectors(positive),
    negative: averageVectors(negative),
    library: averageVectors(candidates.map((candidate) => ({ vector: candidate.embeddingVector, weight: 1 }))),
    positiveWeight: positive.reduce((sum, item) => sum + item.weight, 0),
    negativeWeight: negative.reduce((sum, item) => sum + item.weight, 0),
  }
}

function tasteExemplars(candidates, now) {
  const positive = []
  const negative = []
  for (const candidate of candidates) {
    const fallbackPositive = candidate.completes * 1.2 + (candidate.favorite ? 3 : 0) + candidate.playlist_adds * 2.4
    const fallbackNegative = candidate.skips * 0.9
    const ageDays = candidate.last_interaction
      ? Math.max(0, (now - new Date(`${candidate.last_interaction}Z`)) / 86_400_000)
      : 180
    const recency = 0.35 + 0.65 * (0.5 ** (ageDays / 90))
    const positiveScore = Math.max(Number(candidate.positive_events || 0), fallbackPositive) * recency
    const negativeScore = Math.max(Number(candidate.negative_events || 0), fallbackNegative) * recency
    if (positiveScore >= 0.5) positive.push({ id: candidate.id, vector: candidate.embeddingVector, weight: positiveScore })
    if (negativeScore >= 0.5) negative.push({ id: candidate.id, vector: candidate.embeddingVector, weight: negativeScore })
  }
  return {
    positive: positive.sort((left, right) => right.weight - left.weight).slice(0, 18),
    negative: negative.sort((left, right) => right.weight - left.weight).slice(0, 12),
  }
}

function nearestExemplar(candidate, examples) {
  const neighbors = examples
    .filter((example) => example.id !== candidate.id)
    .map((example) => ({ ...example, similarity: similarity(candidate.embeddingVector, example.vector) }))
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 3)
  if (!neighbors.length) return null
  const totalWeight = neighbors.reduce((sum, item) => sum + Math.log2(item.weight + 2), 0)
  return totalWeight
    ? neighbors.reduce((sum, item) => sum + item.similarity * Math.log2(item.weight + 2), 0) / totalWeight
    : null
}

function tasteAffinity(candidate, taste, exemplars) {
  const centroidPositive = taste.positive?.length ? similarity(candidate.embeddingVector, taste.positive) : 0.5
  const centroidNegative = taste.negative?.length ? similarity(candidate.embeddingVector, taste.negative) : 0
  const neighborPositive = nearestExemplar(candidate, exemplars.positive)
  const neighborNegative = nearestExemplar(candidate, exemplars.negative)
  const directPositive = clamp(Number(candidate.positive_events || 0) / 8)
  const directNegative = clamp(Number(candidate.negative_events || 0) / 6)
  const positive = centroidPositive * 0.48 + (neighborPositive ?? centroidPositive) * 0.37 + directPositive * 0.15
  const negative = centroidNegative * 0.45 + (neighborNegative ?? centroidNegative) * 0.4 + directNegative * 0.15
  return {
    affinity: clamp(positive - negative * 0.55),
    positiveSimilarity: centroidPositive,
    negativeSimilarity: centroidNegative,
    neighborAffinity: neighborPositive ?? centroidPositive,
    neighborRejection: neighborNegative ?? centroidNegative,
    directPreference: clamp(directPositive - directNegative),
    preferenceConfidence: clamp((taste.positiveWeight + taste.negativeWeight + exemplars.positive.length + exemplars.negative.length) / 36),
  }
}

function combinedTaste(profiles, fallback, intent, now) {
  const weightedProfiles = [
    { profile: profiles.general, weight: 0.46 },
    { profile: profiles.recent, weight: 0.26 },
    { profile: profiles[`time:${timeScope(now)}`], weight: 0.16 },
    { profile: profiles[`intent:${intent}`], weight: 0.12 },
  ].filter((item) => item.profile?.positive?.length)
  if (!weightedProfiles.length) return fallback
  return {
    positive: averageVectors(weightedProfiles.map(({ profile, weight }) => ({
      vector: profile.positive,
      weight: weight * Math.log2(profile.positiveWeight + 2),
    }))),
    negative: averageVectors(weightedProfiles
      .filter(({ profile }) => profile.negative?.length)
      .map(({ profile, weight }) => ({
        vector: profile.negative,
        weight: weight * Math.log2(profile.negativeWeight + 2),
      }))),
    positiveWeight: weightedProfiles.reduce((sum, { profile }) => sum + profile.positiveWeight, 0),
    negativeWeight: weightedProfiles.reduce((sum, { profile }) => sum + profile.negativeWeight, 0),
  }
}

function intentTarget(intent, position, length) {
  const progress = length <= 1 ? 0 : position / (length - 1)
  const arc = progress < 0.7 ? progress / 0.7 : 1 - ((progress - 0.7) / 0.3) * 0.38
  const targets = {
    flow: { energy: 0.5 + arc * 0.16, tempo: 0.52 + arc * 0.09, dynamics: 0.42 },
    focus: { energy: 0.34 + arc * 0.08, tempo: 0.43, dynamics: 0.24 },
    unwind: { energy: 0.3 - progress * 0.09, tempo: 0.4 - progress * 0.05, dynamics: 0.28 },
    move: { energy: 0.68 + arc * 0.2, tempo: 0.67 + arc * 0.12, dynamics: 0.56 },
    discover: { energy: 0.48 + arc * 0.17, tempo: 0.51 + arc * 0.12, dynamics: 0.5 },
  }
  return targets[intent] || targets.flow
}

function featureFit(candidate, target) {
  const features = candidate.features
  const tempo = clamp((features.bpm || candidate.bpm || 100) / 190)
  const energy = clamp(features.energy ?? candidate.energy ?? 0.5)
  const dynamics = clamp(features.dynamics ?? candidate.dynamics ?? 0.4)
  const distance = (
    Math.abs(energy - target.energy) * 0.48 +
    Math.abs(tempo - target.tempo) * 0.3 +
    Math.abs(dynamics - target.dynamics) * 0.22
  )
  return clamp(1 - distance)
}

function transitionFit(previous, candidate, target) {
  if (!previous) return 0.62
  const previousEnding = previous.segments?.at(-1)?.embedding || previous.embeddingVector
  const candidateOpening = candidate.segments?.[0]?.embedding || candidate.embeddingVector
  const sonic = similarity(previousEnding, candidateOpening)
  const energyDelta = Math.abs(
    clamp(previous.features.energy ?? previous.energy ?? 0.5) -
    clamp(candidate.features.energy ?? candidate.energy ?? 0.5)
  )
  const tempoDelta = Math.abs(
    clamp((previous.features.bpm || previous.bpm || 100) / 190) -
    clamp((candidate.features.bpm || candidate.bpm || 100) / 190)
  )
  const continuity = clamp(1 - energyDelta * 0.65 - tempoDelta * 0.35)
  const targetDirection = featureFit(candidate, target)
  return clamp(sonic * 0.48 + continuity * 0.32 + targetDirection * 0.2)
}

function exposurePenalty(candidate, now) {
  if (!candidate.last_listened) return 0
  const hours = Math.max(0, (now - new Date(`${candidate.last_listened}Z`)) / 3_600_000)
  if (hours < 2) return 1
  if (hours < 24) return 0.72
  if (hours < 24 * 7) return 0.34
  if (hours < 24 * 30) return 0.12
  return 0
}

function normalizedCredit(value) {
  const normalized = String(value || '').trim().toLocaleLowerCase('es')
  if (!normalized || normalized === 'artista desconocido' || normalized === 'álbum desconocido') return null
  return normalized
}

function recentFatigue(userId) {
  const rows = db.prepare(`
    SELECT t.artist, t.album, h.listened_at listenedAt
    FROM listening_history h
    JOIN tracks t ON t.id = h.track_id
    WHERE h.user_id = ?
    ORDER BY h.listened_at DESC, h.id DESC
    LIMIT 32
  `).all(userId)
  const artists = new Map()
  const albums = new Map()
  rows.forEach((row, index) => {
    const weight = index < 3 ? 1 : index < 8 ? 0.62 : index < 16 ? 0.32 : 0.14
    const artist = normalizedCredit(row.artist)
    const album = normalizedCredit(row.album)
    if (artist) artists.set(artist, Math.max(artists.get(artist) || 0, weight))
    if (album) albums.set(album, Math.max(albums.get(album) || 0, weight))
  })
  return { artists, albums }
}

function metadataKey(value) {
  return String(value || '').trim().toLocaleLowerCase('es')
}

function genreLabels(value) {
  return [...new Set(String(value || '')
    .split(/[,;|]+/)
    .map((label) => label.trim())
    .filter(Boolean))]
}

function metadataPreferences(userId) {
  const rows = db.prepare(`
    SELECT t.style, t.genre, t.manual_mood manualMood, t.auto_mood autoMood,
      t.duration, h.seconds, h.completed, h.skipped
    FROM listening_history h
    JOIN tracks t ON t.id = h.track_id
    WHERE h.user_id = ?
  `).all(userId)
  const accumulated = { style: new Map(), genre: new Map(), mood: new Map() }
  const add = (category, label, row) => {
    const key = metadataKey(label)
    if (!key) return
    const current = accumulated[category].get(key) || { positive: 0, negative: 0, observations: 0 }
    const completionRatio = Number(row.duration || 0) > 0 ? clamp(Number(row.seconds || 0) / Number(row.duration)) : 0
    current.positive += row.completed ? 2 : completionRatio
    current.negative += row.skipped ? 2 : 0
    current.observations += 1
    accumulated[category].set(key, current)
  }
  for (const row of rows) {
    add('style', row.style, row)
    genreLabels(row.genre).forEach((genre) => add('genre', genre, row))
    add('mood', row.manualMood || row.autoMood, row)
  }
  const finalize = (source) => new Map([...source].map(([key, value]) => {
    const confidence = clamp(value.observations / 8)
    const observedAffinity = (value.positive + 1) / (value.positive + value.negative + 2)
    return [key, {
      affinity: 0.5 + (observedAffinity - 0.5) * confidence,
      confidence,
    }]
  }))
  return {
    style: finalize(accumulated.style),
    genre: finalize(accumulated.genre),
    mood: finalize(accumulated.mood),
  }
}

function strongestPreference(preferences, labels) {
  const matches = labels.map((label) => preferences.get(metadataKey(label))).filter(Boolean)
  if (!matches.length) return { affinity: 0.5, confidence: 0 }
  return matches.sort((left, right) => (right.confidence - left.confidence) || (right.affinity - left.affinity))[0]
}

function selectedCreditFatigue(candidate, selected) {
  const artist = normalizedCredit(candidate.artist)
  const album = normalizedCredit(candidate.album)
  const recentSelection = selected.slice(-4)
  return {
    artist: artist && recentSelection.some((track) => normalizedCredit(track.artist) === artist) ? 1 : 0,
    album: album && recentSelection.some((track) => normalizedCredit(track.album) === album) ? 1 : 0,
  }
}

function banditValue(candidate, totalInteractions, exploration, runId) {
  const successes = candidate.completes + (candidate.favorite ? 2 : 0)
  const failures = candidate.skips
  const observations = successes + failures
  const posteriorMean = (successes + 1) / (observations + 2)
  const uncertainty = Math.sqrt(Math.log(totalInteractions + 2) / (observations + 1))
  const jitter = deterministicNoise(`${runId}:${candidate.id}`) * 0.06
  return clamp(posteriorMean + uncertainty * exploration * 0.26 + jitter)
}

function maxRecentSimilarity(candidate, tracks, limit = 4) {
  if (!tracks.length) return 0
  return Math.max(...tracks.slice(-limit).map((track) => similarity(candidate.embeddingVector, track.embeddingVector)))
}

function explanationFor(breakdown, intent, coldStart) {
  const signals = []
  if (breakdown.styleMatch) {
    signals.push({
      signal: 'same_style',
      text: `Prioridad alta: comparte el estilo ${breakdown.styleName}.`,
      strength: breakdown.metadataPriority,
    })
  } else if (breakdown.genreMatch) {
    signals.push({
      signal: 'same_genre',
      text: `Prioridad media: comparte el género ${breakdown.genreMatch}.`,
      strength: breakdown.metadataPriority,
    })
  } else if (breakdown.moodMatch) {
    signals.push({
      signal: 'same_mood',
      text: `Mantiene el ambiente ${breakdown.moodName}.`,
      strength: breakdown.metadataPriority,
    })
  }
  if (coldStart && signals.length < 2) {
    signals.push({
      signal: 'representative_audio',
      text: 'Representa una región sonora distinta de tu biblioteca.',
      strength: breakdown.novelty,
    })
  } else if (breakdown.directPreference >= 0.4 && signals.length < 2) {
    signals.push({
      signal: 'known_preference',
      text: 'Ya has dado señales claras de que esta canción te interesa.',
      strength: breakdown.directPreference,
    })
  } else if (breakdown.neighborAffinity >= 0.7 && signals.length < 2) {
    signals.push({
      signal: 'taste_neighborhood',
      text: 'Se parece a uno de tus grupos de escucha favoritos, sin reducir tu gusto a un único promedio.',
      strength: breakdown.neighborAffinity,
    })
  } else if (breakdown.affinity >= 0.62 && signals.length < 2) {
    signals.push({
      signal: 'taste_affinity',
      text: 'Su firma sonora encaja con canciones que sueles terminar o guardar.',
      strength: breakdown.affinity,
    })
  }
  if (breakdown.categoryConfidence >= 0.25 && breakdown.categoryAffinity >= 0.58 && signals.length < 2) {
    signals.push({
      signal: 'metadata_affinity',
      text: 'Tu historial responde bien a esta combinación de estilo, género y ambiente.',
      strength: breakdown.categoryAffinity,
    })
  }
  if (breakdown.transition >= 0.68) {
    signals.push({
      signal: 'transition',
      text: 'Continúa la textura y el pulso actuales sin repetir la misma sensación.',
      strength: breakdown.transition,
    })
  }
  if (breakdown.context >= 0.7) {
    const labels = {
      flow: 'el flujo actual',
      focus: 'una sesión estable de concentración',
      unwind: 'un descenso gradual de intensidad',
      move: 'una subida de energía',
      discover: 'una exploración con riesgo controlado',
    }
    signals.push({
      signal: 'context',
      text: `Su dinámica encaja con ${labels[intent]}.`,
      strength: breakdown.context,
    })
  }
  if (breakdown.novelty >= 0.58 && signals.length < 2) {
    signals.push({
      signal: 'exploration',
      text: 'Introduce una variación sonora calculada, no una elección aleatoria.',
      strength: breakdown.novelty,
    })
  }
  if (!signals.length) {
    signals.push({
      signal: 'balance',
      text: 'Equilibra afinidad, transición y exposición reciente.',
      strength: breakdown.total,
    })
  }
  return signals.slice(0, 2)
}

function scoreCandidate({
  candidate,
  previous,
  selected,
  taste,
  exemplars,
  target,
  intent,
  exploration,
  totalInteractions,
  runId,
  now,
  coldStart,
  libraryVector,
  recentTracks,
  fatigue,
  metadataTaste,
}) {
  const affinitySignals = tasteAffinity(candidate, taste, exemplars)
  const { affinity, positiveSimilarity, negativeSimilarity } = affinitySignals
  const context = featureFit(candidate, target)
  const transition = transitionFit(previous, candidate, target)
  const recentSimilarity = maxRecentSimilarity(candidate, selected)
  const historicalSimilarity = maxRecentSimilarity(candidate, recentTracks, 10)
  const novelty = coldStart
    ? clamp(1 - recentSimilarity)
    : clamp((1 - positiveSimilarity) * 0.42 + (1 - recentSimilarity) * 0.3 + (1 - historicalSimilarity) * 0.28)
  const diversityPenalty = recentSimilarity > 0.91 ? (recentSimilarity - 0.91) * 6 : 0
  const selectedFatigue = selectedCreditFatigue(candidate, selected)
  const artistFatigue = Math.max(selectedFatigue.artist, fatigue.artists.get(normalizedCredit(candidate.artist)) || 0)
  const albumFatigue = Math.max(selectedFatigue.album, fatigue.albums.get(normalizedCredit(candidate.album)) || 0)
  const sonicFatigue = historicalSimilarity > 0.94 ? clamp((historicalSimilarity - 0.94) * 10) : 0
  const exposure = exposurePenalty(candidate, now)
  const negativeOutcomes = Number(candidate.early_skips || 0) * 1.6 + Number(candidate.late_skips || 0) * 0.55
  const positiveOutcomes = Number(candidate.completes || 0) * 1.2 + Number(candidate.replays || 0) + Number(candidate.playlist_adds || 0) * 1.4
  const skipRisk = (negativeOutcomes + 1) / (negativeOutcomes + positiveOutcomes + 3)
  const bandit = banditValue(candidate, totalInteractions, exploration, runId)
  const representative = libraryVector?.length ? similarity(candidate.embeddingVector, libraryVector) : 0.58
  const styleName = candidate.style || null
  const candidateGenres = genreLabels(candidate.genre)
  const moodName = candidate.manual_mood || candidate.auto_mood || null
  const moodSource = candidate.manual_mood ? 'manual' : candidate.auto_mood ? 'automático' : null
  const anchorStyle = previous?.style || null
  const anchorGenres = genreLabels(previous?.genre)
  const anchorMood = previous?.manual_mood || previous?.auto_mood || null
  const styleMatch = Boolean(styleName && anchorStyle && metadataKey(styleName) === metadataKey(anchorStyle))
  const genreMatch = candidateGenres.find((genre) => anchorGenres.some((anchorGenre) => metadataKey(anchorGenre) === metadataKey(genre))) || null
  const moodMatch = Boolean(moodName && anchorMood && metadataKey(moodName) === metadataKey(anchorMood))
  const metadataTier = styleMatch ? 3 : genreMatch ? 2 : moodMatch ? 1 : 0
  const metadataPriority = styleMatch ? 1 : genreMatch ? 0.62 : moodMatch ? (moodSource === 'manual' ? 0.42 : 0.34) : 0
  const styleSignal = strongestPreference(metadataTaste.style, styleName ? [styleName] : [])
  const genreSignal = strongestPreference(metadataTaste.genre, candidateGenres)
  const moodSignal = strongestPreference(metadataTaste.mood, moodName ? [moodName] : [])
  const categoryAffinity = styleSignal.affinity * 0.5 + genreSignal.affinity * 0.3 + moodSignal.affinity * 0.2
  const categoryConfidence = styleSignal.confidence * 0.5 + genreSignal.confidence * 0.3 + moodSignal.confidence * 0.2

  const total = clamp(
    affinity * (coldStart ? 0.04 : 0.28) +
    context * 0.15 +
    transition * 0.15 +
    bandit * 0.1 +
    novelty * exploration * 0.72 +
    representative * (coldStart ? 0.24 : 0.02) -
    diversityPenalty * 0.13 -
    artistFatigue * 0.13 -
    albumFatigue * 0.07 -
    sonicFatigue * 0.08 -
    exposure * 0.14 -
    skipRisk * 0.1 +
    metadataPriority * 0.26 +
    (categoryAffinity - 0.5) * 0.14 +
    deterministicNoise(`${runId}:tie:${candidate.id}`) * 0.015,
  )

  const breakdown = {
    affinity,
    positiveSimilarity,
    negativeSimilarity,
    neighborAffinity: affinitySignals.neighborAffinity,
    neighborRejection: affinitySignals.neighborRejection,
    directPreference: affinitySignals.directPreference,
    preferenceConfidence: affinitySignals.preferenceConfidence,
    context,
    transition,
    novelty,
    bandit,
    exposure,
    skipRisk,
    diversityPenalty: clamp(diversityPenalty),
    artistFatigue,
    albumFatigue,
    sonicFatigue,
    styleName,
    genreLabels: candidateGenres,
    moodName,
    moodSource,
    styleMatch,
    genreMatch,
    moodMatch,
    metadataTier,
    metadataPriority,
    styleAffinity: styleSignal.affinity,
    genreAffinity: genreSignal.affinity,
    moodAffinity: moodSignal.affinity,
    categoryAffinity,
    categoryConfidence,
    total,
  }
  return {
    candidate,
    total,
    breakdown,
    explanation: explanationFor(breakdown, intent, coldStart),
  }
}

function stripProfileFields(candidate) {
  const track = { ...candidate }
  for (const key of [
    'embedding',
    'segment_embeddings',
    'feature_summary',
    'embeddingVector',
    'segments',
    'features',
    'completes',
    'skips',
    'listens',
    'last_listened',
    'playlist_adds',
    'positive_events',
    'negative_events',
    'early_skips',
    'late_skips',
    'replays',
    'last_interaction',
  ]) {
    delete track[key]
  }
  return track
}

function sessionNarrative(intent, coldStart, exploration, count) {
  const intentText = {
    flow: 'mantener una escucha natural',
    focus: 'proteger la concentración',
    unwind: 'reducir la intensidad poco a poco',
    move: 'construir energía de forma progresiva',
    discover: 'abrir espacio a sonidos nuevos',
  }[intent]
  if (coldStart) {
    return `Una primera sesión de ${count} canciones para reconocer tu mapa sonoro. Aprende de cada escucha y cada salto.`
  }
  const explorationPercent = Math.round(exploration * 100)
  return `Una secuencia para ${intentText}, con aproximadamente un ${explorationPercent}% de exploración adaptativa.`
}

function generateLegacySession(options = {}) {
  const userId = Number(options.userId || 0)
  const intent = INTENTS.has(options.intent) ? options.intent : 'flow'
  const requestedLength = Math.max(1, Math.min(50, Number(options.length || 24)))
  const moodByIntent = {
    flow: 'Equilibrio',
    focus: 'Focus',
    unwind: 'Relax',
    move: 'Gimnasio',
    discover: null,
  }
  const mood = moodByIntent[intent]
  const rows = mood
    ? db.prepare(`
        SELECT * FROM tracks
        WHERE COALESCE(manual_mood, auto_mood) = ?
        ORDER BY RANDOM() LIMIT ?
      `).all(mood, requestedLength)
    : db.prepare('SELECT * FROM tracks ORDER BY RANDOM() LIMIT ?').all(requestedLength)
  const fallback = rows.length
    ? rows
    : db.prepare('SELECT * FROM tracks ORDER BY RANDOM() LIMIT ?').all(requestedLength)
  const runId = crypto.randomUUID()
  const sessionId = options.sessionId || crypto.randomUUID()
  const context = { intent, mood, baseline: true }
  db.prepare(`
    INSERT INTO recommendation_runs (id, user_id, session_id, algorithm, intent, context)
    VALUES (?, ?, ?, 'legacy-mood-v1', ?, ?)
  `).run(runId, userId || null, sessionId, intent, JSON.stringify(context))
  const explanation = [{
    signal: 'legacy_mood',
    text: mood ? `Coincide con la etiqueta ${mood}.` : 'Selección aleatoria para descubrimiento.',
    strength: 0.5,
  }]
  const insertItem = db.prepare(`
    INSERT INTO recommendation_items (
      run_id, track_id, position, total_score, score_breakdown, explanation
    ) VALUES (?, ?, ?, 0.5, ?, ?)
  `)
  db.transaction(() => {
    fallback.forEach((track, position) => insertItem.run(
      runId,
      track.id,
      position,
      JSON.stringify({ total: 0.5, affinity: 0, transition: 0, novelty: 0 }),
      JSON.stringify(explanation),
    ))
  })()
  return {
    runId,
    sessionId,
    algorithm: 'legacy-mood-v1',
    intent,
    coldStart: false,
    exploration: 0,
    narrative: 'Línea base del recomendador anterior basada en mood y orden aleatorio.',
    tracks: fallback.map((track, position) => ({
      ...rowToTrack(track),
      recommendation: {
        runId,
        sessionId,
        position,
        score: 0.5,
        breakdown: { total: 0.5 },
        reasons: explanation,
      },
    })),
  }
}

export function generateSession(options = {}) {
  if (options.algorithm === 'legacy') return generateLegacySession(options)
  const intent = INTENTS.has(options.intent) ? options.intent : 'flow'
  const userId = Number(options.userId || 0)
  const requestedLength = Math.max(1, Math.min(50, Number(options.length || 24)))
  const now = options.now ? new Date(options.now) : new Date()
  const allCandidates = candidateRows(userId)
  if (!allCandidates.length) {
    return {
      runId: null,
      sessionId: null,
      intent,
      tracks: [],
      narrative: 'Sonora necesita terminar el análisis de audio antes de construir una sesión.',
      analysisRequired: true,
    }
  }

  const runId = crypto.randomUUID()
  const scoringSeed = options.collectionKey || runId
  const sessionId = options.sessionId || crypto.randomUUID()
  const profiles = storedProfiles(userId, intent, now)
  const fallback = bootstrapProfile(allCandidates)
  const taste = combinedTaste(profiles, fallback, intent, now)
  const exemplars = tasteExemplars(allCandidates, now)
  const fatigue = recentFatigue(userId)
  const metadataTaste = metadataPreferences(userId)
  const coldStart = taste.positiveWeight < 3
  const storedRecentSkips = db.prepare(`
    SELECT COUNT(*) count FROM interaction_events
    WHERE user_id = ? AND event_type = 'skip_early' AND created_at >= datetime('now', '-45 minutes')
  `).get(userId).count
  const recentSkips = Math.max(storedRecentSkips, Number(options.recentSkipHint || 0))
  const exploration = intent === 'discover'
    ? (recentSkips >= 3 ? 0.12 : recentSkips >= 2 ? 0.18 : recentSkips >= 1 ? 0.26 : 0.34)
    : (recentSkips >= 3 ? 0.04 : recentSkips >= 2 ? 0.06 : recentSkips >= 1 ? 0.1 : 0.15)
  const totalInteractions = db.prepare('SELECT COUNT(*) count FROM interaction_events WHERE user_id = ?').get(userId).count
  const recentRows = db.prepare(`
    SELECT track_id FROM listening_history WHERE user_id = ? ORDER BY listened_at DESC, id DESC LIMIT 12
  `).all(userId)
  const recentIds = new Set(recentRows.map((row) => row.track_id))
  const recentTracks = recentRows
    .map((row) => allCandidates.find((candidate) => candidate.id === row.track_id))
    .filter(Boolean)
    .reverse()
  const seedIds = new Set((options.seedTrackIds || []).map(Number))
  const currentId = Number(options.currentTrackId || 0)
  const previousFromCurrent = allCandidates.find((candidate) => candidate.id === currentId) || null
  let pool = allCandidates.filter((candidate) => candidate.id !== currentId)
  if (pool.length > requestedLength + 4) {
    const notRecent = pool.filter((candidate) => !recentIds.has(candidate.id))
    if (notRecent.length >= requestedLength) pool = notRecent
  }

  const selected = []
  const scoredItems = []
  let previous = previousFromCurrent
  while (selected.length < Math.min(requestedLength, pool.length)) {
    const position = selected.length
    const target = intentTarget(intent, position, requestedLength)
    const scored = pool
      .filter((candidate) => !selected.some((track) => track.id === candidate.id))
      .map((candidate) => {
        const result = scoreCandidate({
          candidate,
          previous,
          selected,
          taste,
          exemplars,
          target,
          intent,
          exploration,
          totalInteractions,
          runId: scoringSeed,
          now,
          coldStart,
          libraryVector: fallback.library,
          recentTracks,
          fatigue,
          metadataTaste,
        })
        if (seedIds.has(candidate.id) && position < seedIds.size) result.total = clamp(result.total + 0.35)
        return result
      })
      .sort((left, right) => {
        if (previous && right.breakdown.metadataTier !== left.breakdown.metadataTier) {
          return right.breakdown.metadataTier - left.breakdown.metadataTier
        }
        return right.total - left.total
      })
    if (!scored.length) break
    const winner = scored[0]
    selected.push(winner.candidate)
    scoredItems.push(winner)
    previous = winner.candidate
  }

  const context = {
    intent,
    timeScope: timeScope(now),
    exploration,
    coldStart,
    currentTrackId: currentId || null,
    recentSkips,
    analysisVersion: ANALYSIS_VERSION,
    tasteModel: 'multi-anchor',
    metadataModel: 'style-genre-mood-priority',
    metadataPriority: ['style', 'genre', 'manual_mood', 'auto_mood'],
    fatigueWindow: 32,
  }
  db.prepare(`
    INSERT INTO recommendation_runs (id, user_id, session_id, algorithm, intent, context)
    VALUES (?, ?, ?, 'sonora-context-v4', ?, ?)
  `).run(runId, userId || null, sessionId, intent, JSON.stringify(context))
  const insertItem = db.prepare(`
    INSERT INTO recommendation_items (
      run_id, track_id, position, total_score, score_breakdown, explanation
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)
  const insertAll = db.transaction(() => {
    scoredItems.forEach((item, position) => insertItem.run(
      runId,
      item.candidate.id,
      position,
      item.total,
      JSON.stringify(item.breakdown),
      JSON.stringify(item.explanation),
    ))
  })
  insertAll()

  return {
    runId,
    sessionId,
    algorithm: 'sonora-context-v4',
    intent,
    coldStart,
    exploration,
    narrative: sessionNarrative(intent, coldStart, exploration, selected.length),
    tracks: scoredItems.map((item, position) => ({
      ...rowToTrack(stripProfileFields(item.candidate)),
      recommendation: {
        runId,
        sessionId,
        position,
        score: item.total,
        breakdown: item.breakdown,
        reasons: item.explanation,
      },
    })),
  }
}

export function recommendationMetrics(userId) {
  const algorithms = db.prepare(`
    SELECT
      r.algorithm,
      COUNT(DISTINCT r.id) runs,
      COUNT(i.track_id) recommendations,
      SUM(CASE WHEN i.outcome = 'accepted' THEN 1 ELSE 0 END) accepted,
      SUM(CASE WHEN i.outcome = 'skipped' THEN 1 ELSE 0 END) skipped,
      AVG(CASE WHEN i.outcome = 'accepted' THEN 1.0 WHEN i.outcome = 'skipped' THEN 0.0 END) acceptanceRate
    FROM recommendation_runs r
    LEFT JOIN recommendation_items i ON i.run_id = r.id
    WHERE r.user_id = ?
    GROUP BY r.algorithm
  `).all(userId)
  const discovery = db.prepare(`
    SELECT COUNT(*) exposed,
      SUM(CASE WHEN outcome = 'accepted' THEN 1 ELSE 0 END) accepted
    FROM recommendation_items i JOIN recommendation_runs r ON r.id = i.run_id
    WHERE r.user_id = ? AND json_extract(score_breakdown, '$.novelty') >= 0.58
  `).get(userId)
  const listening = db.prepare(`
    SELECT
      COUNT(*) outcomes,
      SUM(CASE WHEN skipped = 1 AND seconds < 30 THEN 1 ELSE 0 END) earlySkips,
      SUM(completed) completed,
      AVG(seconds) averageSeconds
    FROM listening_history
    WHERE user_id = ? AND recommendation_run_id IS NOT NULL
  `).get(userId)
  const sequenceQuality = db.prepare(`
    SELECT
      AVG(json_extract(score_breakdown, '$.novelty')) averageNovelty,
      AVG(json_extract(score_breakdown, '$.transition')) averageTransition,
      AVG(json_extract(score_breakdown, '$.exposure')) averageExposurePenalty
    FROM recommendation_items i JOIN recommendation_runs r ON r.id = i.run_id
    WHERE r.user_id = ? AND json_extract(score_breakdown, '$.transition') IS NOT NULL
  `).get(userId)
  return {
    algorithms,
    discovery: {
      ...discovery,
      acceptanceRate: discovery.exposed ? discovery.accepted / discovery.exposed : null,
    },
    listening: {
      ...listening,
      earlySkipRate: listening.outcomes ? listening.earlySkips / listening.outcomes : null,
      completionRate: listening.outcomes ? listening.completed / listening.outcomes : null,
    },
    sequenceQuality,
  }
}
