import {
  directEightSpineDescriptor,
  normalizeEightSpineInputUrl,
  normalizeEightSpineSourceIndex,
  normalizeEightSpineTrack,
} from './eightSpineFormat.js'

const SOURCE_STORAGE_KEY = 'sonora-eightspine-source-v1'
const ACTIVE_STORAGE_KEY = 'sonora-eightspine-active-v1'
const runtimes = new Map()
let activeCatalogId = null
let sequence = 0

function storage() {
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

function readStored(key) {
  try {
    return JSON.parse(storage()?.getItem(key) || 'null')
  } catch {
    return null
  }
}

function writeStored(key, value) {
  try {
    storage()?.setItem(key, JSON.stringify(value))
  } catch {
    // La sesión sigue funcionando aunque el navegador bloquee el almacenamiento local.
  }
}

function removeStored(key) {
  try {
    storage()?.removeItem(key)
  } catch {
    // La sesión sigue funcionando aunque el navegador bloquee el almacenamiento local.
  }
}

async function fetchText(url, { accept = 'text/plain, application/json', timeout = 15_000 } = {}) {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, {
      headers: { Accept: accept },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`La fuente 8SPINE respondió ${response.status}.`)
    return await response.text()
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('La fuente 8SPINE tardó demasiado en responder.', { cause: error })
    if (/fuente 8SPINE respondió/.test(error?.message || '')) throw error
    throw new Error('No se pudo descargar la fuente 8SPINE. Comprueba la URL y su permiso CORS.', { cause: error })
  } finally {
    globalThis.clearTimeout(timer)
  }
}

function runtimeRequest(runtime, message, timeout = 45_000) {
  return new Promise((resolve, reject) => {
    const requestId = `8spine-${Date.now()}-${sequence += 1}`
    const timer = globalThis.setTimeout(() => {
      runtime.pending.delete(requestId)
      reject(new Error('El módulo 8SPINE tardó demasiado en responder.'))
    }, timeout)
    runtime.pending.set(requestId, {
      resolve: (value) => {
        globalThis.clearTimeout(timer)
        resolve(value)
      },
      reject: (error) => {
        globalThis.clearTimeout(timer)
        reject(error)
      },
    })
    runtime.worker.postMessage({ ...message, requestId })
  })
}

function createRuntime(descriptor) {
  const worker = new Worker(new URL('./eightSpineModuleWorker.js', import.meta.url), {
    type: 'module',
    name: `sonora-8spine-${descriptor.catalogId}`,
  })
  const runtime = { descriptor, worker, pending: new Map(), info: null }
  worker.addEventListener('message', (event) => {
    const pending = runtime.pending.get(event.data?.requestId)
    if (!pending) return
    runtime.pending.delete(event.data.requestId)
    if (event.data.error) pending.reject(new Error(event.data.error.message || 'El módulo 8SPINE ha fallado.'))
    else pending.resolve(event.data.result)
  })
  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'El proceso aislado del módulo 8SPINE se ha detenido.')
    runtime.pending.forEach((pending) => pending.reject(error))
    runtime.pending.clear()
    runtimes.delete(descriptor.catalogId)
  })
  return runtime
}

async function loadRuntime(descriptor) {
  const existing = runtimes.get(descriptor.catalogId)
  if (existing?.info) return existing
  const code = await fetchText(descriptor.downloadUrl, { accept: 'text/plain, application/javascript, application/octet-stream' })
  const runtime = existing || createRuntime(descriptor)
  runtimes.set(descriptor.catalogId, runtime)
  try {
    runtime.info = await runtimeRequest(runtime, { type: 'load', code, descriptor }, 20_000)
    runtime.info = { ...descriptor, ...runtime.info, catalogId: descriptor.catalogId }
    return runtime
  } catch (error) {
    runtime.worker.terminate()
    runtimes.delete(descriptor.catalogId)
    throw error
  }
}

function storedDescriptor(catalogId) {
  const source = readStored(SOURCE_STORAGE_KEY)
  return source?.modules?.find((module) => module.catalogId === catalogId) || null
}

