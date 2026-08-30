import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  Album,
  ArrowLeft,
  AudioLines,
  BarChart3,
  BrainCircuit,
  Check,
  ChevronRight,
  Clock3,
  Compass,
  Copy,
  CreditCard,
  Disc3,
  Download,
  Folder,
  Focus,
  Gauge,
  GripVertical,
  Heart,
  Headphones,
  House,
  Info,
  Library,
  Link2,
  ListMusic,
  LogOut,
  Menu,
  Mic2,
  Moon,
  Music2,
  PackageCheck,
  Palette,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ReceiptText,
  RotateCcw,
  Repeat,
  Repeat1,
  Search,
  ShieldCheck,
  ShoppingBag,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Volume2,
  VolumeX,
  Waves,
  Network,
  X,
  Zap,
} from './Icons.jsx'
import { api, compactDuration, formatTime, formatTokenAmount, formatTokenEuros } from './api'
import { BrandLogo, ElectricDisplacementFilter, PointsLogo } from './BrandAssets.jsx'
import { AdminView } from './AdminView.jsx'
import { DolbyAtmosLogo } from './DolbyAtmosLogo'
import { NowPlayingView, TokenAccountView, TokenCheckout } from './NowPlaying'
import { LibrarySourcesPanel } from './LibrarySourcesPanel'
import { AlbumDetailView, ArtistProfileView, SearchResultsView } from './DiscoveryViews'
import {
  importJsonFile,
  importJsonUrl,
  importMusicFolder,
  revokeBrowserTrackUrls,
} from './librarySources'
import {
  activateEightSpineModule,
  loadEightSpineSource,
  removeEightSpineModule,
  resolveEightSpineTrack,
  restoreEightSpineSession,
  searchEightSpineTracks,
} from './eightSpineModules'
import { enrichPlaylistImport } from './playlistImport'
import { useAudioEnergy } from './useAudioEnergy'
import { useAudioEngine } from './useAudioEngine'

const NAVIGATION = [
  { id: 'home', label: 'Inicio', icon: House },
  { id: 'songs', label: 'Canciones', icon: Music2 },
  { id: 'albums', label: 'Álbumes', icon: Album },
  { id: 'artists', label: 'Artistas', icon: Mic2 },
  { id: 'playlists', label: 'Playlists', icon: ListMusic },
  { id: 'genres', label: 'Géneros', icon: Library },
]

const StatsView = lazy(() => import('./StatsView.jsx'))

function parseSonoraLink(value) {
  try {
    const url = new URL(String(value || '').trim())
    const [type, code, ...rest] = url.pathname.split('/').filter(Boolean)
    if (url.protocol !== 'sonora:' || url.hostname !== 'web.sonora.com' || rest.length || !['music', 'product', 'section', 'artist', 'album'].includes(type) || !code) return null
    return { type, code }
  } catch {
    return null
  }
}

const INTENT_META = {
  flow: { label: 'Déjate llevar', icon: Waves, description: 'Continuidad natural y cambios medidos.' },
  focus: { label: 'Concentración', icon: Focus, description: 'Dinámica estable y poca fatiga.' },
  unwind: { label: 'Bajar el ritmo', icon: Moon, description: 'Un descenso progresivo de intensidad.' },
  move: { label: 'Subir energía', icon: Zap, description: 'Pulso creciente sin saltos arbitrarios.' },
  discover: { label: 'Descubrir', icon: Compass, description: 'Exploración más valiente, pero personal.' },
}

function weeklyCollectionKey() {
  const date = new Date()
  const monday = new Date(date)
  const day = (date.getDay() + 6) % 7
  monday.setDate(date.getDate() - day)
  return `weekly:${monday.toISOString().slice(0, 10)}`
}

const EQ_LABELS = ['62 Hz', '125 Hz', '250 Hz', '500 Hz', '1 kHz', '2 kHz', '4 kHz', '8 kHz', '16 kHz']
const EQ_PRESETS = [
  { id: 'flat', label: 'Plano', curve: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'headphones', label: 'Auriculares', curve: [4, 3, 1, 0, -1, 0, 2, 3, 3] },
  { id: 'bass', label: 'Graves potentes', curve: [8, 6, 4, 2, 0, -1, -2, -2, -1] },
  { id: 'voice', label: 'Voces claras', curve: [-2, -1, 0, 2, 4, 5, 3, 1, 0] },
  { id: 'electronic', label: 'Electrónica', curve: [6, 4, 1, -1, 0, 2, 5, 5, 3] },
  { id: 'acoustic', label: 'Acústico', curve: [2, 1, 0, 2, 3, 2, 3, 2, 1] },
]
async function filesFromEntry(entry) {
  if (entry.isFile) {
    return [await new Promise((resolve, reject) => entry.file(resolve, reject))]
  }
  if (!entry.isDirectory) return []
  const reader = entry.createReader()
  const entries = []
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
    if (!batch.length) break
    entries.push(...batch)
  }
  return (await Promise.all(entries.map(filesFromEntry))).flat()
}

async function collectDroppedFiles(dataTransfer) {
  const entries = [...(dataTransfer.items || [])]
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean)
  if (!entries.length) return [...dataTransfer.files]
  return (await Promise.all(entries.map(filesFromEntry))).flat()
}

function splitGenres(value) {
  const genres = String(value || '')
    .split(/[,;|]+/)
    .map((genre) => genre.trim())
    .filter(Boolean)
  return genres.length ? [...new Set(genres)] : ['Sin género']
}

function Cover({ track, size = 'medium', className = '' }) {
  return (
    <div className={`cover cover-${size} ${className}`}>
      {track?.artworkUrl ? (
        <img src={track.artworkUrl} alt={`Carátula de ${track.album}`} />
      ) : (
        <Disc3 aria-hidden="true" />
      )}
    </div>
  )
}

function QualityBadges({ track, spatial = false }) {
  if (!track) return null
  return (
    <span className="quality-badges" aria-label="Calidad de audio">
      <span className="quality-chip">Hi-Res Lossless</span>
      {spatial && <span className="quality-chip spatial-chip">Spatial Audio</span>}
    </span>
  )
}

