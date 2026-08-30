import { decryptEightSpineModule } from './eightSpineFormat'

let activeModule = null
let activeMetadata = null
const storageBuckets = new Map()
const nativeFetch = globalThis.fetch.bind(globalThis)

function sandboxedFetch(input, init = {}) {
  const value = input instanceof Request ? input.url : input
  let url
  try {
    url = new URL(String(value), self.location.href)
  } catch {
    throw new Error('El módulo intentó abrir una URL no válida.')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('El módulo intentó usar un protocolo de red no permitido.')
  if (url.origin === self.location.origin) throw new Error('Los módulos 8SPINE no pueden llamar a la API privada de Sonora.')
  return nativeFetch(input, {
    ...init,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  })
}

Object.defineProperty(globalThis, 'fetch', { value: sandboxedFetch, writable: false, configurable: false })
for (const capability of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB']) {
  try {
    Object.defineProperty(globalThis, capability, { value: undefined, writable: false, configurable: false })
  } catch {
    // Algunos navegadores no permiten redefinir todas las capacidades del Worker.
  }
}

function namespacedStorage(namespace) {
  if (!storageBuckets.has(namespace)) storageBuckets.set(namespace, new Map())
  const bucket = storageBuckets.get(namespace)
  return {
    async getItem(key) {
      return bucket.has(String(key)) ? bucket.get(String(key)) : null
    },
    async setItem(key, value) {
      bucket.set(String(key), String(value))
    },
    async removeItem(key) {
      bucket.delete(String(key))
    },
    async clear() {
      bucket.clear()
    },
    async getAllKeys() {
      return [...bucket.keys()]
    },
    async multiGet(keys) {
      return Promise.all(keys.map(async (key) => [key, await this.getItem(key)]))
    },
    async multiSet(entries) {
      entries.forEach(([key, value]) => bucket.set(String(key), String(value)))
    },
  }
}

function moduleConsole(name) {
  const prefix = `[8SPINE · ${name || 'módulo'}]`
  return Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map((method) => [
    method,
    (...args) => console[method](prefix, ...args),
  ]))
}

function unwrapExportWrapper(source) {
  const match = source.match(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=/)
  if (!match) return source
  const exportName = match[1]
  const executable = source.replace(/\bexport\s+const\s+/, 'const ')
  const wrapped = new Function(`${executable}\nreturn typeof ${exportName} === 'undefined' ? undefined : ${exportName};`)()
  if (typeof wrapped !== 'string') throw new Error('El contenedor exportado por el módulo 8SPINE no contiene código.')
  return wrapped
}

function evaluateModule(source, descriptor) {
  const moduleSource = unwrapExportWrapper(source)
  const commonJsModule = { exports: {} }
  const storage = namespacedStorage(descriptor.catalogId || descriptor.id || descriptor.name || 'module')
  const result = new Function(
    'fetch',
    'console',
    'AsyncStorage',
    'module',
    'exports',
    `${moduleSource}\n//# sourceURL=${descriptor.downloadUrl || 'eightspine-module.js'}`,
  )(
    sandboxedFetch,
    moduleConsole(descriptor.name),
    storage,
    commonJsModule,
    commonJsModule.exports,
  )
  const commonJsResult = commonJsModule.exports?.default || commonJsModule.exports
  const instance = result || (commonJsResult && Object.keys(commonJsResult).length ? commonJsResult : null)
  if (!instance || typeof instance !== 'object') throw new Error('El módulo debe devolver un objeto 8SPINE.')
  if (!instance.id) throw new Error('El módulo 8SPINE no declara un identificador.')
  if (typeof instance.searchTracks !== 'function') throw new Error('El módulo 8SPINE no implementa searchTracks().')
  if (typeof instance.getTrackStreamUrl !== 'function') throw new Error('El módulo 8SPINE no implementa getTrackStreamUrl().')
  return instance
}

function serializable(value) {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value, (key, entry) => typeof entry === 'function' ? undefined : entry))
}

function publicMetadata(instance, descriptor) {
  return serializable({
    catalogId: descriptor.catalogId || descriptor.id,
    id: instance.id,
    name: instance.name || descriptor.name || instance.id,
    author: instance.author || descriptor.author || '',
    version: instance.version || descriptor.version || '',
    description: instance.description || descriptor.description || '',
    labels: instance.labels || descriptor.labels || [],
    settings: instance.settings || instance.config || [],
    trusted: descriptor.trusted === true,
    downloadUrl: descriptor.downloadUrl,
    sourceUrl: descriptor.sourceUrl,
  })
}

async function handleMessage(message) {
  if (message.type === 'load') {
    const cleartext = await decryptEightSpineModule(message.code)
    activeModule = evaluateModule(cleartext, message.descriptor)
    activeMetadata = publicMetadata(activeModule, message.descriptor)
    return activeMetadata
  }
  if (message.type === 'call') {
    if (!activeModule) throw new Error('No hay ningún módulo 8SPINE activo.')
    const method = activeModule[message.method]
    if (typeof method !== 'function') throw new Error(`El módulo no implementa ${message.method}().`)
    return serializable(await method.apply(activeModule, message.args || []))
  }
  if (message.type === 'metadata') return activeMetadata
  throw new Error('Petición desconocida para el motor 8SPINE.')
}

self.addEventListener('message', async (event) => {
  const { requestId } = event.data || {}
  if (!requestId) return
  try {
    const result = await handleMessage(event.data)
    self.postMessage({ requestId, result })
  } catch (error) {
    self.postMessage({
      requestId,
      error: {
        name: error?.name || 'Error',
        message: error?.message || String(error),
      },
    })
  }
})