export async function loadEightSpineSource(value) {
  const sourceUrl = normalizeEightSpineInputUrl(value)
  let source
  if (/\.(?:8spine|js)(?:$|[?#])/i.test(sourceUrl)) {
    source = { sourceUrl, modules: [directEightSpineDescriptor(sourceUrl)] }
  } else {
    const text = await fetchText(sourceUrl, { accept: 'application/json, text/plain' })
    let payload
    try {
      payload = JSON.parse(text.replace(/^\uFEFF/, ''))
    } catch {
      const error = new Error('La URL no devuelve un índice JSON ni un módulo 8SPINE directo.')
      error.code = 'NOT_EIGHTSPINE_SOURCE'
      throw error
    }
    source = normalizeEightSpineSourceIndex(payload, { sourceUrl })
  }
  writeStored(SOURCE_STORAGE_KEY, source)
  return source
}

export async function activateEightSpineModule(descriptor) {
  if (!descriptor?.catalogId || !descriptor?.downloadUrl) throw new Error('El módulo 8SPINE seleccionado no tiene una descarga válida.')
  const runtime = await loadRuntime(descriptor)
  activeCatalogId = descriptor.catalogId
  writeStored(ACTIVE_STORAGE_KEY, descriptor)
  return runtime.info
}

export async function restoreEightSpineSession() {
  const source = readStored(SOURCE_STORAGE_KEY)
  const descriptor = readStored(ACTIVE_STORAGE_KEY)
  if (!source?.modules?.length || !descriptor?.downloadUrl) return { source: null, module: null }
  const currentDescriptor = source.modules.find((module) => module.catalogId === descriptor.catalogId) || descriptor
  const module = await activateEightSpineModule(currentDescriptor)
  return { source, module }
}

export async function searchEightSpineTracks(query, limit = 8) {
  if (!activeCatalogId) return { tracks: [], total: 0 }
  const runtime = runtimes.get(activeCatalogId)
  if (!runtime?.info) throw new Error('Activa de nuevo el módulo 8SPINE antes de buscar.')
  const result = await runtimeRequest(runtime, {
    type: 'call',
    method: 'searchTracks',
    args: [String(query), limit],
  }, 60_000)
  const rows = Array.isArray(result) ? result : result?.tracks || result?.items || result?.results || result?.songs || result?.data || []
  if (!Array.isArray(rows)) throw new Error('El módulo 8SPINE devolvió una búsqueda con un formato desconocido.')
  const tracks = rows.slice(0, limit).map((track, index) => normalizeEightSpineTrack(track, runtime.info, index)).filter(Boolean)
  return { tracks, total: Number(result?.total) || tracks.length }
}

export async function resolveEightSpineTrack(track, quality = 'LOSSLESS') {
  if (track?.sourceKind !== '8spine') return track
  let runtime = runtimes.get(track.moduleId)
  if (!runtime?.info) {
    const descriptor = storedDescriptor(track.moduleId)
    if (!descriptor) throw new Error(`Activa el módulo ${track.sourceName || '8SPINE'} para reproducir esta pista.`)
    runtime = await loadRuntime(descriptor)
  }
  const result = await runtimeRequest(runtime, {
    type: 'call',
    method: 'getTrackStreamUrl',
    args: [track.moduleTrackId, quality],
  }, 60_000)
  const streamUrl = result?.streamUrl || result?.url || result?.audioUrl || result?.audio || result?.track?.streamUrl || result?.track?.url
  let parsedUrl
  try {
    parsedUrl = new URL(String(streamUrl || ''))
  } catch {
    throw new Error(`El módulo ${track.sourceName} no devolvió un enlace de audio válido.`)
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('El módulo 8SPINE devolvió un protocolo de audio no permitido.')
  const resolvedTrack = result?.track && typeof result.track === 'object' ? result.track : {}
  return {
    ...track,
    duration: Number(resolvedTrack.duration || track.duration || 0),
    quality: String(resolvedTrack.audioQuality || resolvedTrack.quality || track.quality || quality),
    codec: String(resolvedTrack.codec || resolvedTrack.format || track.codec || 'stream'),
    streamUrl: parsedUrl.href,
    location: parsedUrl.href,
  }
}

export function removeEightSpineModule(catalogId) {
  const id = String(catalogId || '')
  const runtime = runtimes.get(id)
  runtime?.worker.terminate()
  runtimes.delete(id)

  const source = readStored(SOURCE_STORAGE_KEY)
  const modules = (source?.modules || []).filter((module) => module.catalogId !== id)
  const nextSource = modules.length ? { ...source, modules } : null
  if (nextSource) writeStored(SOURCE_STORAGE_KEY, nextSource)
  else removeStored(SOURCE_STORAGE_KEY)

  const activeDescriptor = readStored(ACTIVE_STORAGE_KEY)
  const removedActive = activeCatalogId === id || activeDescriptor?.catalogId === id
  if (removedActive) {
    activeCatalogId = null
    removeStored(ACTIVE_STORAGE_KEY)
  }
  return { source: nextSource, removedActive }
}

export function clearEightSpineSession() {
  runtimes.forEach((runtime) => runtime.worker.terminate())
  runtimes.clear()
  activeCatalogId = null
  try {
    removeStored(SOURCE_STORAGE_KEY)
    removeStored(ACTIVE_STORAGE_KEY)
  } catch {
    // Sin almacenamiento persistente no hay nada que limpiar.
  }
}
