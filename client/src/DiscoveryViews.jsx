import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Copy, Disc3, Download, Link2, Mic2, Play, Search } from './Icons.jsx'
import { compactDuration, formatTime } from './api'

function key(value) {
  return String(value || '').trim().toLocaleLowerCase('es')
}

function Artwork({ url, label, round = false }) {
  return (
    <span className={`discovery-art ${round ? 'is-round' : ''}`}>
      {url ? <img src={url} alt="" loading="lazy" /> : round ? <Mic2 aria-hidden="true" /> : <Disc3 aria-hidden="true" />}
      <span className="visually-hidden">{label}</span>
    </span>
  )
}

function trackIdentity(track) {
  return track.sourceKey || track.id || `${track.artist}\u0000${track.album}\u0000${track.title}`
}

function TrackResult({ track, active, onPlay, onDownload, downloading, canDownload, onContextMenu }) {
  return (
    <article className={`search-song-row ${active ? 'is-active' : ''}`} onContextMenu={onContextMenu}>
      <button type="button" className="search-song-main" onClick={onPlay}>
        <Artwork url={track.artworkUrl} label={`Carátula de ${track.album}`} />
        <span className="search-song-copy">
          <strong>{track.title}</strong>
          <small>{track.artist} · {track.album}</small>
          {track.sourceKind === '8spine' && <em>{track.sourceName} · streaming</em>}
        </span>
        <span className="search-song-duration">{formatTime(track.duration)}</span>
        <Play className="search-song-play" fill="currentColor" aria-hidden="true" />
      </button>
      {track.sourceKind === '8spine' && canDownload && (
        <button type="button" className="icon-button search-download" onClick={onDownload} disabled={downloading} aria-label={`Descargar ${track.title}`} title="Descargar en la carpeta de música">
          <Download />
        </button>
      )}
    </article>
  )
}