function IconButton({ label, active = false, className = '', children, ...props }) {
  return (
    <button type="button" className={`icon-button ${active ? 'is-active' : ''} ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  )
}

function TrackContextMenu({ menu, canEdit, canUsePlaylists = canEdit, canCreateStation = true, onClose, onPlayNow, onPlayAlbum, onShuffleAlbum, onQueueNext, onQueueEnd, onCreateStation, onAddToPlaylist, onFavorite, onInfo }) {
  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') onClose()
    }
    function closeOnViewportChange() {
      onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeOnViewportChange)
    window.addEventListener('scroll', closeOnViewportChange, true)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeOnViewportChange)
      window.removeEventListener('scroll', closeOnViewportChange, true)
    }
  }, [onClose])

  const { track } = menu
  function run(action) {
    onClose()
    action?.()
  }

  return (
    <motion.div
      className="track-context-layer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1 }}
      onPointerDown={onClose}
      onContextMenu={(event) => { event.preventDefault(); onClose() }}
    >
      <motion.div
        className="track-context-menu"
        role="menu"
        aria-label={`Acciones para ${track.title}`}
        style={{ left: menu.x, top: menu.y }}
        initial={{ opacity: 0, scale: 0.96, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <button role="menuitem" disabled={!canUsePlaylists} title={canUsePlaylists ? undefined : 'Las playlists necesitan el servidor de Sonora'} onClick={() => run(onAddToPlaylist)}><ListMusic /><span>Añadir a una playlist</span><ChevronRight /></button>
        <div className="context-separator" />
        <button role="menuitem" onClick={() => run(onPlayNow)}><Play /><span>Reproducir ahora</span></button>
        <button role="menuitem" onClick={() => run(onPlayAlbum)}><Album /><span>Reproducir álbum</span></button>
        <button role="menuitem" onClick={() => run(onShuffleAlbum)}><Shuffle /><span>Reproducción aleatoria del álbum</span></button>
        <div className="context-separator" />
        <button role="menuitem" onClick={() => run(onQueueNext)}><SkipForward /><span>Reproducir a continuación</span></button>
        <button role="menuitem" onClick={() => run(onQueueEnd)}><ListMusic /><span>Reproducir al final</span></button>
        <button className="context-featured" role="menuitem" disabled={!canCreateStation} title={canCreateStation ? undefined : 'Las estaciones inteligentes necesitan el servidor de Sonora'} onClick={() => run(onCreateStation)}><Waves /><span>Crear estación</span></button>
        <div className="context-separator" />
        <button role="menuitem" onClick={() => run(onInfo)}><Info /><span>Información de la canción</span></button>
        <button role="menuitem" disabled={!canEdit} title={canEdit ? undefined : 'Solo el administrador puede cambiar favoritos'} onClick={() => run(onFavorite)}><Heart fill={track.favorite ? 'currentColor' : 'none'} /><span>{track.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}</span></button>
      </motion.div>
    </motion.div>
  )
}

function TrackInfoPanel({ track, onClose }) {
  const format = [track.container, track.codec].filter(Boolean).join(' · ') || 'Desconocido'
  const bitrate = track.bitrate ? `${Math.round(track.bitrate / 1000)} kb/s` : 'No disponible'
  const resolution = [track.bit_depth ? `${track.bit_depth} bits` : null, track.sample_rate ? `${Math.round(track.sample_rate / 100) / 10} kHz` : null].filter(Boolean).join(' · ') || 'No disponible'
  return (
    <motion.aside className="right-drawer track-info-panel" role="dialog" aria-modal="true" aria-labelledby="track-info-title" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}>
      <div className="drawer-heading">
        <div><span>Información</span><h2 id="track-info-title">Canción</h2></div>
        <IconButton label="Cerrar" onClick={onClose}><X /></IconButton>
      </div>
      <div className="track-info-hero">
        <Cover track={track} size="player" />
        <div><h3>{track.title}</h3><p>{track.artist}</p><QualityBadges track={track} /></div>
      </div>
      <dl className="track-info-list">
        <div><dt>Álbum</dt><dd>{track.album || 'Desconocido'}</dd></div>
        <div><dt>Género</dt><dd>{track.genre || 'Sin género'}</dd></div>
        <div><dt>Duración</dt><dd>{formatTime(track.duration)}</dd></div>
        <div><dt>Formato</dt><dd>{format}</dd></div>
        <div><dt>Resolución</dt><dd>{resolution}</dd></div>
        <div><dt>Tasa de bits</dt><dd>{bitrate}</dd></div>
        <div><dt>Calidad</dt><dd>Hi-Res Lossless</dd></div>
      </dl>
    </motion.aside>
  )
}

function Onboarding({ onComplete }) {
  const [musicFolder, setMusicFolder] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function chooseFolder() {
    setError('')
    try {
      const result = await api('/system/select-folder', { method: 'POST' })
      if (result?.path) setMusicFolder(result.path)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const config = await api('/config', {
        method: 'POST',
        body: JSON.stringify({ musicFolder }),
      })
      onComplete(config)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="onboarding">
      <div className="onboarding-material" aria-hidden="true">
        <Disc3 />
        <span />
      </div>
      <motion.section
        className="onboarding-copy"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="brand brand-large">
          <span className="brand-mark"><BrandLogo /></span>
          <span>Sonora</span>
        </div>
        <h1>Tu música sigue siendo tuya.</h1>
        <p>
          Elige la carpeta donde guardas tu colección. Sonora leerá las etiquetas y carátulas
          sin subir ni enviar ningún archivo fuera de este ordenador.
        </p>
        <form onSubmit={submit} className="folder-form">
          <label htmlFor="music-folder">Carpeta de música</label>
          <div className="folder-field">
            <Folder aria-hidden="true" />
            <input
              id="music-folder"
              value={musicFolder}
              onChange={(event) => setMusicFolder(event.target.value)}
              placeholder="C:\Música"
              autoFocus
              required
            />
            <button type="button" className="button button-secondary" onClick={chooseFolder}>
              Elegir
            </button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary button-large" disabled={saving || !musicFolder}>
            {saving ? 'Preparando biblioteca…' : 'Crear mi biblioteca'}
          </button>
        </form>
        <span className="privacy-note">Local por diseño · Multiusuario · Sin nube</span>
      </motion.section>
    </main>
  )
}

function SetupPending({ onLogout }) {
  return (
    <main className="setup-pending">
      <section>
        <span className="auth-brand"><BrandLogo /><span>Sonora</span></span>
        <Headphones />
        <h1>La biblioteca se está preparando.</h1>
        <p>Una cuenta administradora debe elegir la carpeta de música antes de que los oyentes puedan empezar.</p>
        <button className="button button-secondary" onClick={onLogout}><LogOut /> Cerrar sesión</button>
      </section>
    </main>
  )
}

function Visualizer({ analyser, playing = false, compact = false, variant = 'bars' }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const context = canvas.getContext('2d')
    if (!context) return undefined
    let frame = 0
    let visible = true
    let ratio = Math.min(2, window.devicePixelRatio || 1)
    let primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || 'white'
    const data = new Uint8Array(analyser?.frequencyBinCount || 64)

    const resize = () => {
      ratio = Math.min(2, window.devicePixelRatio || 1)
      const rect = canvas.getBoundingClientRect()
      const width = Math.max(1, Math.round(rect.width * ratio))
      const height = Math.max(1, Math.round(rect.height * ratio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
    }

    const renderFrame = () => {
      context.clearRect(0, 0, canvas.width, canvas.height)
      if (analyser && playing) analyser.getByteFrequencyData(data)
      else data.fill(0)

      if (variant === 'ribbon') {
        context.lineCap = 'round'
        context.lineJoin = 'round'
        for (let layer = 0; layer < 3; layer += 1) {
          context.beginPath()
          for (let index = 0; index < 48; index += 1) {
            const value = analyser ? data[Math.floor(index / 48 * data.length)] / 255 : 0.08
            const x = index / 47 * canvas.width
            const wave = Math.sin(index * 0.42 + layer * 1.7) * canvas.height * 0.055
            const y = canvas.height * (0.5 + (layer - 1) * 0.12) - value * canvas.height * 0.28 + wave
            if (index === 0) context.moveTo(x, y)
            else context.lineTo(x, y)
          }
          context.globalAlpha = 0.82 - layer * 0.2
          context.strokeStyle = layer === 0 ? primary : 'white'
          context.lineWidth = Math.max(1, (4 - layer) * ratio)
          context.stroke()
        }
        context.globalAlpha = 1
        return
      }

      if (variant === 'aurora') {
        context.globalCompositeOperation = 'lighter'
        for (let layer = 0; layer < 4; layer += 1) {
          context.beginPath()
          for (let index = 0; index < 54; index += 1) {
            const value = analyser ? data[Math.floor(index / 54 * data.length)] / 255 : 0.08
            const x = index / 53 * canvas.width
            const y = canvas.height * (0.72 - layer * 0.13) - value * canvas.height * (0.24 + layer * 0.035) + Math.sin(index * 0.28 + layer) * 8 * ratio
            if (index === 0) context.moveTo(x, y)
            else context.lineTo(x, y)
          }
          context.globalAlpha = 0.65 - layer * 0.1
          context.strokeStyle = layer % 2 === 0 ? primary : 'rgba(120, 190, 255, .9)'
          context.lineWidth = (5 - layer) * ratio
          context.stroke()
        }
        for (let index = 0; index < 18; index += 1) {
          const value = analyser ? data[index % data.length] / 255 : 0.08
          const x = ((index * 47) % 100) / 100 * canvas.width
          const y = ((index * 31) % 88 + 6) / 100 * canvas.height
          context.beginPath()
          context.globalAlpha = 0.18 + value * 0.65
          context.fillStyle = index % 2 ? primary : 'white'
          context.arc(x, y, (1.2 + value * 3.4) * ratio, 0, Math.PI * 2)
          context.fill()
        }
        context.globalAlpha = 1
        context.globalCompositeOperation = 'source-over'
        return
      }

      const bars = compact ? 42 : 72
      const gap = 3 * ratio
      const width = Math.max(1.5 * ratio, (canvas.width - gap * (bars - 1)) / bars)
      for (let index = 0; index < bars; index += 1) {
        const value = analyser ? data[Math.floor(index / bars * data.length)] / 255 : 0.08
        const height = Math.max(2 * ratio, value * canvas.height * 0.9)
        context.fillStyle = index < bars * 0.62 ? primary : 'rgba(255, 255, 255, 0.3)'
        context.fillRect(index * (width + gap), canvas.height - height, width, height)
      }
    }

    const draw = () => {
      frame = 0
      if (!playing || !visible || document.hidden) return
      renderFrame()
      frame = requestAnimationFrame(draw)
    }

    const start = () => {
      if (!frame && playing && visible && !document.hidden) frame = requestAnimationFrame(draw)
    }

    const stop = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    }

    const handleVisibility = () => {
      if (document.hidden) stop()
      else start()
    }

    resize()
    renderFrame()
    start()

    const resizeObserver = globalThis.ResizeObserver ? new ResizeObserver(() => {
      resize()
      if (!playing) renderFrame()
    }) : null
    resizeObserver?.observe(canvas)

    const intersectionObserver = globalThis.IntersectionObserver ? new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting !== false
      if (visible) start()
      else stop()
    }) : null
    intersectionObserver?.observe(canvas)

    const themeObserver = globalThis.MutationObserver ? new MutationObserver(() => {
      primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || 'white'
      if (!playing) renderFrame()
    }) : null
    themeObserver?.observe(document.documentElement, { attributes: true })
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      stop()
      resizeObserver?.disconnect()
      intersectionObserver?.disconnect()
      themeObserver?.disconnect()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [analyser, compact, playing, variant])

  return <canvas ref={canvasRef} className={`visualizer visualizer-${variant} ${compact ? 'visualizer-compact' : ''}`} aria-label="Espectro de audio en tiempo real" />
}

function WaveformProgress({ track, currentTime, duration, onSeek }) {
  const bars = useMemo(() => {
    const seed = Number(track?.id || 13)
    return Array.from({ length: 76 }, (_, index) => {
      const value = Math.sin((index + seed) * 1.77) * 0.22 + Math.sin((index + seed) * 0.43) * 0.28
      return Math.max(0.18, Math.min(1, 0.56 + value))
    })
  }, [track?.id])
  const progress = duration ? currentTime / duration : 0

  return (
    <button
      type="button"
      className="waveform-progress"
      aria-label={`Posición ${formatTime(currentTime)} de ${formatTime(duration)}`}
      onClick={(event) => {
        if (!duration) return
        const rect = event.currentTarget.getBoundingClientRect()
        onSeek(((event.clientX - rect.left) / rect.width) * duration)
      }}
    >
      {bars.map((height, index) => (
        <span
          key={`${track?.id || 'empty'}-${index}`}
          className={(index + 0.5) / bars.length <= progress ? 'played' : ''}
          style={{ '--bar-height': `${height * 100}%` }}
        />
      ))}
    </button>
  )
}

function addedDateLabel(value) {
  if (!value) return '—'
  const parsed = new Date(`${value}Z`)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function TrackTable({ tracks, player, onFavorite, onAddToPlaylist, onStyleChange, styleOptions = [], onReorder, onContextMenu, variant = 'standard', emptyText = 'No hay canciones aquí todavía.' }) {
  const draggedIndex = useRef(null)
  const scrollRef = useRef(null)
  const catalog = variant === 'catalog'
  const [catalogSort, setCatalogSort] = useState({ key: 'title', direction: 'asc' })
  const presentedTracks = useMemo(() => {
    if (!catalog) return tracks
    const direction = catalogSort.direction === 'asc' ? 1 : -1
    return [...tracks].sort((left, right) => {
      const leftValue = left[catalogSort.key]
      const rightValue = right[catalogSort.key]
      if (['duration', 'play_count', 'favorite'].includes(catalogSort.key)) {
        return (Number(leftValue || 0) - Number(rightValue || 0)) * direction
      }
      if (catalogSort.key === 'added_at') {
        return ((Date.parse(`${leftValue}Z`) || 0) - (Date.parse(`${rightValue}Z`) || 0)) * direction
      }
      return String(leftValue || '').localeCompare(String(rightValue || ''), 'es', { sensitivity: 'base', numeric: true }) * direction
    })
  }, [catalog, catalogSort, tracks])
  const rowHeight = catalog ? 44 : 60
  const overscan = 6
  const virtualized = !catalog && presentedTracks.length > 36
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 24 })

  const updateVisibleRange = useCallback(() => {
    if (!virtualized || !scrollRef.current) {
      setVisibleRange({ start: 0, end: presentedTracks.length })
      return
    }
    const start = Math.max(0, Math.floor(scrollRef.current.scrollTop / rowHeight) - overscan)
    const rowsInView = Math.ceil(scrollRef.current.clientHeight / rowHeight)
    setVisibleRange({ start, end: Math.min(presentedTracks.length, start + rowsInView + overscan * 2) })
  }, [presentedTracks.length, rowHeight, virtualized])

  useEffect(() => {
    updateVisibleRange()
    const element = scrollRef.current
    if (!element || !globalThis.ResizeObserver) return undefined
    const observer = new ResizeObserver(updateVisibleRange)
    observer.observe(element)
    return () => observer.disconnect()
  }, [updateVisibleRange])

  if (!tracks?.length) {
    return (
      <div className="empty-state">
        <Music2 />
        <h3>{emptyText}</h3>
        <p>Abre las fuentes de música para elegir una carpeta, cargar un JSON o arrastra audio sobre la ventana.</p>
      </div>
    )
  }

  function sortCatalog(key) {
    setCatalogSort((current) => current.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: 'asc' })
  }

  function catalogHeading(label, key, className = '') {
    const active = catalogSort.key === key
    return (
      <span className={className} role="columnheader" aria-sort={active ? (catalogSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" onClick={() => sortCatalog(key)}>{label}<small aria-hidden="true">{active ? (catalogSort.direction === 'asc' ? '↑' : '↓') : ''}</small></button>
      </span>
    )
  }

  const visibleTracks = virtualized ? presentedTracks.slice(visibleRange.start, visibleRange.end) : presentedTracks
  const topSpacer = virtualized ? visibleRange.start * rowHeight : 0
  const bottomSpacer = virtualized ? Math.max(0, (presentedTracks.length - visibleRange.end) * rowHeight) : 0

  return (
    <div className={`track-table ${catalog ? 'is-catalog' : ''} ${virtualized ? 'is-virtualized' : ''}`} role="table" aria-label="Canciones">
      {!catalog && (
        <div className="track-row track-header" role="row">
          <span>#</span><span>Título</span><span>Álbum</span><span>Estilo</span><span>Tiempo</span><span />
        </div>
      )}
      <div className="track-scroll" ref={scrollRef} onScroll={updateVisibleRange}>
      {catalog && (
        <div className="track-row track-header catalog-grid" role="row">
          <span role="columnheader">#</span>
          {catalogHeading('Título', 'title', 'catalog-title-heading')}
          {catalogHeading('Tiempo', 'duration')}
          {catalogHeading('Artista', 'artist')}
          {catalogHeading('Álbum', 'album')}
          {catalogHeading('Género', 'genre')}
          {catalogHeading('Estilo', 'style')}
          {catalogHeading('♡', 'favorite', 'catalog-favorite-heading')}
          {catalogHeading('Escuchas', 'play_count')}
          {catalogHeading('Añadida', 'added_at')}
          <span role="columnheader" aria-label="Acciones" />
        </div>
      )}
      {topSpacer > 0 && <div className="track-virtual-spacer" style={{ height: topSpacer }} aria-hidden="true" />}
      {visibleTracks.map((track, visibleIndex) => {
        const index = visibleRange.start + visibleIndex
        const active = player.currentTrack?.id === track.id
        return (
          <div
            className={`track-row ${catalog ? 'catalog-grid catalog-row' : ''} ${active ? 'is-playing' : ''}`}
            role="row"
            tabIndex={0}
            aria-selected={active}
            aria-label={`Reproducir ${track.title} de ${track.artist}`}
            key={track.id}
            draggable={Boolean(onReorder)}
            onDragStart={() => { draggedIndex.current = index }}
            onDragOver={(event) => {
              if (onReorder) event.preventDefault()
            }}
            onDrop={() => {
              if (onReorder && draggedIndex.current !== null && draggedIndex.current !== index) {
                onReorder(draggedIndex.current, index)
              }
              draggedIndex.current = null
            }}
            onClick={(event) => {
              if (event.target.closest?.('button, select, input, a, textarea, [contenteditable="true"]')) return
              player.playCollection(presentedTracks, index)
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return
              event.preventDefault()
              player.playCollection(presentedTracks, index)
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              onContextMenu?.(track, event, presentedTracks)
            }}
          >
            <button className="row-play" onClick={() => player.playCollection(presentedTracks, index)} aria-label={`Reproducir ${track.title}`}>
              {active && player.playing ? <AudioLines /> : <span>{index + 1}</span>}
            </button>
            {catalog ? (
              <>
                <div className="track-title-cell catalog-title-cell" role="cell" title={track.title}>
                  <strong>{track.title}</strong>
                  {active && player.spatial && <DolbyAtmosLogo />}
                </div>
                <span className="catalog-time" role="cell">{formatTime(track.duration)}</span>
                <span className="catalog-text-cell" role="cell" title={track.artist}>{track.artist}</span>
                <span className="catalog-text-cell" role="cell" title={track.album}>{track.album}</span>
                <span className="catalog-text-cell" role="cell" title={track.genre || 'Sin género'}>{track.genre || 'Sin género'}</span>
                <span className="catalog-style-cell" role="cell">
                  {onStyleChange && track.sourceKind !== '8spine' ? (
                    <select
                      className="mood-select"
                      value={track.style || ''}
                      aria-label={`Estilo de ${track.title}`}
                      title={`Ambiente: ${track.manual_mood || track.auto_mood || 'sin analizar'}`}
                      onChange={(event) => onStyleChange(track, event.target.value || null)}
                    >
                      <option value="">Sin estilo</option>
                      {styleOptions.map((style) => <option key={style} value={style}>{style}</option>)}
                    </select>
                  ) : <span className="mood-readonly">{track.style || 'Sin estilo'}</span>}
                </span>
                <span className="catalog-favorite-cell" role="cell">
                  {onFavorite && track.sourceKind !== '8spine' ? (
                    <IconButton label={track.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'} active={track.favorite} onClick={() => onFavorite(track)}><Heart fill={track.favorite ? 'currentColor' : 'none'} /></IconButton>
                  ) : <Heart aria-label={track.favorite ? 'Favorita' : 'No favorita'} fill={track.favorite ? 'currentColor' : 'none'} />}
                </span>
                <span className="catalog-number-cell" role="cell">{Number(track.play_count || 0).toLocaleString('es-ES')}</span>
                <span className="catalog-date-cell" role="cell" title={track.added_at || ''}>{addedDateLabel(track.added_at)}</span>
                <span className="row-actions catalog-actions" role="cell">
                  {onAddToPlaylist && <IconButton label="Añadir a playlist" onClick={() => onAddToPlaylist(track)}><Plus /></IconButton>}
                </span>
              </>
            ) : (
              <>
                <div className="track-title-cell">
                  <Cover track={track} size="small" />
                  <span>
                    <strong>{track.title}</strong>
                    <small>{track.artist}{track.sourceKind === '8spine' ? ` · enlace de ${track.sourceName}` : ''}</small>
                    <QualityBadges track={track} spatial={active && player.spatial} />
                  </span>
                </div>
                <span className="cell-secondary">{track.album}</span>
                <span>
                  {onStyleChange && track.sourceKind !== '8spine' ? (
                    <select
                      className="mood-select"
                      value={track.style || ''}
                      aria-label={`Estilo de ${track.title}`}
                      title={`Ambiente: ${track.manual_mood || track.auto_mood || 'sin analizar'}`}
                      onChange={(event) => onStyleChange(track, event.target.value || null)}
                    >
                      <option value="">Sin estilo</option>
                      {styleOptions.map((style) => <option key={style} value={style}>{style}</option>)}
                    </select>
                  ) : <span className="mood-readonly">{track.style || 'Sin estilo'}</span>}
                </span>
                <span className="cell-secondary">{formatTime(track.duration)}</span>
                <span className="row-actions">
                  {onFavorite && track.sourceKind !== '8spine' && <IconButton label={track.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'} active={track.favorite} onClick={() => onFavorite(track)}><Heart fill={track.favorite ? 'currentColor' : 'none'} /></IconButton>}
                  {onAddToPlaylist && <IconButton label="Añadir a playlist" onClick={() => onAddToPlaylist(track)}><Plus /></IconButton>}
                </span>
              </>
            )}
          </div>
        )
      })}
      {bottomSpacer > 0 && <div className="track-virtual-spacer" style={{ height: bottomSpacer }} aria-hidden="true" />}
      </div>
    </div>
  )
}

function HomeView({
  summary,
  player,
  onView,
  recommendation,
  recommendationLoading,
  stationLoading,
  onRefreshWeekly,
  onStartStation,
  onPlayRecommendation,
  visualizerVariant,
  stationFx,
  onContextMenu,
}) {
  const heroTrack = player.currentTrack || summary.recent?.[0]
  const weeklyTracks = recommendation?.tracks || []
  const discoveryTracks = weeklyTracks.length ? weeklyTracks : (summary.recent || [])
  const replayTracks = summary.recentlyPlayed?.length ? summary.recentlyPlayed : summary.recent
  return (
    <motion.div className="view-stack" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}>
      <ElectricDisplacementFilter />
      <section
        className="listening-stage"
        onContextMenu={heroTrack ? (event) => { event.preventDefault(); onContextMenu?.(heroTrack, event, player.queue.length ? player.queue : summary.recent) } : undefined}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          event.currentTarget.style.setProperty('--hero-x', `${(event.clientX - rect.left) / rect.width - 0.5}`)
          event.currentTarget.style.setProperty('--hero-y', `${(event.clientY - rect.top) / rect.height - 0.5}`)
        }}
        onPointerLeave={(event) => {
          event.currentTarget.style.setProperty('--hero-x', '0')
          event.currentTarget.style.setProperty('--hero-y', '0')
        }}
      >
        {heroTrack?.artworkUrl && <div className="stage-art-blur" style={{ backgroundImage: `url(${heroTrack.artworkUrl})` }} />}
        <div className="stage-copy">
          <span className="stage-kicker">{player.currentTrack ? 'Sonando ahora' : 'Tu colección, preparada'}</span>
          <h1>{heroTrack?.title || 'La música vuelve a ser el centro.'}</h1>
          <p>{heroTrack ? `${heroTrack.artist} · ${heroTrack.album}` : 'Elige una carpeta o un catálogo JSON para empezar a escuchar.'}</p>
          <QualityBadges track={heroTrack} spatial={player.spatial} />
          {heroTrack && (
            <button
              className="button button-primary stage-action"
              onClick={() => player.currentTrack ? player.toggle() : player.playCollection(summary.recent, 0)}
            >
              {player.currentTrack && player.playing ? <Pause /> : <Play fill="currentColor" />}
              {player.currentTrack && player.playing ? 'Pausar' : 'Reproducir'}
            </button>
          )}
        </div>
        <div className="stage-visual">
          <motion.div
            className="stage-cover-motion"
            key={heroTrack?.id || 'empty'}
            initial={{ opacity: 0, scale: 0.96, filter: 'blur(8px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          >
            <Cover track={heroTrack} size="hero" />
          </motion.div>
          <Visualizer analyser={player.analyser} playing={player.playing} variant={visualizerVariant} />
        </div>
      </section>

      <section className="discovery-layout">
        <article className="weekly-discovery">
          <div className="weekly-mosaic" aria-label="Selección de carátulas de Descubrimiento semanal">
            {discoveryTracks.slice(0, 4).map((track) => (
              <Cover key={track.id} track={track} size="album" />
            ))}
            {!weeklyTracks.length && recommendationLoading && <div className="weekly-mosaic-loading"><BrainCircuit /></div>}
          </div>
          <div className="weekly-copy">
            <span>Actualizada cada lunes para ti</span>
            <h2>Descubrimiento semanal</h2>
            <p>
              Una selección personal construida por cómo suena tu música y por lo que decides escuchar,
              guardar o saltar.
            </p>
            <div className="weekly-actions">
              <button
                className="button button-primary button-large"
                onClick={() => weeklyTracks.length ? onPlayRecommendation(0) : player.playCollection(discoveryTracks, 0, { intent: 'discover' })}
                disabled={!discoveryTracks.length}
              >
                <Play fill="currentColor" /> Reproducir
              </button>
              <button className="icon-button weekly-refresh" onClick={onRefreshWeekly} disabled={recommendationLoading} aria-label="Actualizar Descubrimiento semanal">
                <RefreshCw className={recommendationLoading ? 'spin' : ''} />
              </button>
            </div>
            {recommendation?.analysisRequired && <small>Sonora está terminando de conocer el sonido de tu biblioteca.</small>}
          </div>
        </article>

        <aside className="listen-again">
          <div className="listen-again-heading"><h2>Volver a escuchar</h2><span>Tu rotación reciente</span></div>
          <div className="listen-again-list">
            {replayTracks?.slice(0, 5).map((track, index) => (
              <button key={track.id} onClick={() => player.playCollection(replayTracks, index)} onContextMenu={(event) => { event.preventDefault(); onContextMenu?.(track, event, replayTracks) }}>
                <Cover track={track} size="small" />
                <span><strong>{track.title}</strong><small>{track.artist}</small></span>
                <Play />
              </button>
            ))}
          </div>
        </aside>
      </section>

      <section>
        <div className="section-heading">
          <div><h2>Estaciones personales</h2><p>Elige una dirección; Sonora se ocupa de que la sesión tenga sentido.</p></div>
        </div>
        <div className={`station-strip station-fx-${stationFx || 'signature'}`}>
          {Object.entries(INTENT_META).filter(([id]) => id !== 'discover').map(([id, meta], index) => {
            const Icon = meta.icon
            const stationTrack = discoveryTracks[index + 1] || summary.recent?.[index]
            return (
              <button key={id} className={`station-tile station-${id}`} onClick={() => onStartStation(id)} disabled={stationLoading === id}>
                <Cover track={stationTrack} size="album" />
                {id !== 'move' && (
                  <span className="station-effect" aria-hidden="true">
                    {Array.from({ length: 10 }, (_, effectIndex) => <i key={effectIndex} style={{ '--effect-index': effectIndex }} />)}
                  </span>
                )}
                <span className="station-icon"><Icon /></span>
                <strong>{meta.label}</strong>
                <small>{stationLoading === id ? 'Preparando estación…' : meta.description}</small>
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <div className="section-heading">
          <div><h2>Recién añadidas</h2><p>{summary.totals?.tracks || 0} canciones · {compactDuration(summary.totals?.duration || 0)}</p></div>
          <button className="text-button" onClick={() => onView('songs')}>Ver biblioteca</button>
        </div>
        <div className="album-strip">
          {summary.recent?.slice(0, 8).map((track, index) => (
            <button key={track.id} className="album-tile" onClick={() => player.playCollection(summary.recent, index)} onContextMenu={(event) => { event.preventDefault(); onContextMenu?.(track, event, summary.recent) }}>
              <Cover track={track} size="album" />
              <strong>{track.title}</strong>
              <span>{track.artist}</span>
            </button>
          ))}
        </div>
      </section>
    </motion.div>
  )
}

function AlbumsView({ tracks, player, onContextMenu }) {
  const albums = useMemo(() => {
    const map = new Map()
    tracks.forEach((track) => {
      const key = `${track.album}::${track.artist}`
      if (!map.has(key)) map.set(key, { album: track.album, artist: track.artist, tracks: [], sample: track })
      map.get(key).tracks.push(track)
    })
    return [...map.values()]
  }, [tracks])

  return (
    <div className="album-grid">
      {albums.map((album) => (
        <button key={`${album.album}-${album.artist}`} className="album-card" onClick={() => player.playCollection(album.tracks, 0)} onContextMenu={(event) => { event.preventDefault(); onContextMenu?.(album.sample, event, album.tracks) }}>
          <Cover track={album.sample} size="album" />
          <strong>{album.album}</strong>
          <span>{album.artist} · {album.tracks.length} canciones</span>
        </button>
      ))}
    </div>
  )
}

function GroupsView({ tracks, type, player, onOpen }) {
  const groups = useMemo(() => {
    const map = new Map()
    tracks.forEach((track) => {
      const labels = type === 'artists'
        ? [track.artist || 'Artista desconocido']
        : splitGenres(track.genre)
      labels.forEach((label) => {
        const normalized = label.toLocaleLowerCase('es')
        if (!map.has(normalized)) map.set(normalized, { name: label, tracks: [] })
        if (!map.get(normalized).tracks.some((item) => item.id === track.id)) {
          map.get(normalized).tracks.push(track)
        }
      })
    })
    return [...map.values()].sort((left, right) => left.name.localeCompare(right.name, 'es'))
  }, [tracks, type])
  const Icon = type === 'artists' ? Mic2 : Library

  return (
    <div className="group-list">
      {groups.map(({ name, tracks: groupTracks }) => (
        <button key={name} className="group-row" onClick={() => type === 'artists' && onOpen ? onOpen(name) : player.playCollection(groupTracks, 0)}>
          <span className="group-icon"><Icon /></span>
          <span><strong>{name}</strong><small>{groupTracks.length} canciones · {compactDuration(groupTracks.reduce((sum, track) => sum + track.duration, 0))}</small></span>
          {type === 'artists' && onOpen ? <ChevronRight /> : <Play />}
        </button>
      ))}
    </div>
  )
}

function PlaylistsView({ playlists, onCreate, onDelete, onRename, onOpen }) {
  const [name, setName] = useState('')

  return (
    <div className="playlists-layout">
      <form
        className="playlist-create"
        onSubmit={(event) => {
          event.preventDefault()
          onCreate(name)
          setName('')
        }}
      >
        <span className="playlist-create-icon"><Plus /></span>
        <div><h3>Nueva playlist</h3><p>Reúne una sesión a tu manera.</p></div>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre de la playlist" aria-label="Nombre de la playlist" required />
        <button className="button button-primary">Crear</button>
      </form>
      <div className="playlist-list">
        {playlists.map((playlist) => (
          <div className="playlist-row" key={playlist.id}>
            <button className="playlist-open" onClick={() => onOpen(playlist)}>
              <span className="playlist-art"><ListMusic /></span>
              <span><strong>{playlist.name}</strong><small>{playlist.trackCount || 0} canciones</small></span>
            </button>
            <IconButton label={`Renombrar ${playlist.name}`} onClick={() => onRename(playlist)}><Pencil /></IconButton>
            <IconButton label={`Eliminar ${playlist.name}`} onClick={() => onDelete(playlist.id)}><Trash2 /></IconButton>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatEuro(cents) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format((cents || 0) / 100)
}

function NetworkAccessCard({ network, compact = false }) {
  const localUrl = network?.localUrls?.[0]
  const vpnUrl = network?.vpnUrls?.[0]
  async function copy(value) {
    if (value) await navigator.clipboard.writeText(value)
  }
  return (
    <section className={`network-card ${compact ? 'compact' : ''}`}>
      <div className="network-card-heading"><Network /><div><strong>Acceso desde otros dispositivos</strong><small>{network?.hostname || 'Este equipo'} · puerto {network?.port || 3000}</small></div></div>
      <div className="network-addresses">
        <div><span>Red local</span><strong>{localUrl || 'Buscando dirección local…'}</strong>{localUrl && <button type="button" className="icon-button" aria-label="Copiar dirección local" onClick={() => copy(localUrl)}><Copy /></button>}</div>
        {vpnUrl && <div><span>Red privada</span><strong>{vpnUrl}</strong><button type="button" className="icon-button" aria-label="Copiar dirección de red privada" onClick={() => copy(vpnUrl)}><Copy /></button></div>}
        <div><span>Desde fuera</span><strong>{network?.remoteUrl || 'Configura una URL pública segura'}</strong>{network?.remoteUrl && <button type="button" className="icon-button" aria-label="Copiar dirección externa" onClick={() => copy(network.remoteUrl)}><Copy /></button>}</div>
      </div>
      {!compact && <p>En tu Wi-Fi, abre la dirección local. Desde fuera, utiliza una VPN privada o define <code>SONORA_PUBLIC_URL</code> detrás de HTTPS. No expongas directamente el puerto 3000 sin cifrado.</p>}
    </section>
  )
}

function AuthView({ network, hasUsers, registrationOpen, onAuthenticate }) {
  const canRegister = !hasUsers || registrationOpen
  const [mode, setMode] = useState(hasUsers ? 'login' : 'register')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onAuthenticate(mode, { displayName, email, password })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-intro">
        <span className="auth-brand"><BrandLogo /><span>Sonora</span></span>
        <div><span className="eyebrow">Tu biblioteca, tus datos</span><h1>Escucha desde cualquier pantalla de tu red.</h1><p>Tu cuenta conserva consumos, compras, letras y playlists por separado en la base de datos de este equipo.</p></div>
        <NetworkAccessCard network={network} />
      </section>
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className={`auth-tabs ${canRegister ? '' : 'single'}`} role="tablist">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError('') }}>Iniciar sesión</button>
          {canRegister && <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError('') }}>Crear cuenta</button>}
        </div>
        <div className="auth-copy"><span>{mode === 'login' ? 'Qué bueno verte' : 'Primera escucha'}</span><h2 id="auth-title">{mode === 'login' ? 'Vuelve a tu música.' : 'Crea tu perfil de Sonora.'}</h2><p>{mode === 'login' ? 'Continúa con tu historial y tus ajustes.' : 'La primera cuenta heredará los datos locales que ya tenías.'}</p></div>
        <form className="auth-form" onSubmit={submit}>
          {mode === 'register' && <label>Nombre visible<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" minLength="2" required placeholder="Tu nombre" /></label>}
          <label>Correo electrónico<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="tu@correo.com" /></label>
          <label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength="8" required placeholder="8 caracteres como mínimo" /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary button-large" disabled={saving}>{saving ? 'Comprobando…' : mode === 'login' ? 'Entrar en Sonora' : 'Crear cuenta'}</button>
        </form>
      </section>
    </main>
  )
}

function AccountView({ user, overview, network, purchases, onSaveProfile, onDeleteListen, onLogout, onOpenPlaylists, onOpenShop, canManage }) {
  const [displayName, setDisplayName] = useState(user.displayName)
  const [email, setEmail] = useState(user.email)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      await onSaveProfile({ displayName, email })
      setMessage('Perfil actualizado')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }

  const counts = overview?.counts || {}
  const activityLabels = {
    account_registered: 'Cuenta creada',
    session_started: 'Inicio de sesión',
    track_listened: 'Escucha registrada',
    tokens_paid: 'Consumo liquidado',
    shop_purchase: 'Compra realizada',
    purchase_refunded: 'Compra restaurada',
    playlist_created: 'Playlist creada',
    playlist_track_added: 'Canción añadida a playlist',
    playlists_imported: 'Playlists importadas',
    catalog_styles_imported: 'Estilos del catálogo importados',
    custom_style_created: 'Estilo personalizado creado',
    custom_style_deleted: 'Estilo personalizado eliminado',
    lyrics_saved: 'Letra guardada',
    profile_updated: 'Perfil actualizado',
  }
  return (
    <div className="account-view">
      <header className="account-hero"><div className="account-avatar">{user.displayName.slice(0, 1).toUpperCase()}</div><div><span>{user.isAdmin ? 'Administrador local' : 'Cuenta de oyente'}</span><h2>{user.displayName}</h2><p>{user.email}</p></div><button className="button button-secondary" onClick={onLogout}><LogOut /> Cerrar sesión</button></header>
      <div className="account-metrics">
        <article><strong>{counts.listens || 0}</strong><span>escuchas registradas</span></article>
        <article><strong>{counts.playlists || 0}</strong><span>playlists</span></article>
        <article><strong>{counts.purchases || 0}</strong><span>compras activas</span></article>
        <article><strong>{formatTokenAmount(counts.consumedTokens)}</strong><span>tokens consumidos</span></article>
      </div>
      <div className="account-grid">
        <section className="account-card"><div className="section-heading"><div><h3>Datos de acceso</h3><p>{canManage ? 'Puedes modificar el nombre y el correo asociados.' : 'El administrador gestiona los datos de acceso de esta cuenta.'}</p></div></div>{canManage ? <form className="account-form" onSubmit={save}><label>Nombre<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength="2" required /></label><label>Correo<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>{message && <small>{message}</small>}<button className="button button-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button></form> : <div className="listener-access"><Headphones /><div><strong>Modo oyente</strong><p>Puedes escuchar y usar los objetos que compres; la biblioteca permanece protegida.</p></div></div>}</section>
        <NetworkAccessCard network={network} compact />
      </div>
      <section className="account-card account-collections"><div className="section-heading"><div><h3>Contenido de tu cuenta</h3><p>Compras y preferencias vinculadas a este usuario.</p></div></div><div className="account-shortcuts">{canManage && <button className="button button-secondary" onClick={onOpenPlaylists}><ListMusic /> Gestionar {overview?.playlists?.length || 0} playlists</button>}<button className="button button-secondary" onClick={onOpenShop}><RotateCcw /> Restaurar compras ({purchases.filter((item) => item.canRefund).length})</button></div></section>
      <section className="account-card"><div className="section-heading"><div><h3>Registro de actividad</h3><p>Escuchas, pagos, compras, letras y cambios de tu usuario.</p></div></div><div className="account-activity">{overview?.activities?.length ? overview.activities.map((activity) => <div key={activity.id}><span className="history-icon"><Activity /></span><span><strong>{activityLabels[activity.type] || activity.type.replaceAll('_', ' ')}</strong><small>{new Date(`${activity.createdAt}Z`).toLocaleString('es-ES')}</small></span></div>) : <p className="empty-copy">La actividad de tu cuenta aparecerá aquí.</p>}</div></section>
      <section className="account-card"><div className="section-heading"><div><h3>Historial de escucha</h3><p>{canManage ? 'Puedes eliminar entradas; los cargos ya registrados mantienen su recibo.' : 'Tu actividad de escucha es privada para esta cuenta.'}</p></div></div><div className="account-listens">{overview?.listens?.length ? overview.listens.map((listen) => <div key={listen.id}><span><strong>{listen.title}</strong><small>{listen.artist} · {formatTime(listen.seconds)} · {new Date(`${listen.listenedAt}Z`).toLocaleString('es-ES')}</small></span>{canManage && <button className="icon-button" aria-label={`Eliminar escucha de ${listen.title}`} onClick={() => onDeleteListen(listen.id)}><Trash2 /></button>}</div>) : <p className="empty-copy">Todavía no hay escuchas guardadas.</p>}</div></section>
    </div>
  )
}

function ShopPreview({ item, large = false }) {
  const icon = {
    ribbon: Activity,
    studio: Disc3,
    eq: SlidersHorizontal,
    ink: Sparkles,
    palette: Palette,
    soundlab: AudioLines,
    aurora: Waves,
    constellation: Sparkles,
    glass: Sparkles,
  }[item.preview] || PackageCheck
  const PreviewIcon = icon
  return (
    <div className={`shop-preview preview-${item.preview} ${large ? 'large' : ''}`}>
      <span className="preview-field" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => <i key={index} style={{ '--preview-index': index }} />)}
      </span>
      <PreviewIcon />
      {item.equipped && <span className="equipped-mark"><Check /> Equipado</span>}
    </div>
  )
}

function ShopView({ items, wallet, history, purchases, onOpenProduct, onConfigure, onEquip, onTopUp, onRefund }) {
  const [section, setSection] = useState('catalog')
  const [category, setCategory] = useState('Todo')
  const categories = useMemo(() => ['Todo', ...new Set(items.map((item) => item.category))], [items])
  const filteredItems = category === 'Todo' ? items : items.filter((item) => item.category === category)
  const ownedItems = items.filter((item) => item.owned)
  const featured = items.find((item) => item.id === 'theme-liquid-glass') || items.find((item) => !item.owned) || items[0]

  function ownedAction(item) {
    if (item.slot) onEquip(item)
    else onConfigure(item)
  }

  return (
    <div className="shop-layout">
      <section className="shop-header">
        <div>
          <span>Archivo de objetos</span>
          <h2>La música también se puede vestir.</h2>
          <p>Prueba cada objeto en vivo, desbloquéalo con Puntos o euros y equípalo sin salir de Sonora.</p>
        </div>
        <div className="points-balance">
          <PointsLogo />
          <span><strong>{wallet?.points || 0}</strong> Puntos disponibles</span>
          <button className="button button-primary" onClick={onTopUp}><Plus /> Añadir Puntos</button>
        </div>
      </section>

      <nav className="shop-tabs" aria-label="Secciones de la tienda">
        <button className={section === 'catalog' ? 'active' : ''} onClick={() => setSection('catalog')}><ShoppingBag /> Catálogo</button>
        <button className={section === 'library' ? 'active' : ''} onClick={() => setSection('library')}><PackageCheck /> Mis objetos <span>{ownedItems.length}</span></button>
        <button className={section === 'restore' ? 'active' : ''} onClick={() => setSection('restore')}><RotateCcw /> Restaurar compras <span>{purchases.filter((item) => item.canRefund).length}</span></button>
        <button className={section === 'history' ? 'active' : ''} onClick={() => setSection('history')}><ReceiptText /> Historial</button>
      </nav>

      {section === 'catalog' && (
        <>
          {featured && (
            <article className="shop-featured">
              <ShopPreview item={featured} large />
              <div>
                <span className="shop-category">Objeto destacado · {featured.category}</span>
                <h3>{featured.name}</h3>
                <p>{featured.description}</p>
                <div className="dual-price">
                  <span><PointsLogo /> {featured.price.toLocaleString('es-ES')} Puntos</span>
                  <span><CreditCard /> {formatEuro(featured.moneyPriceCents)}</span>
                </div>
                <button className="button button-primary button-large" onClick={() => featured.owned ? ownedAction(featured) : onOpenProduct(featured)}>
                  {featured.equipped ? 'Desequipar' : featured.owned ? featured.slot ? 'Equipar ahora' : 'Configurar' : 'Ver objeto'} <ChevronRight />
                </button>
              </div>
            </article>
          )}

          <div className="shop-category-filter" aria-label="Categorías">
            {categories.map((name) => <button key={name} className={category === name ? 'active' : ''} onClick={() => setCategory(name)}>{name}</button>)}
          </div>
          <div className="shop-catalog">
            {filteredItems.filter((item) => item.id !== featured?.id).map((item) => (
              <article className="shop-product" key={item.id}>
                <ShopPreview item={item} />
                <div className="shop-product-copy">
                  <span className="shop-category">{item.category}</span>
                  <h3>{item.name}</h3>
                  <p>{item.description}</p>
                  <div className="dual-price compact">
                    <span>{item.price.toLocaleString('es-ES')} Puntos</span>
                    <span>{formatEuro(item.moneyPriceCents)}</span>
                  </div>
                  <button className="button button-secondary" onClick={() => item.owned ? ownedAction(item) : onOpenProduct(item)}>
                    {item.equipped ? 'Desequipar' : item.owned ? item.slot ? 'Equipar' : 'Configurar' : 'Explorar'} <ChevronRight />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {section === 'library' && (
        <section className="shop-library">
          <div className="section-heading"><div><h2>Mis objetos</h2><p>Todo lo que has desbloqueado, listo para combinar.</p></div></div>
          {ownedItems.length ? ownedItems.map((item) => (
            <article key={item.id} className={`owned-object ${item.equipped ? 'equipped' : ''}`}>
              <ShopPreview item={item} />
              <div><span>{item.category}</span><h3>{item.name}</h3><p>{item.description}</p></div>
              <button className={`button ${item.equipped ? 'button-primary' : 'button-secondary'}`} onClick={() => ownedAction(item)}>
                {item.equipped ? <><Check /> Equipado</> : item.slot ? 'Equipar' : 'Configurar'}
              </button>
            </article>
          )) : <div className="empty-inline"><PackageCheck /><p>Tus objetos aparecerán aquí cuando desbloquees el primero.</p></div>}
        </section>
      )}

      {section === 'history' && (
        <section className="shop-history">
          <div className="section-heading"><div><h2>Historial local</h2><p>Compras y recargas guardadas únicamente en este equipo.</p></div></div>
          {history.length ? history.map((entry) => (
            <div className="history-row" key={entry.id}>
              <span className={`history-icon history-${entry.type}`}>{entry.type === 'topup' ? <Plus /> : <ShoppingBag />}</span>
              <span><strong>{entry.type === 'topup' ? 'Recarga de Puntos' : entry.itemName || 'Objeto'}</strong><small>{new Date(`${entry.createdAt}Z`).toLocaleString('es-ES')}</small></span>
              <b>{entry.points ? `${entry.points > 0 ? '+' : ''}${entry.points.toLocaleString('es-ES')} Puntos` : formatEuro(entry.moneyCents)}</b>
            </div>
          )) : <div className="empty-inline"><ReceiptText /><p>Todavía no hay movimientos.</p></div>}
        </section>
      )}

      {section === 'restore' && (
        <section className="shop-library restore-purchases">
          <div className="section-heading"><div><h2>Restaurar compras</h2><p>Recupera el importe íntegro durante los 7 días posteriores a la compra. El objeto se retirará de tu cuenta.</p></div></div>
          {purchases.length ? purchases.map((purchase) => (
            <article className={`purchase-restore-row ${purchase.refundedAt ? 'is-refunded' : ''}`} key={purchase.id}>
              <span className="history-icon"><RotateCcw /></span>
              <div><strong>{purchase.itemName}</strong><small>Comprado el {new Date(`${purchase.purchasedAt}Z`).toLocaleString('es-ES')}</small><small>{purchase.refundedAt ? `Restaurado el ${new Date(`${purchase.refundedAt}Z`).toLocaleString('es-ES')}` : purchase.canRefund ? `Disponible hasta ${new Date(`${purchase.refundableUntil}Z`).toLocaleString('es-ES')}` : 'Plazo de 7 días finalizado'}</small></div>
              <b>{purchase.currency === 'points' ? `${purchase.pointsPaid.toLocaleString('es-ES')} Puntos` : formatEuro(purchase.moneyPaidCents)}</b>
              <button className="button button-secondary" disabled={!purchase.canRefund} onClick={() => onRefund(purchase)}>{purchase.refundedAt ? <><Check /> Restaurada</> : purchase.canRefund ? <><RotateCcw /> Devolver íntegro</> : <><Clock3 /> Fuera de plazo</>}</button>
            </article>
          )) : <div className="empty-inline"><ReceiptText /><p>Aún no hay compras que restaurar.</p></div>}
        </section>
      )}
    </div>
  )
}

function ProductDetail({ item, wallet, onClose, onComplete, onTopUp }) {
  const [currency, setCurrency] = useState(wallet?.points >= item.price ? 'points' : 'money')
  const [method, setMethod] = useState('card')
  const [cardNumber, setCardNumber] = useState('')
  const [cardHolder, setCardHolder] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvc, setCvc] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const canUsePoints = (wallet?.points || 0) >= item.price

  async function checkout(event) {
    event.preventDefault()
    if (currency === 'points' && !canUsePoints) return
    setProcessing(true)
    setError('')
    try {
      await onComplete({
        itemId: item.id,
        currency,
        method: currency === 'money' ? method : undefined,
        cardNumber: currency === 'money' ? cardNumber : undefined,
      })
      onClose()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="product-detail" role="dialog" aria-modal="true" aria-labelledby="product-title" initial={{ x: 28 }} animate={{ x: 0 }} exit={{ x: 28 }}>
        <div className="drawer-heading">
          <div><span>Vista previa en vivo</span><h2 id="product-title">{item.name}</h2></div>
          <IconButton label="Cerrar" onClick={onClose}><X /></IconButton>
        </div>
        <ShopPreview item={item} large />
        <div className="product-detail-copy">
          <span className="shop-category">{item.category}</span>
          <p>{item.description}</p>
        </div>
        {item.owned ? (
          <div className="product-owned-state">
            <Check />
            <div><strong>Este objeto ya está en tu colección.</strong><p>{item.equipped ? 'También está equipado en este momento.' : 'Puedes equiparlo o configurarlo desde Mis objetos.'}</p></div>
            <button className="button button-secondary" type="button" onClick={onClose}>Cerrar ficha</button>
          </div>
        ) : (
          <form onSubmit={checkout} className="checkout-form">
          <fieldset className="currency-selector">
            <legend>Elige cómo desbloquearlo</legend>
            <label className={currency === 'points' ? 'selected' : ''}>
              <input type="radio" name="currency" value="points" checked={currency === 'points'} onChange={() => setCurrency('points')} />
              <PointsLogo /><span><strong>{item.price.toLocaleString('es-ES')} Puntos</strong><small>Saldo: {wallet?.points || 0}</small></span>
            </label>
            <label className={currency === 'money' ? 'selected' : ''}>
              <input type="radio" name="currency" value="money" checked={currency === 'money'} onChange={() => setCurrency('money')} />
              <CreditCard /><span><strong>{formatEuro(item.moneyPriceCents)}</strong><small>Tarjeta o PayPal</small></span>
            </label>
          </fieldset>

          {currency === 'points' && (
            canUsePoints ? (
              <div className="points-confirmation"><PointsLogo /><p>Se descontarán <strong>{item.price.toLocaleString('es-ES')} Puntos</strong>. No se solicitará ningún dato de pago.</p></div>
            ) : (
              <div className="points-confirmation insufficient"><PointsLogo /><p>Te faltan <strong>{(item.price - (wallet?.points || 0)).toLocaleString('es-ES')} Puntos</strong>.</p><button type="button" className="text-button" onClick={onTopUp}>Añadir Puntos</button></div>
            )
          )}

          {currency === 'money' && (
            <>
              <div className="payment-assurance"><ShieldCheck /><p><strong>Pago protegido.</strong> El recibo conservará únicamente el método, la marca y los últimos cuatro dígitos.</p></div>
              <fieldset>
                <legend>Método de pago</legend>
                <label className={method === 'card' ? 'selected' : ''}><input type="radio" name="method" checked={method === 'card'} onChange={() => setMethod('card')} /> Tarjeta</label>
                <label className={method === 'paypal' ? 'selected' : ''}><input type="radio" name="method" checked={method === 'paypal'} onChange={() => setMethod('paypal')} /> PayPal</label>
              </fieldset>
              {method === 'card' && (
                <div className="checkout-card-fields">
                  <label>Titular de la tarjeta<input autoComplete="cc-name" placeholder="Nombre y apellidos" value={cardHolder} onChange={(event) => setCardHolder(event.target.value)} required /></label>
                  <label>Número de tarjeta<input inputMode="numeric" autoComplete="cc-number" placeholder="1234 5678 9012 3456" value={cardNumber} onChange={(event) => setCardNumber(event.target.value.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim())} minLength="15" required /></label>
                  <div className="field-pair"><label>Caducidad<input inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA" value={expiry} onChange={(event) => setExpiry(event.target.value.replace(/[^\d/]/g, '').slice(0, 5))} required /></label><label>CVC<input placeholder="123" inputMode="numeric" autoComplete="cc-csc" value={cvc} onChange={(event) => setCvc(event.target.value.replace(/\D/g, '').slice(0, 4))} minLength="3" required /></label></div>
                  <small>Solo se conservarán la marca y los últimos cuatro dígitos.</small>
                </div>
              )}
              {method === 'paypal' && <div className="paypal-placeholder">Confirma el pago con PayPal al pulsar el botón inferior.</div>}
            </>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="checkout-total"><span>Total</span><strong>{currency === 'points' ? `${item.price.toLocaleString('es-ES')} Puntos` : formatEuro(item.moneyPriceCents)}</strong></div>
          <button className="button button-primary button-large" disabled={processing || (currency === 'points' && !canUsePoints)}>
            {processing ? 'Desbloqueando…' : 'Desbloquear objeto'}
          </button>
          </form>
        )}
      </motion.section>
    </motion.div>
  )
}

function TopUp({ onClose, onComplete }) {
  const bundles = [
    { points: 100, price: '0,99 €' },
    { points: 300, price: '2,49 €' },
    { points: 750, price: '4,99 €' },
  ]
  const [bundle, setBundle] = useState(bundles[1])
  const [method, setMethod] = useState('card')
  const [cardNumber, setCardNumber] = useState('')
  const [cardHolder, setCardHolder] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvc, setCvc] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setProcessing(true)
    setError('')
    try {
      await onComplete({ points: bundle.points, method, cardNumber })
      onClose()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <motion.div className="modal-backdrop centered" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="topup-panel" role="dialog" aria-modal="true" aria-labelledby="topup-title" initial={{ y: 16 }} animate={{ y: 0 }} exit={{ y: 16 }}>
        <div className="drawer-heading">
          <div><span>Saldo de Puntos</span><h2 id="topup-title">Añadir Puntos</h2></div>
          <IconButton label="Cerrar" onClick={onClose}><X /></IconButton>
        </div>
        <div className="payment-assurance">
          <ShieldCheck /><p><strong>Pago protegido.</strong> Revisa el paquete y confirma los datos antes de continuar.</p>
        </div>
        <form className="checkout-form" onSubmit={submit}>
          <fieldset className="topup-bundles">
            <legend>Elige un paquete</legend>
            {bundles.map((option) => (
              <label key={option.points} className={bundle.points === option.points ? 'selected' : ''}>
                <input type="radio" name="bundle" checked={bundle.points === option.points} onChange={() => setBundle(option)} />
                <span><strong>{option.points} Puntos</strong><small>{option.price}</small></span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Método de pago</legend>
            <label className={method === 'card' ? 'selected' : ''}><input type="radio" name="topup-method" checked={method === 'card'} onChange={() => setMethod('card')} /> Tarjeta</label>
            <label className={method === 'paypal' ? 'selected' : ''}><input type="radio" name="topup-method" checked={method === 'paypal'} onChange={() => setMethod('paypal')} /> PayPal</label>
          </fieldset>
          {method === 'card' && <div className="checkout-card-fields"><label>Titular de la tarjeta<input autoComplete="cc-name" placeholder="Nombre y apellidos" value={cardHolder} onChange={(event) => setCardHolder(event.target.value)} required /></label><label>Número de tarjeta<input inputMode="numeric" autoComplete="cc-number" placeholder="1234 5678 9012 3456" value={cardNumber} onChange={(event) => setCardNumber(event.target.value.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim())} minLength="15" required /></label><div className="field-pair"><label>Caducidad<input inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA" value={expiry} onChange={(event) => setExpiry(event.target.value.replace(/[^\d/]/g, '').slice(0, 5))} required /></label><label>CVC<input inputMode="numeric" autoComplete="cc-csc" placeholder="123" value={cvc} onChange={(event) => setCvc(event.target.value.replace(/\D/g, '').slice(0, 4))} minLength="3" required /></label></div></div>}
          {method === 'paypal' && <div className="paypal-placeholder">Confirma el pago con PayPal al pulsar el botón inferior.</div>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="checkout-total"><span>Total</span><strong>{bundle.price}</strong></div>
          <button className="button button-primary button-large" disabled={processing}>{processing ? 'Procesando pago…' : `Pagar ${bundle.price}`}</button>
        </form>
      </motion.section>
    </motion.div>
  )
}

function AppearancePanel({ appearance, onChange, onClose }) {
  const accents = [
    { id: 'olive', label: 'Cobre' },
    { id: 'coral', label: 'Coral' },
    { id: 'blue', label: 'Azul' },
    { id: 'violet', label: 'Violeta' },
    { id: 'silver', label: 'Plata' },
    { id: 'emerald', label: 'Esmeralda' },
    { id: 'cyan', label: 'Cian' },
    { id: 'gold', label: 'Oro' },
    { id: 'pink', label: 'Rosa' },
    { id: 'red', label: 'Rojo' },
  ]
  const update = (patch) => onChange({ ...appearance, ...patch })
  return (
    <motion.aside className="right-drawer appearance-panel" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}>
      <div className="drawer-heading">
        <div><span>Estudio de color</span><h2>Haz que Sonora sea tuya</h2></div>
        <IconButton label="Cerrar" onClick={onClose}><X /></IconButton>
      </div>
      <section className="panel-section">
        <div className="section-heading"><div><h3>Color principal</h3><p>Cambia el logo, los controles y los estados activos.</p></div></div>
        <div className="color-swatches">
          {accents.map((accent) => (
            <button key={accent.id} className={`color-swatch swatch-${accent.id} ${appearance.accent === accent.id ? 'active' : ''}`} onClick={() => update({ accent: accent.id })}>
              <span /><small>{accent.label}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="panel-section">
        <div className="section-heading"><div><h3>Superficie</h3><p>Tres fondos calibrados para escuchar de noche.</p></div></div>
        <div className="segmented-options">
          {[
            ['ink', 'Tinta'],
            ['midnight', 'Medianoche'],
            ['graphite', 'Grafito'],
          ].map(([id, label]) => <button key={id} className={appearance.surface === id ? 'active' : ''} onClick={() => update({ surface: id })}>{label}</button>)}
        </div>
      </section>
      <section className="panel-section">
        <div className="panel-row">
          <div><strong>Densidad compacta</strong><small>Muestra más música sin convertir la interfaz en una tabla.</small></div>
          <button className={`switch ${appearance.density === 'compact' ? 'on' : ''}`} onClick={() => update({ density: appearance.density === 'compact' ? 'comfortable' : 'compact' })} aria-pressed={appearance.density === 'compact'}><span /></button>
        </div>
      </section>
      <p className="panel-footnote">Los cambios se guardan automáticamente en este dispositivo.</p>
    </motion.aside>
  )
}

function AudioPanel({ player, soundLabOwned, visualizerVariant, onSaveAudio, onOpenShop, onClose }) {
  const [linkedBands, setLinkedBands] = useState(() => window.localStorage.getItem('sonora-eq-linked') !== 'false')
  const [crossfadeDraft, setCrossfadeDraft] = useState(player.crossfade)
  const [eqDraft, setEqDraft] = useState(player.eq)
  const [bassBoostDraft, setBassBoostDraft] = useState(player.bassBoost)
  const [ambienceDraft, setAmbienceDraft] = useState(player.ambience)
  const crossfadeDraftRef = useRef(player.crossfade)
  const eqDraftRef = useRef(player.eq)
  const audioDraftRef = useRef({
    bassBoost: player.bassBoost,
    compression: player.compression,
    ambience: player.ambience,
  })
  const lastSavedAudioRef = useRef(JSON.stringify({
    bassBoost: player.bassBoost,
    compression: player.compression,
    ambience: player.ambience,
  }))
  const activePreset = EQ_PRESETS.find((preset) => preset.curve.every((value, index) => value === eqDraft[index]))?.id || 'custom'

  function commitCrossfade() {
    player.setCrossfade(crossfadeDraftRef.current, true)
  }

  function commitEq() {
    player.setEqCurve(eqDraftRef.current, true)
  }

  function commitSoundLab() {
    const settings = { ...audioDraftRef.current }
    const signature = JSON.stringify(settings)
    if (signature === lastSavedAudioRef.current) return
    lastSavedAudioRef.current = signature
    player.setBassBoost(settings.bassBoost, true)
    player.setAmbience(settings.ambience, true)
    onSaveAudio(settings)
  }

  function changeSoundLabValue(key, rawValue) {
    const value = Math.max(0, Math.min(1, Number(rawValue)))
    audioDraftRef.current = { ...audioDraftRef.current, [key]: value }
    if (key === 'bassBoost') {
      setBassBoostDraft(value)
      player.setBassBoost(value, false)
    } else {
      setAmbienceDraft(value)
      player.setAmbience(value, false)
    }
  }

  function changeBand(index, rawValue) {
    const value = Number(rawValue)
    const nextCurve = [...eqDraftRef.current]
    const delta = value - nextCurve[index]
    nextCurve[index] = value
    if (linkedBands) {
      ;[[1, 0.58], [2, 0.24]].forEach(([distance, weight]) => {
        for (const neighbor of [index - distance, index + distance]) {
          if (neighbor < 0 || neighbor >= nextCurve.length) continue
          nextCurve[neighbor] = Math.max(-12, Math.min(12, Math.round((nextCurve[neighbor] + delta * weight) * 2) / 2))
        }
      })
    }
    eqDraftRef.current = nextCurve
    setEqDraft(nextCurve)
    player.setEqCurve(nextCurve, false)
  }

  function toggleLinkedBands() {
    const nextValue = !linkedBands
    setLinkedBands(nextValue)
    window.localStorage.setItem('sonora-eq-linked', String(nextValue))
  }

  return (
    <motion.aside className="right-drawer audio-panel" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}>
      <div className="drawer-heading">
        <div><span>Motor de audio</span><h2>Modela la escucha</h2></div>
        <IconButton label="Cerrar" onClick={onClose}><X /></IconButton>
      </div>
      <section className="panel-section">
        <div className="panel-row"><div><strong>Spatial Audio</strong><small>Ensanchado estéreo mediante micro-retardos.</small></div><button className={`switch ${player.spatial ? 'on' : ''}`} onClick={() => player.setSpatial(!player.spatial)} aria-pressed={player.spatial}><span /></button></div>
        <div className="panel-row panel-slider"><div><strong>Crossfade</strong><small>{crossfadeDraft} segundos</small></div><input type="range" min="0" max="12" value={crossfadeDraft} onChange={(event) => { const value = Number(event.target.value); crossfadeDraftRef.current = value; setCrossfadeDraft(value); player.setCrossfade(value, false) }} onPointerUp={commitCrossfade} onPointerCancel={commitCrossfade} onKeyUp={commitCrossfade} onBlur={commitCrossfade} /></div>
      </section>
      <section className={`panel-section equalizer-section ${player.eqEnabled ? '' : 'is-disabled'}`}>
        <div className="equalizer-heading">
          <div><h3>Ecualizador</h3><p>Nueve bandas con respuesta inmediata sobre el audio.</p></div>
          <label className="eq-power"><span>{player.eqEnabled ? 'Activado' : 'Desactivado'}</span><button type="button" className={`switch ${player.eqEnabled ? 'on' : ''}`} onClick={() => player.setEqEnabled(!player.eqEnabled)} aria-pressed={player.eqEnabled} aria-label="Activar ecualizador"><span /></button></label>
        </div>
        <div className="eq-toolbar">
          <label className="eq-preset-control">
            <span>Preajuste</span>
            <select value={activePreset} disabled={!player.eqEnabled} onChange={(event) => {
              const preset = EQ_PRESETS.find((entry) => entry.id === event.target.value)
              if (preset) {
                eqDraftRef.current = preset.curve
                setEqDraft(preset.curve)
                player.setEqCurve(preset.curve, true)
              }
            }}>
              {activePreset === 'custom' && <option value="custom">Personalizado</option>}
              {EQ_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
            </select>
          </label>
          <button type="button" className="text-button" disabled={!player.eqEnabled || activePreset === 'flat'} onClick={() => { eqDraftRef.current = EQ_PRESETS[0].curve; setEqDraft(EQ_PRESETS[0].curve); player.setEqCurve(EQ_PRESETS[0].curve, true) }}>Restablecer</button>
        </div>
        <div className="eq-workbench">
          <div className="eq-scale" aria-hidden="true"><span>+12 dB</span><span>+6 dB</span><span>0 dB</span><span>−6 dB</span><span>−12 dB</span></div>
          <div className="eq-grid" role="group" aria-label="Bandas del ecualizador">
            {eqDraft.map((value, index) => (
              <label key={EQ_LABELS[index]}>
                <output>{value > 0 ? '+' : ''}{value} dB</output>
                <input aria-label={`${EQ_LABELS[index]}: ${value} decibelios`} type="range" min="-12" max="12" step="0.5" value={value} disabled={!player.eqEnabled} onChange={(event) => changeBand(index, event.target.value)} onPointerUp={commitEq} onPointerCancel={commitEq} onKeyUp={commitEq} onBlur={commitEq} />
                <small>{EQ_LABELS[index]}</small>
              </label>
            ))}
          </div>
        </div>
        <label className="eq-link-option"><input type="checkbox" checked={linkedBands} disabled={!player.eqEnabled} onChange={toggleLinkedBands} /><span><Check /></span>Mover las bandas cercanas juntas</label>
      </section>
      <section className={`panel-section sound-lab-section ${soundLabOwned ? '' : 'locked'}`}>
        <div className="section-heading">
          <div><h3>Sound Lab Pro</h3><p>Modelado dinámico conectado al grafo de audio.</p></div>
          {!soundLabOwned && <span className="pro-badge">Bloqueado</span>}
        </div>
        {soundLabOwned ? (
          <>
            <div className="panel-row panel-slider">
              <div><strong>Refuerzo de graves</strong><small>{Math.round(bassBoostDraft * 100)}% · filtro de 95 Hz</small></div>
              <input type="range" min="0" max="1" step="0.05" value={bassBoostDraft} onChange={(event) => changeSoundLabValue('bassBoost', event.target.value)} onPointerUp={commitSoundLab} onPointerCancel={commitSoundLab} onKeyUp={commitSoundLab} onBlur={commitSoundLab} />
            </div>
            <div className="panel-row">
              <div><strong>Compresión dinámica</strong><small>Controla picos y mantiene el detalle a bajo volumen.</small></div>
              <button className={`switch ${player.compression ? 'on' : ''}`} onClick={() => { const value = !player.compression; audioDraftRef.current = { ...audioDraftRef.current, compression: value }; player.setCompression(value); commitSoundLab() }} aria-pressed={player.compression}><span /></button>
            </div>
            <div className="panel-row panel-slider">
              <div><strong>Ambiente de sala</strong><small>{Math.round(ambienceDraft * 100)}% · reverberación por convolución</small></div>
              <input type="range" min="0" max="1" step="0.05" value={ambienceDraft} onChange={(event) => changeSoundLabValue('ambience', event.target.value)} onPointerUp={commitSoundLab} onPointerCancel={commitSoundLab} onKeyUp={commitSoundLab} onBlur={commitSoundLab} />
            </div>
          </>
        ) : (
          <div className="locked-feature">
            <AudioLines />
            <p>Desbloquea graves, compresión y ambiente persistentes desde la tienda.</p>
            <button className="button button-secondary" onClick={onOpenShop}>Ver en la tienda</button>
          </div>
        )}
      </section>
      <Visualizer analyser={player.analyser} playing={player.playing} variant={visualizerVariant} />
      <p className="panel-footnote">Los cambios se aplican en tiempo real. Spatial Audio es un efecto local sencillo, no tecnología Dolby.</p>
    </motion.aside>
  )
}

function QueuePanel({ player, onClose, onContextMenu }) {
  const dragIndex = useRef(null)
  const scrollRef = useRef(null)
  const rowHeight = 62
  const overscan = 4
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 14 })

  const updateVisibleQueue = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const start = Math.max(0, Math.floor(element.scrollTop / rowHeight) - overscan)
    const rowsInView = Math.ceil(element.clientHeight / rowHeight)
    setVisibleRange({ start, end: Math.min(player.queue.length, start + rowsInView + overscan * 2) })
  }, [player.queue.length])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return undefined
    element.scrollTop = Math.max(0, (player.currentIndex - 2) * rowHeight)
    updateVisibleQueue()
    if (!globalThis.ResizeObserver) return undefined
    const observer = new ResizeObserver(updateVisibleQueue)
    observer.observe(element)
    return () => observer.disconnect()
  }, [player.currentIndex, updateVisibleQueue])

  const queueWindow = player.queue.slice(visibleRange.start, visibleRange.end)
  return (
    <motion.aside className="right-drawer" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}>
      <div className="drawer-heading">
        <div><span>A continuación</span><h2>{player.queue.length} canciones</h2></div>
        <IconButton label="Cerrar" onClick={onClose}><X /></IconButton>
      </div>
      <div className="queue-list is-virtualized" ref={scrollRef} onScroll={updateVisibleQueue}>
        {visibleRange.start > 0 && <div className="queue-virtual-spacer" style={{ height: visibleRange.start * rowHeight }} aria-hidden="true" />}
        {queueWindow.map((track, visibleIndex) => {
          const index = visibleRange.start + visibleIndex
          return (
          <button
            type="button"
            key={`${track.id}-${index}`}
            className={`queue-row ${index === player.currentIndex ? 'current' : ''}`}
            aria-label={`Reproducir ${track.title} de ${track.artist}`}
            aria-current={index === player.currentIndex ? 'true' : undefined}
            draggable
            onClick={() => player.playAt(index)}
            onDragStart={() => { dragIndex.current = index }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragIndex.current !== null && dragIndex.current !== index) player.reorderQueue(dragIndex.current, index)
              dragIndex.current = null
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              onContextMenu?.(track, event, player.queue)
            }}
          >
            <GripVertical />
            <Cover track={track} size="small" />
            <span><strong>{track.title}</strong><small>{track.artist}</small></span>
            <span>{formatTime(track.duration)}</span>
          </button>
          )
        })}
        {visibleRange.end < player.queue.length && <div className="queue-virtual-spacer" style={{ height: (player.queue.length - visibleRange.end) * rowHeight }} aria-hidden="true" />}
      </div>
    </motion.aside>
  )
}

function PlayerBar({ player, onQueue, onAudio, onOpenNowPlaying, onOpenArtist, onOpenAlbum, onContextMenu }) {
  const [volumeDraft, setVolumeDraft] = useState(null)
  const volumeDraftRef = useRef(player.volume)
  const displayedVolume = volumeDraft ?? player.volume

  function previewVolume(rawValue) {
    const value = Math.max(0, Math.min(1, Number(rawValue)))
    volumeDraftRef.current = value
    setVolumeDraft(value)
    player.setVolume(value, false)
  }

  function commitVolume() {
    if (volumeDraft == null) return
    player.setVolume(volumeDraftRef.current, true)
    setVolumeDraft(null)
  }

  if (!player.currentTrack) return null
  return (
    <footer className="player-bar">
      <div className="player-track" onContextMenu={(event) => { event.preventDefault(); onContextMenu?.(player.currentTrack, event, player.queue) }}>
        <button type="button" className="player-track-cover" onClick={onOpenNowPlaying} aria-label={`Abrir vista de ${player.currentTrack.title}`}><Cover track={player.currentTrack} size="player" /></button>
        <span className="player-track-copy">
          <button type="button" className="player-title-link" onClick={onOpenNowPlaying}>{player.currentTrack.title}</button>
          <small><button type="button" className="metadata-link" onClick={() => onOpenArtist(player.currentTrack.artist)}>{player.currentTrack.artist}</button><span aria-hidden="true"> · </span><button type="button" className="metadata-link" onClick={() => onOpenAlbum(player.currentTrack)}>{player.currentTrack.album}</button></small>
          <span className="player-quality-row">
            <QualityBadges track={player.currentTrack} spatial={player.spatial} />
            <DolbyAtmosLogo className="dolby-player-logo" />
          </span>
        </span>
      </div>
      <div className="player-center">
        <div className="transport">
          <IconButton label="Aleatorio" active={player.shuffle} onClick={() => player.setShuffle(!player.shuffle)}><Shuffle /></IconButton>
          <IconButton label="Anterior" onClick={player.previous}><SkipBack fill="currentColor" /></IconButton>
          <button className="play-main" onClick={player.toggle} aria-label={player.playing ? 'Pausar' : 'Reproducir'}>
            {player.playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          </button>
          <IconButton label="Siguiente" onClick={player.next}><SkipForward fill="currentColor" /></IconButton>
          <IconButton label={`Repetición: ${player.repeat}`} active={player.repeat !== 'off'} onClick={player.cycleRepeat}>
            {player.repeat === 'one' ? <Repeat1 /> : <Repeat />}
          </IconButton>
        </div>
        <div className="progress-line">
          <span>{formatTime(player.currentTime)}</span>
          <WaveformProgress track={player.currentTrack} currentTime={player.currentTime} duration={player.duration} onSeek={player.seek} />
          <span>-{formatTime(Math.max(0, player.duration - player.currentTime))}</span>
        </div>
      </div>
      <div className="player-tools">
        <IconButton label="Ver letras y detalles" onClick={onOpenNowPlaying}><Mic2 /></IconButton>
        <IconButton label="Motor de audio" active={player.spatial} onClick={onAudio}><SlidersHorizontal /></IconButton>
        <IconButton label="Cola de reproducción" onClick={onQueue}><ListMusic /></IconButton>
        <IconButton label={player.muted ? 'Activar sonido' : 'Silenciar'} onClick={player.toggleMute}>{player.muted ? <VolumeX /> : <Volume2 />}</IconButton>
        <input aria-label="Volumen" type="range" min="0" max="1" step="0.01" value={displayedVolume} onChange={(event) => previewVolume(event.target.value)} onPointerUp={commitVolume} onPointerCancel={commitVolume} onKeyUp={commitVolume} onBlur={commitVolume} />
      </div>
    </footer>
  )
}

function App() {
  const player = useAudioEngine()
  const {
    adjustVolume,
    next: playNext,
    previous: playPrevious,
    setAmbience,
    setBassBoost,
    setCompression,
    setEqCurve,
    toggle: togglePlayback,
    toggleMute: togglePlayerMute,
  } = player
  useAudioEnergy(player.analyser, player.playing)
  const [config, setConfig] = useState(null)
  const [browserMode, setBrowserMode] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [authLoading, setAuthLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [hasUsers, setHasUsers] = useState(true)
  const [registrationOpen, setRegistrationOpen] = useState(false)
  const [networkInfo, setNetworkInfo] = useState(null)
  const [view, setView] = useState('home')
  const [serverTracks, setServerTracks] = useState([])
  const [browserTracks, setBrowserTracks] = useState([])
  const [styles, setStyles] = useState([])
  const [serverSummary, setServerSummary] = useState({ totals: {}, recent: [], albums: [], recentlyPlayed: [] })
  const [playlists, setPlaylists] = useState([])
  const [wallet, setWallet] = useState(null)
  const [tokenAccount, setTokenAccount] = useState({ pending: [], pendingTotal: 0, payments: [] })
  const [shop, setShop] = useState([])
  const [shopHistory, setShopHistory] = useState([])
  const [shopPurchases, setShopPurchases] = useState([])
  const [accountOverview, setAccountOverview] = useState(null)
  const [preferences, setPreferences] = useState({
    appearance: { accent: 'olive', surface: 'ink', density: 'comfortable' },
    audio: { bassBoost: 0, compression: false, ambience: 0 },
    unlocks: { customization: false, soundLab: false },
  })
  const [stats, setStats] = useState(null)
  const [recommendation, setRecommendation] = useState(null)
  const [recommendationLoading, setRecommendationLoading] = useState(false)
  const [stationLoading, setStationLoading] = useState(null)
  const [scan, setScan] = useState(null)
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [drawer, setDrawer] = useState(null)
  const [checkoutItem, setCheckoutItem] = useState(null)
  const [topUpOpen, setTopUpOpen] = useState(false)
  const [tokenCheckoutOpen, setTokenCheckoutOpen] = useState(false)
  const [playlistPickerTrack, setPlaylistPickerTrack] = useState(null)
  const [playlistAddBusy, setPlaylistAddBusy] = useState(false)
  const [trackMenu, setTrackMenu] = useState(null)
  const [trackInfoTrack, setTrackInfoTrack] = useState(null)
  const [activePlaylist, setActivePlaylist] = useState(null)
  const [activePlaylistTracks, setActivePlaylistTracks] = useState([])
  const [analysisStatus, setAnalysisStatus] = useState(null)
  const [toast, setToast] = useState('')
  const [librarySourcesOpen, setLibrarySourcesOpen] = useState(false)
  const [sourceImportBusy, setSourceImportBusy] = useState(false)
  const [sourceProgress, setSourceProgress] = useState(null)
  const [eightSpineSource, setEightSpineSource] = useState(null)
  const [activeEightSpineModule, setActiveEightSpineModule] = useState(null)
  const [moduleSearchResults, setModuleSearchResults] = useState([])
  const [moduleSearchBusy, setModuleSearchBusy] = useState(false)
  const [moduleSearchError, setModuleSearchError] = useState('')
  const [remoteTrackCatalog, setRemoteTrackCatalog] = useState([])
  const [searchPageQuery, setSearchPageQuery] = useState('')
  const [appleSearchMetadata, setAppleSearchMetadata] = useState(null)
  const [appleSearchBusy, setAppleSearchBusy] = useState(false)
  const [artistProfileName, setArtistProfileName] = useState('')
  const [artistProfile, setArtistProfile] = useState(null)
  const [artistProfileBusy, setArtistProfileBusy] = useState(false)
  const [artistShareLink, setArtistShareLink] = useState('')
  const [artistShareBusy, setArtistShareBusy] = useState(false)
  const [albumSelection, setAlbumSelection] = useState(null)
  const [albumMetadata, setAlbumMetadata] = useState(null)
  const [albumBusy, setAlbumBusy] = useState(false)
  const [albumReturnView, setAlbumReturnView] = useState('albums')
  const [downloadingTrackIds, setDownloadingTrackIds] = useState(() => new Set())
  const dropDepth = useRef(0)
  const lastCompletedScan = useRef('')
  const initialRecommendationRequested = useRef(false)
  const previousEqPreset = useRef(null)
  const audioSaveVersion = useRef(0)
  const [dropping, setDropping] = useState(false)
  const authenticatedUserId = user?.id
  const tracks = useMemo(() => [...serverTracks, ...browserTracks], [browserTracks, serverTracks])
  const summary = useMemo(() => {
    const uniqueRecent = [...browserTracks, ...(serverSummary.recent || [])]
      .filter((track, index, rows) => rows.findIndex((candidate) => candidate.id === track.id) === index)
      .slice(0, 12)
    return {
      ...serverSummary,
      totals: {
        tracks: tracks.length,
        artists: new Set(tracks.map((track) => track.artist)).size,
        albums: new Set(tracks.map((track) => `${track.artist}\u0000${track.album}`)).size,
        duration: tracks.reduce((total, track) => total + Number(track.duration || 0), 0),
      },
      recent: uniqueRecent,
    }
  }, [browserTracks, serverSummary, tracks])

  const loadLibrary = useCallback(async () => {
    const [trackRows, summaryData, playlistData, walletData, tokenData, shopData, preferenceData, historyData, purchaseData, styleData] = await Promise.all([
      api('/tracks'),
      api('/library/summary'),
      api('/playlists'),
      api('/wallet'),
      api('/token-account'),
      api('/shop'),
      api('/preferences'),
      api('/shop/history'),
      api('/shop/purchases'),
      api('/styles'),
    ])
    setServerTracks(trackRows)
    setServerSummary(summaryData)
    setPlaylists(playlistData)
    setWallet(walletData)
    setTokenAccount(tokenData)
    setShop(shopData)
    setPreferences(preferenceData)
    setShopHistory(historyData)
    setShopPurchases(purchaseData)
    setStyles(styleData)
  }, [])

  const equipped = useMemo(() => Object.fromEntries(
    shop.filter((item) => item.equipped && item.slot).map((item) => [item.slot, item]),
  ), [shop])
  const visualizerVariant = equipped.visualizer?.config?.visualizer || 'bars'
  const stationFx = equipped.stationFx?.config?.stationFx || 'signature'

  useEffect(() => {
    function openBrowserLibrary() {
      setBrowserMode(true)
      setUser({ id: 'browser', displayName: 'Mi biblioteca', email: 'Solo en este dispositivo', role: 'admin', isAdmin: true })
      setHasUsers(true)
      setRegistrationOpen(false)
      setNetworkInfo(null)
      setConfig({ musicFolder: 'Fuentes del navegador', browserMode: true })
      setLoadingConfig(false)
    }
    Promise.all([api('/auth/me'), api('/system/network').catch(() => null)])
      .then(([auth, network]) => {
        if (!auth || !Object.hasOwn(auth, 'user') || typeof auth.hasUsers !== 'boolean') {
          openBrowserLibrary()
          return
        }
        setUser(auth.user)
        setHasUsers(auth.hasUsers)
        setRegistrationOpen(auth.registrationOpen)
        setNetworkInfo(network)
        setLoadingConfig(Boolean(auth.user))
      })
      .catch(openBrowserLibrary)
      .finally(() => setAuthLoading(false))
  }, [])

  useEffect(() => {
    let cancelled = false
    restoreEightSpineSession()
      .then(({ source, module }) => {
        if (cancelled) return
        setEightSpineSource(source)
        setActiveEightSpineModule(module)
      })
      .catch((error) => {
        if (!cancelled) setModuleSearchError(`No se pudo restaurar el módulo: ${error.message}`)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    function onPlaybackError(event) {
      setToast(event.detail?.message || 'No se pudo reproducir la pista.')
    }
    window.addEventListener('sonora:playback-error', onPlaybackError)
    return () => window.removeEventListener('sonora:playback-error', onPlaybackError)
  }, [])

  useEffect(() => {
    if (!authenticatedUserId || browserMode) return undefined
    api('/config')
      .then((data) => {
        setConfig(data.musicFolder ? data : null)
        if (data.musicFolder) loadLibrary()
      })
      .finally(() => setLoadingConfig(false))
  }, [authenticatedUserId, browserMode, loadLibrary])

  useEffect(() => {
    if (!config?.musicFolder || browserMode) return undefined
    const timer = window.setInterval(async () => {
      const state = await api('/library/scan')
      setScan(state)
      const signature = `${state.processed}:${state.errors}:${state.message}`
      if (!state.running && state.processed && lastCompletedScan.current !== signature) {
        lastCompletedScan.current = signature
        loadLibrary()
      }
    }, 1600)
    return () => window.clearInterval(timer)
  }, [browserMode, config, loadLibrary])

  useEffect(() => {
    if (browserMode || !user?.isAdmin || !config?.musicFolder || !tracks.length) return undefined
    const timer = window.setTimeout(() => {
      import('./audioAnalysis').then(({ runBackgroundAnalysis }) => runBackgroundAnalysis(setAnalysisStatus)).then(async () => {
        await loadLibrary()
        initialRecommendationRequested.current = false
        setRecommendation(null)
      }).catch(() => {})
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [browserMode, config?.musicFolder, tracks.length, loadLibrary, user?.isAdmin])

  const enrichRecommendationWithModules = useCallback(async (session) => {
    if (!activeEightSpineModule || !session?.tracks?.length) return session
    const seedArtists = [...new Set([
      player.currentTrack?.artist,
      ...session.tracks.map((track) => track.artist),
      ...tracks.slice(0, 12).map((track) => track.artist),
    ].filter(Boolean))].slice(0, 4)
    const resultSets = await Promise.all(seedArtists.map((artist) => (
      searchEightSpineTracks(artist, 8).then((result) => result.tracks).catch(() => [])
    )))
    const remote = resultSets.flat().filter((track, index, rows) => rows.findIndex((candidate) => (candidate.sourceKey || candidate.id) === (track.sourceKey || track.id)) === index)
    if (!remote.length) return session
    setRemoteTrackCatalog((current) => {
      const byId = new Map(current.map((track) => [track.sourceKey || track.id, track]))
      remote.forEach((track) => byId.set(track.sourceKey || track.id, track))
      return [...byId.values()].slice(-240)
    })
    const mixed = []
    let remoteIndex = 0
    session.tracks.forEach((track, index) => {
      mixed.push(track)
      if ((index + 1) % 2 === 0 && remote[remoteIndex]) mixed.push(remote[remoteIndex++])
    })
    while (remoteIndex < remote.length && mixed.length < 30) mixed.push(remote[remoteIndex++])
    return { ...session, tracks: mixed.slice(0, 30), includesModuleStreaming: true }
  }, [activeEightSpineModule, player.currentTrack?.artist, tracks])

  useEffect(() => {
    if (browserMode || !config?.musicFolder || !tracks.length || recommendation || initialRecommendationRequested.current) return undefined
    initialRecommendationRequested.current = true
    const timer = window.setTimeout(() => {
      api('/recommendations/session', {
        method: 'POST',
        body: JSON.stringify({
          intent: 'discover',
          length: 30,
          collectionKey: weeklyCollectionKey(),
        }),
      }).then(enrichRecommendationWithModules).then(setRecommendation).catch(() => {
        initialRecommendationRequested.current = false
      })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [browserMode, config?.musicFolder, enrichRecommendationWithModules, recommendation, tracks.length])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.accent = preferences.appearance.accent
    root.dataset.surface = preferences.appearance.surface
    root.dataset.density = preferences.appearance.density
    root.dataset.equippedTheme = equipped.theme?.config?.theme || 'default'
    root.dataset.coverFrame = equipped.coverFrame?.config?.frame || 'default'
    delete root.dataset.iconPack
  }, [equipped.coverFrame?.config?.frame, equipped.theme?.config?.theme, preferences.appearance])

  useEffect(() => {
    const preset = equipped.equalizerPreset
    if (preset?.config?.eq?.length) {
      setEqCurve(preset.config.eq)
      previousEqPreset.current = preset.id
    } else if (previousEqPreset.current) {
      setEqCurve(EQ_PRESETS[0].curve)
      previousEqPreset.current = null
    }
  }, [equipped.equalizerPreset, setEqCurve])

  useEffect(() => {
    setBassBoost(preferences.audio.bassBoost)
    setCompression(preferences.audio.compression)
    setAmbience(preferences.audio.ambience)
  }, [
    preferences.audio.ambience,
    preferences.audio.bassBoost,
    preferences.audio.compression,
    setAmbience,
    setBassBoost,
    setCompression,
  ])

  useEffect(() => {
    function onKeyDown(event) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return
      if (event.code === 'Space') {
        event.preventDefault()
        togglePlayback()
      }
      if (event.key === 'ArrowRight') playNext()
      if (event.key === 'ArrowLeft') playPrevious()
      if (event.key === 'ArrowUp') adjustVolume(0.05)
      if (event.key === 'ArrowDown') adjustVolume(-0.05)
      if (event.key.toLowerCase() === 'm') togglePlayerMute()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [adjustVolume, playNext, playPrevious, togglePlayback, togglePlayerMute])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 2800)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    function handleTokenUsage(event) {
      setTokenAccount(event.detail.account)
      const progress = Math.round(Number(event.detail.progress || 0) * 100)
      setToast(event.detail.stream
        ? `${formatTokenAmount(event.detail.charge)} tokens · 0,18 € añadidos por iniciar el streaming del módulo.`
        : `${formatTokenAmount(event.detail.charge)} tokens · ${formatTokenEuros(event.detail.charge)} añadidos por el ${event.detail.completed ? '100' : progress} % escuchado.`)
    }
    window.addEventListener('sonora:token-usage', handleTokenUsage)
    return () => window.removeEventListener('sonora:token-usage', handleTokenUsage)
  }, [])

  const localSearchResults = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('es')
    if (!needle) return []
    return tracks.filter((track) => [track.title, track.artist, track.album, track.genre].some((value) => value?.toLocaleLowerCase('es').includes(needle))).slice(0, 8)
  }, [search, tracks])
  const searchSonoraLink = useMemo(() => parseSonoraLink(search), [search])
  const isSonoraLinkInput = search.trim().toLocaleLowerCase('es').startsWith('sonora://')
  const searchResults = useMemo(() => {
    const seen = new Set()
    return [...localSearchResults, ...moduleSearchResults].filter((track) => {
      const key = track.sourceKey || track.id
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 14)
  }, [localSearchResults, moduleSearchResults])

  useEffect(() => {
    const query = search.trim()
    if (!activeEightSpineModule || query.length < 2 || isSonoraLinkInput) {
      const resetTimer = window.setTimeout(() => {
        setModuleSearchResults([])
        setModuleSearchBusy(false)
        setModuleSearchError('')
      }, 0)
      return () => window.clearTimeout(resetTimer)
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setModuleSearchBusy(true)
      setModuleSearchError('')
      searchEightSpineTracks(query, 8)
        .then((result) => {
          if (!cancelled) {
            setModuleSearchResults(result.tracks)
            setRemoteTrackCatalog((current) => {
              const byId = new Map(current.map((track) => [track.sourceKey || track.id, track]))
              result.tracks.forEach((track) => byId.set(track.sourceKey || track.id, track))
              return [...byId.values()].slice(-240)
            })
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setModuleSearchResults([])
            setModuleSearchError(error.message)
          }
        })
        .finally(() => {
          if (!cancelled) setModuleSearchBusy(false)
        })
    }, 380)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeEightSpineModule, isSonoraLinkInput, search])

  const searchPageTracks = useMemo(() => {
    const needle = searchPageQuery.trim().toLocaleLowerCase('es')
    if (!needle) return []
    const seen = new Set()
    return [...tracks, ...remoteTrackCatalog].filter((track) => {
      if (![track.title, track.artist, track.album, track.genre].some((value) => value?.toLocaleLowerCase('es').includes(needle))) return false
      const identity = track.sourceKey || track.id
      if (seen.has(identity)) return false
      seen.add(identity)
      return true
    })
  }, [remoteTrackCatalog, searchPageQuery, tracks])

  const artistTracks = useMemo(() => {
    const needle = artistProfileName.trim().toLocaleLowerCase('es')
    if (!needle) return []
    const seen = new Set()
    return [...tracks, ...remoteTrackCatalog].filter((track) => {
      if (track.artist?.trim().toLocaleLowerCase('es') !== needle) return false
      const identity = track.sourceKey || track.id
      if (seen.has(identity)) return false
      seen.add(identity)
      return true
    })
  }, [artistProfileName, remoteTrackCatalog, tracks])

  const albumTracks = useMemo(() => {
    if (!albumSelection?.name || !albumSelection?.artist) return []
    const albumName = albumSelection.name.trim().toLocaleLowerCase('es')
    const artistName = albumSelection.artist.trim().toLocaleLowerCase('es')
    const seen = new Set()
    return [...tracks, ...remoteTrackCatalog].filter((track) => {
      if (track.album?.trim().toLocaleLowerCase('es') !== albumName || track.artist?.trim().toLocaleLowerCase('es') !== artistName) return false
      const identity = track.sourceKey || track.id
      if (seen.has(identity)) return false
      seen.add(identity)
      return true
    })
  }, [albumSelection, remoteTrackCatalog, tracks])

  useEffect(() => {
    if (view !== 'search' || searchPageQuery.trim().length < 2 || browserMode) return undefined
    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled) setAppleSearchBusy(true)
      return api(`/metadata/apple/search?term=${encodeURIComponent(searchPageQuery)}&limit=40`)
    })
      .then((result) => { if (!cancelled) setAppleSearchMetadata(result) })
      .catch(() => { if (!cancelled) setAppleSearchMetadata(null) })
      .finally(() => { if (!cancelled) setAppleSearchBusy(false) })
    return () => { cancelled = true }
  }, [browserMode, searchPageQuery, view])

  useEffect(() => {
    if (view !== 'artist-profile' || !artistProfileName) return undefined
    let cancelled = false
    const profileRequest = browserMode
      ? Promise.resolve({ name: artistProfileName, albums: [], genres: [], metadataProvider: null })
      : api(`/artists/profile?name=${encodeURIComponent(artistProfileName)}`)
    const moduleRequest = activeEightSpineModule
      ? searchEightSpineTracks(artistProfileName, 30)
      : Promise.resolve({ tracks: [] })
    Promise.resolve().then(() => {
      if (!cancelled) setArtistProfileBusy(true)
      return Promise.allSettled([profileRequest, moduleRequest])
    }).then(([profileResult, moduleResult]) => {
      if (cancelled) return
      setArtistProfile(profileResult.status === 'fulfilled' ? profileResult.value : { name: artistProfileName, albums: [], genres: [] })
      if (moduleResult.status === 'fulfilled' && moduleResult.value.tracks.length) {
        setRemoteTrackCatalog((current) => {
          const byId = new Map(current.map((track) => [track.sourceKey || track.id, track]))
          moduleResult.value.tracks.forEach((track) => byId.set(track.sourceKey || track.id, track))
          return [...byId.values()].slice(-240)
        })
      }
    }).finally(() => { if (!cancelled) setArtistProfileBusy(false) })
    return () => { cancelled = true }
  }, [activeEightSpineModule, artistProfileName, browserMode, view])

  useEffect(() => {
    if (view !== 'artist-profile' || !artistProfileName || browserMode) return undefined
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return null
      setArtistShareBusy(true)
      return api('/share-links', {
        method: 'POST',
        body: JSON.stringify({ type: 'artist', targetId: artistProfileName, label: `Perfil de ${artistProfileName}` }),
      })
    }).then((link) => {
      if (!link) return
      if (!cancelled) setArtistShareLink(link.uri)
    }).catch(() => {
      if (!cancelled) setArtistShareLink('')
    }).finally(() => {
      if (!cancelled) setArtistShareBusy(false)
    })
    return () => { cancelled = true }
  }, [artistProfileName, browserMode, view])

  useEffect(() => {
    if (view !== 'album-detail' || !albumSelection?.name || !albumSelection?.artist) return undefined
    let cancelled = false
    const collectionId = String(albumSelection.collectionId || albumSelection.id || '').match(/^\d+$/)?.[0] || ''
    const params = new URLSearchParams({ album: albumSelection.name, artist: albumSelection.artist })
    if (collectionId) params.set('id', collectionId)
    const metadataRequest = browserMode ? Promise.resolve(null) : api(`/metadata/apple/album?${params}`)
    const moduleRequest = activeEightSpineModule
      ? searchEightSpineTracks(`${albumSelection.name} ${albumSelection.artist}`, 50)
      : Promise.resolve({ tracks: [] })
    Promise.resolve().then(() => {
      if (cancelled) return null
      setAlbumBusy(true)
      return Promise.allSettled([metadataRequest, moduleRequest])
    }).then((results) => {
      if (!results) return
      const [metadataResult, moduleResult] = results
      if (cancelled) return
      setAlbumMetadata(metadataResult.status === 'fulfilled' ? metadataResult.value : null)
      if (moduleResult.status === 'fulfilled' && moduleResult.value.tracks.length) {
        setRemoteTrackCatalog((current) => {
          const byId = new Map(current.map((track) => [track.sourceKey || track.id, track]))
          moduleResult.value.tracks.forEach((track) => byId.set(track.sourceKey || track.id, track))
          return [...byId.values()].slice(-300)
        })
      }
    }).finally(() => { if (!cancelled) setAlbumBusy(false) })
    return () => { cancelled = true }
  }, [activeEightSpineModule, albumSelection, browserMode, view])

  async function authenticate(mode, payload) {
    const result = await api(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) })
    setLoadingConfig(true)
    setUser(result.user)
    setHasUsers(true)
    if (typeof result.registrationOpen === 'boolean') setRegistrationOpen(result.registrationOpen)
    setView('home')
    setAccountOverview(null)
  }

  async function openAccount() {
    setView('account')
    setActivePlaylist(null)
    try {
      const [overview, purchases] = await Promise.all([api('/account/overview'), api('/shop/purchases')])
      setAccountOverview(overview)
      setShopPurchases(purchases)
    } catch (requestError) {
      setToast(requestError.message)
    }
  }

  async function saveProfile(profile) {
    const result = await api('/account/profile', { method: 'PATCH', body: JSON.stringify(profile) })
    setUser(result.user)
    setAccountOverview((current) => current ? { ...current, user: result.user } : current)
  }

  async function deleteListen(id) {
    await api(`/account/listens/${id}`, { method: 'DELETE' })
    const overview = await api('/account/overview')
    setAccountOverview(overview)
    setServerSummary(await api('/library/summary'))
    setToast('Entrada eliminada del historial.')
  }

  async function logout() {
    await player.stop()
    await api('/auth/logout', { method: 'POST' })
    setUser(null)
    setConfig(null)
    setServerTracks([])
    revokeBrowserTrackUrls(browserTracks)
    setBrowserTracks([])
    setShop([])
    setWallet(null)
    setView('home')
    setAccountOverview(null)
    setTokenAccount({ pending: [], pendingTotal: 0, payments: [] })
  }

  async function toggleFavorite(track) {
    if (track.browserOnly) {
      setBrowserTracks((rows) => rows.map((row) => row.id === track.id ? { ...row, favorite: !row.favorite } : row))
      return
    }
    const updated = await api(`/tracks/${track.id}/favorite`, { method: 'PATCH', body: JSON.stringify({ favorite: !track.favorite }) })
    setServerTracks((rows) => rows.map((row) => row.id === updated.id ? updated : row))
  }

  async function changeStyle(track, style) {
    if (track.browserOnly) {
      setBrowserTracks((rows) => rows.map((row) => row.id === track.id ? { ...row, style } : row))
      setToast(style ? `Estilo: ${style}.` : 'Estilo eliminado.')
      return
    }
    const updated = await api(`/tracks/${track.id}/style`, {
      method: 'PATCH',
      body: JSON.stringify({ style }),
    })
    setServerTracks((rows) => rows.map((row) => row.id === updated.id ? updated : row))
    setActivePlaylistTracks((rows) => rows.map((row) => row.id === updated.id ? updated : row))
    setToast(style ? `Estilo: ${style}.` : 'Estilo eliminado; el ambiente automático se conserva.')
  }

  async function rescan() {
    if (scan?.running) return
    try {
      setScan(await api('/library/scan', { method: 'POST' }))
      setToast('Actualizando la música de la carpeta…')
    } catch (requestError) {
      setToast(requestError.message)
    }
  }

  async function refreshWeekly() {
    setRecommendationLoading(true)
    if (browserMode) {
      const shuffled = [...tracks]
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1))
        ;[shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]]
      }
      setRecommendation(await enrichRecommendationWithModules({ intent: 'discover', tracks: shuffled.slice(0, 30) }))
      setRecommendationLoading(false)
      setToast('Selección renovada con la música de este navegador.')
      return
    }
    try {
      const session = await api('/recommendations/session', {
        method: 'POST',
        body: JSON.stringify({
          intent: 'discover',
          length: 30,
          currentTrackId: player.currentTrack?.id || null,
          collectionKey: `${weeklyCollectionKey()}:refresh:${Date.now()}`,
        }),
      })
      setRecommendation(await enrichRecommendationWithModules(session))
    } catch (requestError) {
      setToast(requestError.message)
    } finally {
      setRecommendationLoading(false)
    }
  }

  async function adaptRecommendation(activeIntent, { currentTrackId, consecutiveSkips }) {
    const adaptedSession = await api('/recommendations/session', {
      method: 'POST',
      body: JSON.stringify({
        intent: activeIntent,
        length: 24,
        currentTrackId,
        recentSkipHint: consecutiveSkips,
      }),
    })
    setToast('La sesión se ha reajustado después de varios saltos.')
    return adaptedSession
  }

  function playSession(session, startIndex = 0) {
    if (!session?.tracks?.length) return
    player.playCollection(session.tracks, startIndex, {
      intent: session.intent,
      sessionId: session.sessionId,
      runId: session.runId,
      onAdapt: (feedback) => adaptRecommendation(session.intent, feedback),
    })
  }

  function openTrackContextMenu(track, event, collection = tracks) {
    const menuWidth = 292
    const menuHeight = 426
    const margin = 10
    setTrackMenu({
      track,
      collection: collection?.length ? collection : tracks,
      x: Math.max(margin, Math.min(event.clientX, window.innerWidth - menuWidth - margin)),
      y: Math.max(margin, Math.min(event.clientY, window.innerHeight - menuHeight - margin)),
    })
  }

  function playTrackFromContext() {
    if (!trackMenu) return
    const index = Math.max(0, trackMenu.collection.findIndex((track) => track.id === trackMenu.track.id))
    player.playCollection(trackMenu.collection, index, { source: 'context-menu' })
  }

  function playAlbumFromContext(shuffled = false) {
    if (!trackMenu) return
    const selected = trackMenu.track
    const albumTracks = trackMenu.collection.filter((track) => track.album === selected.album && track.artist === selected.artist)
    if (!albumTracks.length) return
    if (shuffled) {
      const nextTracks = [...albumTracks]
      for (let index = nextTracks.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1))
        ;[nextTracks[index], nextTracks[randomIndex]] = [nextTracks[randomIndex], nextTracks[index]]
      }
      player.playCollection(nextTracks, 0, { source: 'album-shuffle' })
      return
    }
    const startIndex = Math.max(0, albumTracks.findIndex((track) => track.id === selected.id))
    player.playCollection(albumTracks, startIndex, { source: 'album' })
  }

  async function createStationFromTrack(track) {
    setStationLoading(`track:${track.id}`)
    setToast(`Creando una estación desde ${track.title}…`)
    try {
      const session = await api('/recommendations/session', {
        method: 'POST',
        body: JSON.stringify({
          intent: 'flow',
          length: 30,
          currentTrackId: track.id,
          seedTrackIds: [track.id],
        }),
      })
      const stationTracks = [track, ...(session.tracks || []).filter((candidate) => candidate.id !== track.id)]
      playSession({ ...session, tracks: stationTracks }, 0)
      setToast(`Estación creada desde ${track.title}.`)
    } catch (requestError) {
      setToast(requestError.message)
    } finally {
      setStationLoading(null)
    }
  }

  function playRecommendation(startIndex = 0) {
    playSession(recommendation, startIndex)
  }

  async function startStation(nextIntent) {
    setStationLoading(nextIntent)
    if (browserMode) {
      const shuffled = [...tracks]
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1))
        ;[shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]]
      }
      player.playCollection(shuffled, 0, { intent: nextIntent, source: 'browser-library' })
      setStationLoading(null)
      return
    }
    try {
      const session = await api('/recommendations/session', {
        method: 'POST',
        body: JSON.stringify({
          intent: nextIntent,
          length: 24,
          currentTrackId: player.currentTrack?.id || null,
        }),
      })
      playSession(session, 0)
    } catch (requestError) {
      setToast(requestError.message)
    } finally {
      setStationLoading(null)
    }
  }

  function openFullSearch() {
    const query = search.trim()
    if (!query) return
    if (searchSonoraLink) {
      openSonoraLink(query)
      return
    }
    if (isSonoraLinkInput) {
      setToast('Ese enlace Sonora no tiene un formato válido.')
      return
    }
    setSearchPageQuery(query)
    setActivePlaylist(null)
    setView('search')
    if (activeEightSpineModule) {
      setModuleSearchBusy(true)
      searchEightSpineTracks(query, 30).then((result) => {
        setModuleSearchResults(result.tracks)
        setRemoteTrackCatalog((current) => {
          const byId = new Map(current.map((track) => [track.sourceKey || track.id, track]))
          result.tracks.forEach((track) => byId.set(track.sourceKey || track.id, track))
          return [...byId.values()].slice(-240)
        })
      }).catch((error) => setModuleSearchError(error.message)).finally(() => setModuleSearchBusy(false))
    }
  }

  function openArtistProfile(name) {
    const artistName = String(name || '').trim()
    if (!artistName) return
    setArtistProfileName(artistName)
    setArtistProfile(null)
    setArtistShareLink('')
    setActivePlaylist(null)
    setView('artist-profile')
  }

  function openAlbumProfile(source) {
    const name = String(source?.name || source?.album || '').trim()
    const artist = String(source?.artist || '').trim()
    if (!name || !artist) return
    setAlbumReturnView(['search', 'artist-profile', 'now-playing', 'albums'].includes(view) ? view : 'albums')
    setAlbumSelection({
      name,
      artist,
      artworkUrl: source.artworkUrl || null,
      collectionId: source.collectionId || (/^\d+$/.test(String(source.id || '')) ? String(source.id) : null),
    })
    setAlbumMetadata(null)
    setActivePlaylist(null)
    setView('album-detail')
  }

  async function copyArtistShareLink() {
    if (!artistShareLink) return
    try {
      await navigator.clipboard.writeText(artistShareLink)
      setToast('Enlace Sonora del artista copiado.')
    } catch {
      setToast('No se ha podido copiar el enlace al portapapeles.')
    }
  }

  async function downloadModuleTrack(track) {
    if (track?.sourceKind !== '8spine') return
    if (browserMode || !user.isAdmin) {
      setToast('La descarga requiere abrir Sonora con el servidor y una cuenta administradora.')
      return
    }
    const identity = track.sourceKey || track.id
    setDownloadingTrackIds((current) => new Set(current).add(identity))
    try {
      const resolved = track.streamUrl ? track : await resolveEightSpineTrack(track)
      const result = await api('/modules/download', {
        method: 'POST',
        body: JSON.stringify({
          streamUrl: resolved.streamUrl,
          moduleId: resolved.moduleId,
          moduleTrackId: resolved.moduleTrackId,
          title: resolved.title,
          artist: resolved.artist,
          album: resolved.album,
        }),
      })
      await loadLibrary()
      setToast(`${result.track.title} se ha descargado en la carpeta de música.`)
    } catch (error) {
      setToast(error.message)
    } finally {
      setDownloadingTrackIds((current) => {
        const next = new Set(current)
        next.delete(identity)
        return next
      })
    }
  }

  function playSearchResult(track) {
    const index = searchResults.findIndex((item) => item.id === track.id)
    if (track.sourceKind !== '8spine' && !track.browserOnly) {
      api('/interactions', {
        method: 'POST',
        body: JSON.stringify({
          trackId: track.id,
          eventType: 'search_play',
          context: { query: search },
        }),
      }).catch(() => {})
    }
    player.playCollection(searchResults, index, { source: 'search' })
    setSearch('')
  }

  async function openSonoraLink(uri) {
    const parsed = parseSonoraLink(uri)
    if (!parsed) {
      setToast('Ese enlace Sonora no tiene un formato válido.')
      return
    }

    try {
      const link = await api(`/links/${encodeURIComponent(parsed.type)}/${encodeURIComponent(parsed.code)}`)
      setSearch('')
      setSidebarOpen(false)
      setActivePlaylist(null)

      if (link.type === 'music') {
        let libraryTracks = tracks
        let index = libraryTracks.findIndex((track) => String(track.id) === link.targetId)
        if (index < 0) {
          libraryTracks = await api('/tracks')
          setServerTracks(libraryTracks)
          index = libraryTracks.findIndex((track) => String(track.id) === link.targetId)
        }
        if (index < 0) throw new Error('La canción enlazada ya no forma parte de esta biblioteca.')
        player.playCollection(libraryTracks, index, { source: 'custom-link' })
        setView('now-playing')
        return
      }

      if (link.type === 'product') {
        let products = shop
        let product = products.find((item) => item.id === link.targetId)
        if (!product) {
          products = await api('/shop')
          setShop(products)
          product = products.find((item) => item.id === link.targetId)
        }
        if (!product) throw new Error('El producto enlazado ya no está disponible.')
        setView('shop')
        setCheckoutItem(product)
        return
      }

      if (link.type === 'artist') {
        openArtistProfile(link.targetData?.name || link.targetId)
        return
      }

      if (link.type === 'album') {
        openAlbumProfile(link.targetData)
        return
      }

      setCheckoutItem(null)
      if (link.targetId === 'stats') await openStats()
      else if (link.targetId === 'account') await openAccount()
      else setView(link.targetId)
    } catch (requestError) {
      setToast(requestError.message)
    }
  }

  async function createPlaylist(name) {
    await api('/playlists', { method: 'POST', body: JSON.stringify({ name }) })
    setPlaylists(await api('/playlists'))
  }

  async function importPlaylistsWithModule(payload, onProgress) {
    const moduleName = activeEightSpineModule?.name || '8SPINE'
    const enrichment = await enrichPlaylistImport(payload, {
      localTracks: serverTracks,
      activeModule: activeEightSpineModule,
      searchTracks: searchEightSpineTracks,
      resolveTrack: resolveEightSpineTrack,
      onProgress: ({ completed, total, title, artist }) => {
        if (total) onProgress?.(`Resolviendo con ${moduleName}: ${completed}/${total} · ${title} — ${artist}`)
      },
    })
    onProgress?.('Guardando las playlists y sus enlaces…')
    const result = await api('/admin/import/playlists', {
      method: 'POST',
      body: JSON.stringify(enrichment.payload),
    })
    return {
      ...result,
      moduleAttempted: enrichment.attempted,
      moduleResolved: enrichment.resolved,
      moduleNotFound: enrichment.notFound,
      moduleFailed: enrichment.failed,
      invalidReferences: enrichment.invalid,
      moduleErrors: enrichment.errors,
    }
  }

  async function deletePlaylist(id) {
    await api(`/playlists/${id}`, { method: 'DELETE' })
    setPlaylists(await api('/playlists'))
  }

  async function renamePlaylist(playlist) {
    const name = window.prompt('Nuevo nombre de la playlist', playlist.name)?.trim()
    if (!name || name === playlist.name) return
    await api(`/playlists/${playlist.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
    setPlaylists(await api('/playlists'))
    if (activePlaylist?.id === playlist.id) setActivePlaylist((current) => ({ ...current, name }))
  }

  async function openPlaylist(playlist) {
    setActivePlaylist(playlist)
    setActivePlaylistTracks(await api(`/playlists/${playlist.id}/tracks`))
  }

  async function addToPlaylist(playlistId) {
    if (!playlistPickerTrack || playlistAddBusy) return
    setPlaylistAddBusy(true)
    try {
      let track = playlistPickerTrack
      if (track.sourceKind === '8spine') {
        try {
          track = await resolveEightSpineTrack(track)
        } catch (error) {
          if (!track.streamUrl) throw error
        }
      }
      const payload = track.sourceKind === '8spine'
        ? {
            track: {
              sourceKind: track.sourceKind,
              sourceName: track.sourceName,
              moduleId: track.moduleId,
              moduleTrackId: track.moduleTrackId,
              title: track.title,
              artist: track.artist,
              album: track.album,
              year: track.year,
              genre: track.genre,
              duration: track.duration,
              bitrate: track.bitrate,
              sample_rate: track.sample_rate,
              bit_depth: track.bit_depth,
              channels: track.channels,
              codec: track.codec,
              container: track.container,
              quality: track.quality,
              artworkUrl: track.artworkUrl,
              streamUrl: track.streamUrl,
            },
          }
        : { trackId: track.id }
      const result = await api(`/playlists/${playlistId}/tracks`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setPlaylistPickerTrack(null)
      setPlaylists(await api('/playlists'))
      if (activePlaylist?.id === playlistId) setActivePlaylistTracks(await api(`/playlists/${playlistId}/tracks`))
      setToast(result.added === false ? 'La canción ya estaba en esa playlist.' : 'Canción añadida a la playlist.')
    } catch (error) {
      setToast(error.message)
    } finally {
      setPlaylistAddBusy(false)
    }
  }

  async function reorderPlaylist(from, to) {
    const reordered = [...activePlaylistTracks]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    setActivePlaylistTracks(reordered)
    await api(`/playlists/${activePlaylist.id}/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ entryKeys: reordered.map((track) => track.playlistEntryKey) }),
    })
  }

  async function openStats() {
    setView('stats')
    setStats(await api('/stats'))
  }

  async function completeCheckout(payload) {
    const purchasedItem = shop.find((item) => item.id === payload.itemId)
    const result = await api('/shop/checkout', { method: 'POST', body: JSON.stringify(payload) })
    if (purchasedItem?.slot) {
      await api('/shop/equip', {
        method: 'PUT',
        body: JSON.stringify({ slot: purchasedItem.slot, itemId: purchasedItem.id }),
      })
    }
    setWallet(result.wallet)
    const [nextShop, nextPreferences, nextHistory, nextPurchases] = await Promise.all([
      api('/shop'),
      api('/preferences'),
      api('/shop/history'),
      api('/shop/purchases'),
    ])
    setShop(nextShop)
    setPreferences(nextPreferences)
    setShopHistory(nextHistory)
    setShopPurchases(nextPurchases)
    setToast(purchasedItem?.slot ? 'Desbloqueado y equipado.' : 'Desbloqueado. Ya forma parte de tu colección.')
  }

  async function refundPurchase(purchase) {
    try {
      const result = await api(`/shop/purchases/${purchase.id}/refund`, { method: 'POST' })
      setWallet(result.wallet)
      const [nextShop, nextPreferences, nextHistory, nextPurchases] = await Promise.all([
        api('/shop'),
        api('/preferences'),
        api('/shop/history'),
        api('/shop/purchases'),
      ])
      setShop(nextShop)
      setPreferences(nextPreferences)
      setShopHistory(nextHistory)
      setShopPurchases(nextPurchases)
      setToast(result.refund.currency === 'points' ? `${result.refund.amount.toLocaleString('es-ES')} Puntos devueltos íntegramente.` : `${formatEuro(result.refund.amountCents)} devueltos íntegramente.`)
    } catch (requestError) {
      setToast(requestError.message)
    }
  }

  async function completeTopUp(payload) {
    const result = await api('/wallet/topup', { method: 'POST', body: JSON.stringify(payload) })
    setWallet(result.wallet)
    setShopHistory(await api('/shop/history'))
    setToast(`${result.points} Puntos añadidos al saldo.`)
  }

  async function completeTokenPayment(payload) {
    const result = await api('/token-account/pay', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    setTokenAccount(result.account)
    setTokenCheckoutOpen(false)
    setToast(`${formatTokenAmount(result.paid)} tokens · ${formatTokenEuros(result.paid)} liquidados.`)
  }

  async function equipShopItem(item) {
    try {
      await api('/shop/equip', {
        method: 'PUT',
        body: JSON.stringify({ slot: item.slot, itemId: item.equipped ? null : item.id }),
      })
      setShop(await api('/shop'))
      setToast(item.equipped ? `${item.name} desequipado.` : `${item.name} equipado.`)
    } catch (requestError) {
      setToast(requestError.message)
    }
  }

  async function saveAppearance(appearance) {
    try {
      const result = await api('/preferences', {
        method: 'PUT',
        body: JSON.stringify({ appearance }),
      })
      setPreferences((current) => ({ ...current, appearance: result.appearance }))
    } catch (requestError) {
      setToast(requestError.message)
    }
  }

  async function saveAudio(audio) {
    const requestVersion = audioSaveVersion.current + 1
    audioSaveVersion.current = requestVersion
    try {
      const result = await api('/preferences', {
        method: 'PUT',
        body: JSON.stringify({ audio }),
      })
      if (requestVersion !== audioSaveVersion.current) return
      setPreferences((current) => ({ ...current, audio: result.audio }))
    } catch (requestError) {
      if (requestVersion === audioSaveVersion.current) setToast(requestError.message)
    }
  }

  function configureShopItem(item) {
    if (item.id === 'customization-suite') setDrawer('appearance')
    if (item.id === 'sound-lab-pro') setDrawer('audio')
  }

  function addBrowserSource(result) {
    const incomingKeys = new Set(result.tracks.map((track) => track.sourceKey))
    setBrowserTracks((current) => [
      ...current.filter((track) => !incomingKeys.has(track.sourceKey)),
      ...result.tracks,
    ])
    setView('songs')
    setActivePlaylist(null)
    setLibrarySourcesOpen(false)
    const skipped = result.errors?.length || 0
    setToast(`${result.tracks.length} canción${result.tracks.length === 1 ? '' : 'es'} añadida${result.tracks.length === 1 ? '' : 's'} desde ${result.sourceName}${skipped ? ` · ${skipped} omitida${skipped === 1 ? '' : 's'}` : ''}.`)
  }

  async function addBrowserFolderFiles(files) {
    if (!files.length || sourceImportBusy) return
    setSourceImportBusy(true)
    setSourceProgress({ percent: 4, label: 'Leyendo la carpeta…' })
    try {
      const result = await importMusicFolder(files, ({ current, total, name }) => {
        setSourceProgress({
          percent: Math.max(5, Math.round((current / total) * 100)),
          label: `Leyendo ${name} · ${current}/${total}`,
        })
      })
      addBrowserSource(result)
    } catch (error) {
      setToast(error.message)
    } finally {
      setSourceImportBusy(false)
      setSourceProgress(null)
    }
  }

  async function chooseBrowserFolder(event) {
    const files = [...(event.target.files || [])]
    event.target.value = ''
    await addBrowserFolderFiles(files)
  }

  async function chooseJsonCatalog(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || sourceImportBusy) return
    setSourceImportBusy(true)
    setSourceProgress({ percent: 38, label: `Validando ${file.name}…` })
    try {
      addBrowserSource(await importJsonFile(file))
    } catch (error) {
      setToast(error.message)
    } finally {
      setSourceImportBusy(false)
      setSourceProgress(null)
    }
  }

  async function loadJsonCatalogUrl(url) {
    if (sourceImportBusy) return
    setSourceImportBusy(true)
    setSourceProgress({ percent: 22, label: 'Comprobando la fuente…' })
    try {
      const source = await loadEightSpineSource(url)
      setEightSpineSource(source)
      setSourceProgress({ percent: 58, label: `Abriendo ${source.modules[0].name}…` })
      const module = await activateEightSpineModule(source.modules[0])
      setActiveEightSpineModule(module)
      setModuleSearchResults([])
      setModuleSearchError('')
      setSourceProgress({ percent: 100, label: 'Módulos listos' })
      setToast(`${source.modules.length} módulo${source.modules.length === 1 ? '' : 's'} disponible${source.modules.length === 1 ? '' : 's'} · ${module.name} activo.`)
    } catch (error) {
      if (error.code === 'NOT_EIGHTSPINE_SOURCE') {
        setSourceProgress({ percent: 55, label: 'Importando el catálogo de canciones…' })
        try {
          addBrowserSource(await importJsonUrl(url))
        } catch (catalogError) {
          setToast(catalogError.message)
        }
      } else {
        setToast(error.message)
      }
    } finally {
      setSourceImportBusy(false)
      setSourceProgress(null)
    }
  }

  async function selectEightSpineModule(descriptor) {
    if (sourceImportBusy || descriptor.catalogId === activeEightSpineModule?.catalogId) return
    setSourceImportBusy(true)
    setSourceProgress({ percent: 35, label: `Cargando ${descriptor.name}…` })
    try {
      const module = await activateEightSpineModule(descriptor)
      setActiveEightSpineModule(module)
      setModuleSearchResults([])
      setModuleSearchError('')
      setToast(`${module.name} es ahora el módulo de streaming activo.`)
    } catch (error) {
      setToast(error.message)
    } finally {
      setSourceImportBusy(false)
      setSourceProgress(null)
    }
  }

  async function deleteEightSpineModule(descriptor) {
    if (sourceImportBusy) return
    const { source, removedActive } = removeEightSpineModule(descriptor.catalogId)
    setEightSpineSource(source)
    if (!removedActive) {
      setToast(`${descriptor.name} se ha eliminado de la lista.`)
      return
    }

    setActiveEightSpineModule(null)
    setModuleSearchResults([])
    setModuleSearchError('')
    const replacement = source?.modules?.[0]
    if (!replacement) {
      setToast(`${descriptor.name} se ha eliminado. No quedan módulos activos.`)
      return
    }

    setSourceImportBusy(true)
    setSourceProgress({ percent: 42, label: `Activando ${replacement.name}…` })
    try {
      const module = await activateEightSpineModule(replacement)
      setActiveEightSpineModule(module)
      setToast(`${descriptor.name} se ha eliminado · ${module.name} está activo.`)
    } catch (error) {
      setToast(`${descriptor.name} se ha eliminado, pero no se pudo activar el siguiente módulo: ${error.message}`)
    } finally {
      setSourceImportBusy(false)
      setSourceProgress(null)
    }
  }

  async function importFiles(files) {
    const audioFiles = [...files].filter((file) => /\.(mp3|flac|wav|ogg|m4a|aac)$/i.test(file.name))
    if (!audioFiles.length) return
    const body = new FormData()
    audioFiles.forEach((file) => body.append('files', file))
    await api('/import', { method: 'POST', body })
    setToast(`${audioFiles.length} archivo${audioFiles.length === 1 ? '' : 's'} copiándose a tu biblioteca.`)
  }

  if (authLoading) return <div className="app-loading"><AudioLines /><span>Preparando Sonora</span></div>
  if (!user) return <AuthView network={networkInfo} hasUsers={hasUsers} registrationOpen={registrationOpen} onAuthenticate={authenticate} />
  if (loadingConfig) return <div className="app-loading"><AudioLines /><span>Abriendo tu biblioteca</span></div>
  if (!config) return user.isAdmin
    ? <Onboarding onComplete={(nextConfig) => { setConfig(nextConfig); loadLibrary() }} />
    : <SetupPending onLogout={logout} />

  const viewTitle = {
    home: 'Para ti',
    songs: 'Canciones',
    albums: 'Álbumes',
    artists: 'Artistas',
    playlists: 'Playlists',
    genres: 'Géneros',
    search: searchPageQuery ? `Resultados: ${searchPageQuery}` : 'Buscar',
    'artist-profile': artistProfileName || 'Artista',
    'album-detail': albumSelection?.name || 'Álbum',
    stats: 'Tu resumen',
    tokens: 'Consumo de tokens',
    'now-playing': 'Reproduciendo',
    shop: 'Archivo de objetos',
    account: 'Tu cuenta',
    admin: 'Administración',
  }[view]
  const browserSourceCount = new Set(browserTracks.map((track) => `${track.sourceKind}:${track.sourceName}`)).size
  const libraryStatusTitle = sourceImportBusy
    ? 'Añadiendo música'
    : browserTracks.length
      ? `${browserTracks.length} canción${browserTracks.length === 1 ? '' : 'es'} del navegador`
      : activeEightSpineModule ? activeEightSpineModule.name
      : browserMode ? 'Añadir música' : scan?.running ? 'Actualizando biblioteca' : 'Biblioteca local'
  const libraryStatusDetail = sourceImportBusy
    ? (sourceProgress?.label || 'Preparando la biblioteca…')
    : browserTracks.length
      ? `${browserSourceCount} fuente${browserSourceCount === 1 ? '' : 's'}${activeEightSpineModule ? ` + ${activeEightSpineModule.name}` : ''} · ${browserMode ? 'solo en este navegador' : config.musicFolder}`
      : activeEightSpineModule ? `Streaming 8SPINE · ${activeEightSpineModule.labels?.slice(0, 2).join(' · ') || 'activo'}`
      : scan?.running ? `${scan.processed}/${scan.discovered}` : config.musicFolder

  return (
    <div
      className={`app-shell ${player.currentTrack ? 'has-player' : ''}`}
      onDragEnter={user.isAdmin ? (event) => {
        event.preventDefault()
        dropDepth.current += 1
        setDropping(true)
      } : undefined}
      onDragLeave={user.isAdmin ? () => {
        dropDepth.current -= 1
        if (dropDepth.current <= 0) setDropping(false)
      } : undefined}
      onDragOver={user.isAdmin ? (event) => event.preventDefault() : undefined}
      onDrop={user.isAdmin ? async (event) => {
        event.preventDefault()
        dropDepth.current = 0
        setDropping(false)
        const files = await collectDroppedFiles(event.dataTransfer)
        if (browserMode) await addBrowserFolderFiles(files)
        else await importFiles(files)
      } : undefined}
    >
      <aside className={`sidebar ${sidebarOpen ? 'mobile-open' : ''}`}>
        <div className="brand">
          <span className="brand-mark"><BrandLogo /></span>
          <span>Sonora</span>
          <IconButton className="sidebar-close" label="Cerrar navegación" onClick={() => { setSidebarOpen(false); setLibrarySourcesOpen(false) }}><X /></IconButton>
        </div>
        <nav aria-label="Biblioteca">
          <span className="nav-label">Escuchar</span>
          {NAVIGATION.filter((item) => (user.isAdmin || item.id !== 'playlists') && (!browserMode || item.id !== 'playlists')).map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => { setView(item.id); setSidebarOpen(false); setActivePlaylist(null) }}>
                <Icon /><span>{item.label}</span>
                {item.id === 'songs' && <small>{tracks.length}</small>}
              </button>
            )
          })}
          {!browserMode && <>
            <span className="nav-label nav-label-spaced">Tu actividad</span>
            <button className={view === 'stats' ? 'active' : ''} onClick={() => { openStats(); setSidebarOpen(false) }}><BarChart3 /><span>Tu resumen</span></button>
            <button className={view === 'tokens' ? 'active' : ''} onClick={() => { setView('tokens'); setSidebarOpen(false); setActivePlaylist(null) }}><ReceiptText /><span>Consumo</span><small>{formatTokenAmount(tokenAccount.pendingTotal)} · {formatTokenEuros(tokenAccount.pendingTotal)}</small></button>
            <button className={view === 'shop' ? 'active' : ''} onClick={() => { setView('shop'); setSidebarOpen(false) }}><ShoppingBag /><span>Tienda</span><small>{wallet?.points || 0}</small></button>
            <button className={view === 'account' ? 'active' : ''} onClick={() => { openAccount(); setSidebarOpen(false) }}><UserRound /><span>Cuenta</span><small>{user.displayName}</small></button>
            {user.isAdmin && <button className={view === 'admin' ? 'active' : ''} onClick={() => { setView('admin'); setSidebarOpen(false) }}><ShieldCheck /><span>Administración</span><small>Admin</small></button>}
          </>}
        </nav>
        <div className="sidebar-status" aria-live="polite">
          <span className={`status-dot ${scan?.running || sourceImportBusy ? 'working' : ''}`} />
          <button
            type="button"
            className="library-source-trigger"
            aria-expanded={librarySourcesOpen}
            aria-controls="library-sources-panel"
            onClick={() => setLibrarySourcesOpen((open) => !open)}
          >
            <span><strong>{libraryStatusTitle}</strong><small title={libraryStatusDetail}>{libraryStatusDetail}</small></span>
            <ChevronRight className={librarySourcesOpen ? 'is-open' : ''} />
          </button>
          {user.isAdmin && !browserMode && (
            <button
              type="button"
              className="library-refresh-button"
              aria-label={scan?.running ? 'Actualizando música' : 'Volver a cargar la música del servidor'}
              title={scan?.running ? 'Actualizando música' : 'Volver a cargar la música del servidor'}
              disabled={scan?.running || sourceImportBusy}
              onClick={rescan}
            >
              <RefreshCw className={scan?.running ? 'spin' : ''} />
            </button>
          )}
        </div>
      </aside>

      <AnimatePresence>
        {librarySourcesOpen && (
          <LibrarySourcesPanel
            busy={sourceImportBusy}
            progress={sourceProgress}
            modules={eightSpineSource?.modules || []}
            activeModuleId={activeEightSpineModule?.catalogId || null}
            onClose={() => setLibrarySourcesOpen(false)}
            onFolder={chooseBrowserFolder}
            onJsonFile={chooseJsonCatalog}
            onJsonUrl={loadJsonCatalogUrl}
            onModuleDelete={deleteEightSpineModule}
            onModuleSelect={selectEightSpineModule}
          />
        )}
      </AnimatePresence>

      <main className="main-area">
        <header className="topbar">
          <IconButton className="menu-button" label="Abrir navegación" onClick={() => setSidebarOpen(true)}><Menu /></IconButton>
          <div><span className="page-context">{browserMode ? 'Biblioteca del navegador' : 'Biblioteca local'}</span><h1>{activePlaylist?.name || viewTitle}</h1></div>
          <div className="search-wrap">
            <Search aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); openFullSearch() } }} placeholder={activeEightSpineModule ? `Buscar también en ${activeEightSpineModule.name}` : 'Buscar música o pegar un enlace Sonora'} aria-label="Buscar por título, artista, álbum o género, o abrir un enlace Sonora" />
            {search && <button aria-label="Borrar búsqueda" onClick={() => setSearch('')}><X /></button>}
            <AnimatePresence>
              {search && view !== 'search' && view !== 'artist-profile' && (
                <motion.div className="search-popover" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {isSonoraLinkInput ? searchSonoraLink ? (
                    <button onClick={() => openSonoraLink(search)}>
                      <span className="search-link-icon"><Link2 /></span><span><strong>Abrir enlace Sonora</strong><small>{search}</small></span><ChevronRight />
                    </button>
                  ) : <p>El enlace Sonora no tiene un formato válido.</p> : searchResults.length ? <>
                    {searchResults.map((track) => (
                      <button key={track.id} onClick={() => playSearchResult(track)} onContextMenu={(event) => { event.preventDefault(); openTrackContextMenu(track, event, searchResults) }}>
                        <Cover track={track} size="small" /><span><strong>{track.title}</strong><small>{track.artist} · {track.album}{track.sourceKind === '8spine' ? ` · ${track.sourceName}` : ''}</small></span><Play />
                      </button>
                    ))}
                    {moduleSearchBusy && <p className="search-module-status">Buscando también en {activeEightSpineModule.name}…</p>}
                  </> : moduleSearchBusy ? <p>Buscando en {activeEightSpineModule.name}…</p> : moduleSearchError ? <p>{moduleSearchError}</p> : <p>No encuentro nada con “{search}”.</p>}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="top-actions">
            {!browserMode && <>
              {analysisStatus?.status === 'analysing' && <span className="analysis-indicator"><Gauge /> Analizando {analysisStatus.track.title}</span>}
              <button className="token-pill" onClick={() => setView('tokens')} aria-label={`${formatTokenAmount(tokenAccount.pendingTotal)} tokens, ${formatTokenEuros(tokenAccount.pendingTotal)} pendientes`}><ReceiptText /><span>{formatTokenAmount(tokenAccount.pendingTotal)}</span><small>{formatTokenEuros(tokenAccount.pendingTotal)}</small></button>
              <button className="points-pill" onClick={() => setTopUpOpen(true)} aria-label={`${wallet?.points || 0} Puntos. Añadir Puntos`}><PointsLogo /> {wallet?.points || 0}</button>
              <button className="account-pill" onClick={openAccount} aria-label="Abrir tu cuenta"><span>{user.displayName.slice(0, 1).toUpperCase()}</span><small>{user.displayName}</small></button>
            </>}
          </div>
        </header>

        <div className="content">
          {activePlaylist ? (
            <section className="view-stack">
              <button className="text-button back-button" onClick={() => setActivePlaylist(null)}><ArrowLeft /> Todas las playlists</button>
              <div className="playlist-hero"><div className="playlist-art-large"><ListMusic /></div><div><span>Playlist</span><h2>{activePlaylist.name}</h2><p>{activePlaylistTracks.length} canciones</p><button className="button button-primary" disabled={!activePlaylistTracks.length} onClick={() => player.playCollection(activePlaylistTracks, 0)}><Play fill="currentColor" /> Reproducir</button></div></div>
              <TrackTable tracks={activePlaylistTracks} player={player} onFavorite={user.isAdmin ? toggleFavorite : undefined} onAddToPlaylist={user.isAdmin && !browserMode ? setPlaylistPickerTrack : undefined} onStyleChange={user.isAdmin ? changeStyle : undefined} styleOptions={styles.map((style) => style.name)} onReorder={user.isAdmin && !browserMode ? reorderPlaylist : undefined} onContextMenu={openTrackContextMenu} />
            </section>
          ) : (
            <>
              {view === 'home' && (
                <HomeView
                  summary={summary}
                  player={player}
                  onView={setView}
                  recommendation={recommendation}
                  recommendationLoading={recommendationLoading}
                  stationLoading={stationLoading}
                  onRefreshWeekly={refreshWeekly}
                  onStartStation={startStation}
                  onPlayRecommendation={playRecommendation}
                  visualizerVariant={visualizerVariant}
                  stationFx={stationFx}
                  onContextMenu={openTrackContextMenu}
                />
              )}
              {view === 'songs' && <TrackTable tracks={tracks} player={player} onFavorite={user.isAdmin ? toggleFavorite : undefined} onAddToPlaylist={user.isAdmin && !browserMode ? setPlaylistPickerTrack : undefined} onStyleChange={user.isAdmin ? changeStyle : undefined} styleOptions={styles.map((style) => style.name)} onContextMenu={openTrackContextMenu} variant="catalog" />}
              {view === 'albums' && <AlbumsView tracks={tracks} player={player} onContextMenu={openTrackContextMenu} />}
              {view === 'artists' && <GroupsView tracks={[...tracks, ...remoteTrackCatalog]} type="artists" player={player} onOpen={openArtistProfile} />}
              {view === 'genres' && <GroupsView tracks={tracks} type="genres" player={player} />}
              {view === 'search' && <SearchResultsView query={searchPageQuery} tracks={searchPageTracks} metadata={appleSearchMetadata} loading={moduleSearchBusy || appleSearchBusy} player={player} onArtist={openArtistProfile} onAlbum={openAlbumProfile} onDownload={downloadModuleTrack} downloadingIds={downloadingTrackIds} canDownload={user.isAdmin && !browserMode} onContextMenu={openTrackContextMenu} />}
              {view === 'artist-profile' && <ArtistProfileView name={artistProfileName} profile={artistProfile} tracks={artistTracks} loading={artistProfileBusy} player={player} onBack={() => setView(searchPageQuery ? 'search' : 'artists')} onAlbum={openAlbumProfile} shareLink={artistShareLink} shareBusy={artistShareBusy} onShare={copyArtistShareLink} onDownload={downloadModuleTrack} downloadingIds={downloadingTrackIds} canDownload={user.isAdmin && !browserMode} onContextMenu={openTrackContextMenu} />}
              {view === 'album-detail' && <AlbumDetailView album={albumSelection} metadata={albumMetadata} tracks={albumTracks} loading={albumBusy} player={player} onBack={() => setView(albumReturnView)} onArtist={openArtistProfile} onDownload={downloadModuleTrack} downloadingIds={downloadingTrackIds} canDownload={user.isAdmin && !browserMode} onContextMenu={openTrackContextMenu} />}
              {view === 'playlists' && user.isAdmin && <PlaylistsView playlists={playlists} onCreate={createPlaylist} onDelete={deletePlaylist} onRename={renamePlaylist} onOpen={openPlaylist} />}
              {view === 'stats' && <Suspense fallback={<div className="skeleton-panel" />}><StatsView stats={stats} /></Suspense>}
              {view === 'tokens' && <TokenAccountView account={tokenAccount} onPay={() => setTokenCheckoutOpen(true)} />}
              {view === 'account' && <AccountView user={user} overview={accountOverview} network={networkInfo} purchases={shopPurchases} onSaveProfile={saveProfile} onDeleteListen={deleteListen} onLogout={logout} onOpenPlaylists={() => setView('playlists')} onOpenShop={() => setView('shop')} canManage={user.isAdmin} />}
              {view === 'admin' && user.isAdmin && <AdminView currentUser={user} tracks={tracks} products={shop} onToast={setToast} onLibraryChanged={loadLibrary} onOpenLink={openSonoraLink} onImportPlaylists={importPlaylistsWithModule} />}
              {view === 'now-playing' && player.currentTrack && (
                <NowPlayingView
                  player={player}
                  onClose={() => setView('home')}
                  onOpenTokens={() => setView('tokens')}
                  onOpenArtist={openArtistProfile}
                  onOpenAlbum={openAlbumProfile}
                  onDownload={user.isAdmin && !browserMode ? downloadModuleTrack : undefined}
                  downloadBusy={downloadingTrackIds.has(player.currentTrack.sourceKey || player.currentTrack.id)}
                />
              )}
              {view === 'shop' && (
                <ShopView
                  items={shop}
                  wallet={wallet}
                  history={shopHistory}
                  purchases={shopPurchases}
                  onOpenProduct={setCheckoutItem}
                  onConfigure={configureShopItem}
                  onEquip={equipShopItem}
                  onTopUp={() => setTopUpOpen(true)}
                  onRefund={refundPurchase}
                />
              )}
            </>
          )}
        </div>
      </main>

      <PlayerBar
        player={player}
        onContextMenu={openTrackContextMenu}
        onQueue={() => setDrawer('queue')}
        onAudio={() => setDrawer('audio')}
        onOpenNowPlaying={() => { setView('now-playing'); setActivePlaylist(null) }}
        onOpenArtist={openArtistProfile}
        onOpenAlbum={openAlbumProfile}
      />

      <AnimatePresence>
        {drawer === 'queue' && <QueuePanel player={player} onClose={() => setDrawer(null)} onContextMenu={openTrackContextMenu} />}
        {drawer === 'audio' && (
          <AudioPanel
            player={player}
            soundLabOwned={preferences.unlocks.soundLab}
            visualizerVariant={visualizerVariant}
            onSaveAudio={saveAudio}
            onOpenShop={() => { setDrawer(null); setView('shop') }}
            onClose={() => setDrawer(null)}
          />
        )}
        {drawer === 'appearance' && (
          <AppearancePanel
            appearance={preferences.appearance}
            onChange={saveAppearance}
            onClose={() => setDrawer(null)}
          />
        )}
        {trackInfoTrack && <TrackInfoPanel track={trackInfoTrack} onClose={() => setTrackInfoTrack(null)} />}
        {checkoutItem && (
          <ProductDetail
            item={checkoutItem}
            wallet={wallet}
            onClose={() => setCheckoutItem(null)}
            onComplete={completeCheckout}
            onTopUp={() => { setCheckoutItem(null); setTopUpOpen(true) }}
          />
        )}
        {topUpOpen && <TopUp onClose={() => setTopUpOpen(false)} onComplete={completeTopUp} />}
        {tokenCheckoutOpen && (
          <TokenCheckout
            total={tokenAccount.pendingTotal}
            onClose={() => setTokenCheckoutOpen(false)}
            onComplete={completeTokenPayment}
          />
        )}
        {playlistPickerTrack && (
          <motion.div className="modal-backdrop centered" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <section className="picker-dialog" role="dialog" aria-modal="true" aria-labelledby="picker-title">
              <div className="drawer-heading"><div><span>Añadir canción</span><h2 id="picker-title">{playlistPickerTrack.title}</h2></div><IconButton label="Cerrar" onClick={() => setPlaylistPickerTrack(null)}><X /></IconButton></div>
              {playlistPickerTrack.sourceKind === '8spine' && <p className="drawer-note"><Link2 /> Se guardará un enlace reproducible de {playlistPickerTrack.sourceName}.</p>}
              {playlists.length ? playlists.map((playlist) => <button className="picker-option" key={playlist.id} disabled={playlistAddBusy} onClick={() => addToPlaylist(playlist.id)}><ListMusic /><span><strong>{playlist.name}</strong><small>{playlistAddBusy ? 'Preparando enlace…' : `${playlist.trackCount || 0} canciones`}</small></span><Plus /></button>) : <div className="empty-inline"><p>Crea una playlist antes de añadir canciones.</p><button className="button button-primary" onClick={() => { setPlaylistPickerTrack(null); setView('playlists') }}>Ir a Playlists</button></div>}
            </section>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {trackMenu && (
          <TrackContextMenu
            menu={trackMenu}
            canEdit={user.isAdmin && trackMenu.track.sourceKind !== '8spine'}
            canUsePlaylists={user.isAdmin && !browserMode}
            canCreateStation={!browserMode && trackMenu.track.sourceKind !== '8spine'}
            onClose={() => setTrackMenu(null)}
            onAddToPlaylist={() => setPlaylistPickerTrack(trackMenu.track)}
            onPlayNow={playTrackFromContext}
            onPlayAlbum={() => playAlbumFromContext(false)}
            onShuffleAlbum={() => playAlbumFromContext(true)}
            onQueueNext={() => { player.addToQueue(trackMenu.track, 'next'); setToast(`${trackMenu.track.title} sonará a continuación.`) }}
            onQueueEnd={() => { player.addToQueue(trackMenu.track, 'end'); setToast(`${trackMenu.track.title} se ha añadido al final.`) }}
            onCreateStation={() => createStationFromTrack(trackMenu.track)}
            onInfo={() => setTrackInfoTrack(trackMenu.track)}
            onFavorite={() => toggleFavorite(trackMenu.track)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {user.isAdmin && dropping && <motion.div className="drop-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Upload /><h2>Suelta para añadir a Sonora</h2><p>{browserMode ? 'Los archivos se leerán en este navegador, sin subirlos.' : 'Los archivos se copiarán a la biblioteca local.'}</p></motion.div>}
        {toast && <motion.div className="toast" role="status" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{toast}</motion.div>}
      </AnimatePresence>
    </div>
  )
}

export default App
