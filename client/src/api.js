export async function api(endpoint, options = {}) {
  const headers = new Headers(options.headers || {})
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`/api${endpoint}`, { ...options, headers })
  if (response.status === 204) return null
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'No se pudo completar la operación.')
  return payload
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

export function compactDuration(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  if (hours) return `${hours} h ${minutes} min`
  return `${minutes} min`
}

export const TOKEN_EUROS_PER_1000 = 14

export function tokenEuroAmount(tokens) {
  return Number(tokens || 0) * TOKEN_EUROS_PER_1000 / 1000
}

export function formatEuros(amount) {
  return Number(amount || 0).toLocaleString('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatTokenEuros(tokens) {
  return formatEuros(tokenEuroAmount(tokens))
}

export function formatTokenAmount(tokens) {
  return Number(tokens || 0).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}