export function SearchResultsView({
  query,
  tracks = [],
  metadata,
  loading,
  player,
  onArtist,
  onAlbum,
  onDownload,
  downloadingIds,
  canDownload,
  onContextMenu,
}) {
  const artists = useMemo(() => {
    const rows = new Map()
    tracks.forEach((track) => {
      const artistKey = key(track.artist)
      if (!artistKey || rows.has(artistKey)) return
      rows.set(artistKey, { name: track.artist, artworkUrl: track.artworkUrl, genre: track.genre })
    })
    ;(metadata?.artists || []).forEach((artist) => {
      const artistKey = key(artist.name)
      if (!artistKey) return
      rows.set(artistKey, { ...rows.get(artistKey), ...artist, artworkUrl: rows.get(artistKey)?.artworkUrl || artist.artworkUrl })
    })
    return [...rows.values()].slice(0, 12)
  }, [metadata?.artists, tracks])

  const albums = useMemo(() => {
    const rows = new Map()
    tracks.forEach((track) => {
      const albumKey = `${key(track.artist)}\u0000${key(track.album)}`
      if (!track.album || rows.has(albumKey)) return
      rows.set(albumKey, { id: albumKey, name: track.album, artist: track.artist, artworkUrl: track.artworkUrl })
    })
    ;(metadata?.albums || []).forEach((album) => {
      const albumKey = `${key(album.artist)}\u0000${key(album.name)}`
      if (!album.name) return
      rows.set(albumKey, { ...album, ...rows.get(albumKey), collectionId: album.id || rows.get(albumKey)?.collectionId || null, artworkUrl: rows.get(albumKey)?.artworkUrl || album.artworkUrl })
    })
    return [...rows.values()].slice(0, 16)
  }, [metadata?.albums, tracks])

  const hasResults = tracks.length || artists.length || albums.length
  return (
    <motion.div className="search-results-view view-stack" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <header className="search-results-hero">
        <span><Search /> Resultados para</span>
        <h2>“{query}”</h2>
        <p>{loading ? 'Completando resultados…' : `${tracks.length} canciones encontradas`}{metadata?.provider ? ` · metadatos de ${metadata.provider}` : ''}</p>
      </header>

      {!hasResults && !loading && <div className="search-results-empty"><Search /><h3>No hay coincidencias</h3><p>Prueba con el artista, el álbum o una parte del título.</p></div>}

      {(tracks.length > 0 || loading) && (
        <section className="search-result-section" aria-labelledby="result-songs">
          <div className="section-heading"><div><span>Reproducibles</span><h2 id="result-songs">Canciones</h2></div></div>
          <div className="search-song-list">
            {tracks.slice(0, 30).map((track, index) => (
              <TrackResult
                key={trackIdentity(track)}
                track={track}
                active={player.currentTrack?.id === track.id}
                onPlay={() => player.playCollection(tracks, index, { source: 'full-search' })}
                onDownload={() => onDownload(track)}
                downloading={downloadingIds.has(trackIdentity(track))}
                canDownload={canDownload}
                onContextMenu={(event) => { event.preventDefault(); onContextMenu?.(track, event, tracks) }}
              />
            ))}
            {loading && <div className="search-results-loading"><span /><span /><span /></div>}
          </div>
        </section>
      )}

      {artists.length > 0 && (
        <section className="search-result-section" aria-labelledby="result-artists">
          <div className="section-heading"><div><span>Perfiles</span><h2 id="result-artists">Artistas</h2></div></div>
          <div className="search-artist-grid">
            {artists.map((artist) => (
              <button type="button" key={key(artist.name)} className="search-artist-card" onClick={() => onArtist(artist.name)}>
                <Artwork url={artist.artworkUrl} label={artist.name} round />
                <strong>{artist.name}</strong><small>{artist.genre || 'Artista'}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {albums.length > 0 && (
        <section className="search-result-section" aria-labelledby="result-albums">
          <div className="section-heading"><div><span>Discografía</span><h2 id="result-albums">Álbumes</h2></div></div>
          <div className="search-album-grid">
            {albums.map((album) => (
              <button type="button" key={album.id || `${album.artist}-${album.name}`} className="search-album-card" onClick={() => onAlbum(album)}>
                <Artwork url={album.artworkUrl} label={album.name} />
                <strong>{album.name}</strong><small>{album.artist}{album.year ? ` · ${album.year}` : ''}</small>
              </button>
            ))}
          </div>
        </section>
      )}
    </motion.div>
  )
}

function dateOnly(value) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { dateStyle: 'long' }).format(date)
}

export function ArtistProfileView({
  name,
  profile,
  tracks = [],
  loading,
  player,
  onBack,
  onAlbum,
  shareLink,
  shareBusy,
  onShare,
  onDownload,
  downloadingIds,
  canDownload,
  onContextMenu,
}) {
  const albums = useMemo(() => {
    const rows = new Map()
    tracks.forEach((track) => {
      const albumKey = key(track.album)
      if (!rows.has(albumKey)) rows.set(albumKey, { name: track.album, artist: track.artist, artworkUrl: track.artworkUrl, tracks: [] })
      rows.get(albumKey).tracks.push(track)
    })
    ;(profile?.albums || []).forEach((album) => {
      const albumKey = key(album.name)
      if (!rows.has(albumKey)) rows.set(albumKey, { ...album, tracks: [] })
    })
    return [...rows.values()].slice(0, 16)
  }, [profile?.albums, tracks])
  const topTracks = useMemo(() => [...tracks].sort((left, right) => Number(right.play_count || 0) - Number(left.play_count || 0)).slice(0, 10), [tracks])
  const displayName = profile?.name || name
  return (
    <motion.div className="artist-profile view-stack" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <button type="button" className="text-button back-button" onClick={onBack}><ArrowLeft /> Volver</button>
      <header className="artist-profile-hero">
        <Artwork url={profile?.imageUrl || tracks.find((track) => track.artworkUrl)?.artworkUrl} label={displayName} round />
        <div className="artist-profile-copy">
          <span>Artista</span><h2>{displayName}</h2>
          <div className="artist-share-row">
            <span className="artist-share-link"><Link2 /> <code>{shareLink || (shareBusy ? 'Generando enlace Sonora…' : 'Enlace no disponible en modo navegador')}</code></span>
            <button type="button" className="button button-secondary" disabled={!shareLink || shareBusy} onClick={onShare}><Copy /> Compartir</button>
          </div>
          <div className="artist-fact-chips">
            <span><strong>Nacimiento</strong>{dateOnly(profile?.birthDate) || 'Sin completar'}</span>
            <span><strong>Origen</strong>{profile?.origin || profile?.genres?.join(' · ') || 'Sin completar'}</span>
          </div>
          {profile?.biography && <p>{profile.biography}</p>}
          {!profile?.biography && !loading && <p className="artist-profile-placeholder">La biografía todavía no está completada. El administrador puede añadirla manualmente.</p>}
          <small>{profile?.metadataProvider ? `Metadatos: ${profile.metadataProvider}` : 'Datos locales y del módulo'} · {tracks.length} canciones</small>
        </div>
      </header>

      <section className="artist-top-tracks" aria-labelledby="artist-top-title">
        <div className="section-heading"><div><span>Lo más escuchado</span><h2 id="artist-top-title">Canciones más reproducidas</h2></div>{topTracks.length > 0 && <button type="button" className="button button-primary" onClick={() => player.playCollection(topTracks, 0, { source: 'artist-profile' })}><Play fill="currentColor" /> Reproducir</button>}</div>
        <div className="artist-track-list">
          {topTracks.map((track, index) => (
            <TrackResult
              key={trackIdentity(track)}
              track={track}
              active={player.currentTrack?.id === track.id}
              onPlay={() => player.playCollection(topTracks, index, { source: 'artist-profile' })}
              onDownload={() => onDownload(track)}
              downloading={downloadingIds.has(trackIdentity(track))}
              canDownload={canDownload}
              onContextMenu={(event) => { event.preventDefault(); onContextMenu?.(track, event, topTracks) }}
            />
          ))}
          {!topTracks.length && !loading && <p className="artist-profile-placeholder">Todavía no hay canciones reproducibles de este artista.</p>}
        </div>
      </section>

      {albums.length > 0 && (
        <section className="search-result-section" aria-labelledby="artist-albums-title">
          <div className="section-heading"><div><span>Ver todo</span><h2 id="artist-albums-title">Álbumes</h2></div><small>{compactDuration(tracks.reduce((sum, track) => sum + Number(track.duration || 0), 0))}</small></div>
          <div className="search-album-grid">
            {albums.map((album) => (
              <button type="button" key={key(album.name)} className="search-album-card" onClick={() => onAlbum(album)}>
                <Artwork url={album.artworkUrl} label={album.name} />
                <strong>{album.name}</strong><small>{album.year || `${album.tracks.length} canciones`}</small>
              </button>
            ))}
          </div>
        </section>
      )}
    </motion.div>
  )
}

function sameTrack(left, right) {
  return key(left?.title) === key(right?.title)
}

export function AlbumDetailView({
  album,
  metadata,
  tracks = [],
  loading,
  player,
  onBack,
  onArtist,
  onDownload,
  downloadingIds,
  canDownload,
  onContextMenu,
}) {
  const displayAlbum = metadata || album || {}
  const playableTracks = useMemo(() => tracks.filter((track) => key(track.album) === key(album?.name) && key(track.artist) === key(album?.artist)), [album?.artist, album?.name, tracks])
  const rows = useMemo(() => {
    const metadataRows = metadata?.tracks || []
    const merged = metadataRows.map((item) => ({ ...item, playable: playableTracks.find((track) => sameTrack(track, item)) || null }))
    playableTracks.forEach((track) => {
      if (!merged.some((item) => sameTrack(item, track))) merged.push({ ...track, playable: track })
    })
    return merged
  }, [metadata?.tracks, playableTracks])

  function playTrack(track) {
    const index = playableTracks.findIndex((item) => trackIdentity(item) === trackIdentity(track))
    if (index >= 0) player.playCollection(playableTracks, index, { source: 'album-detail' })
  }

  return (
    <motion.div className="album-detail view-stack" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <button type="button" className="text-button back-button" onClick={onBack}><ArrowLeft /> Volver</button>
      <header className="album-detail-hero">
        <Artwork url={displayAlbum.artworkUrl || album?.artworkUrl} label={displayAlbum.name || album?.name} />
        <div className="album-detail-copy">
          <span>Álbum</span>
          <h2>{displayAlbum.name || album?.name}</h2>
          <button type="button" className="metadata-link album-artist-link" onClick={() => onArtist(displayAlbum.artist || album?.artist)}>{displayAlbum.artist || album?.artist}</button>
          <p>{[displayAlbum.year, displayAlbum.genre, `${rows.length || displayAlbum.trackCount || 0} canciones`].filter(Boolean).join(' · ')}</p>
          <div className="album-detail-actions">
            <button type="button" className="button button-primary" disabled={!playableTracks.length} onClick={() => player.playCollection(playableTracks, 0, { source: 'album-detail' })}><Play fill="currentColor" /> Reproducir</button>
            {metadata?.provider && <small>Listado de {metadata.provider}</small>}
          </div>
        </div>
      </header>

      <section className="album-track-section" aria-labelledby="album-track-title">
        <div className="section-heading"><div><span>Edición completa</span><h2 id="album-track-title">Canciones</h2></div></div>
        <div className="album-track-list">
          {rows.map((row, index) => {
            const playable = row.playable
            const identity = playable ? trackIdentity(playable) : `${row.appleId || row.title}-${index}`
            return (
              <article className={`album-track-row ${playable && player.currentTrack?.id === playable.id ? 'is-active' : ''}`} key={identity} onContextMenu={playable ? (event) => { event.preventDefault(); onContextMenu?.(playable, event, playableTracks) } : undefined}>
                <span className="album-track-number">{index + 1}</span>
                <div><strong>{row.title}</strong><small>{row.artist || displayAlbum.artist}</small></div>
                <span>{formatTime(row.duration)}</span>
                {playable ? <button type="button" className="icon-button" onClick={() => playTrack(playable)} aria-label={`Reproducir ${row.title}`}><Play fill="currentColor" /></button> : <em>Solo metadatos</em>}
                {playable?.sourceKind === '8spine' && canDownload && <button type="button" className="icon-button" onClick={() => onDownload(playable)} disabled={downloadingIds.has(identity)} aria-label={`Descargar ${row.title}`}><Download /></button>}
              </article>
            )
          })}
          {!rows.length && !loading && <p className="artist-profile-placeholder">No se ha podido recuperar el listado de este álbum.</p>}
          {loading && <div className="search-results-loading"><span /><span /><span /></div>}
        </div>
      </section>
    </motion.div>
  )
}
