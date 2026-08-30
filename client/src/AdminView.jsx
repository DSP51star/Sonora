import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Download, ExternalLink, FileText, Headphones, Link2, ListMusic, Mic2, Music2, Palette, Plus, ShieldCheck, Trash2, Upload, UserPlus, UsersRound } from './Icons.jsx'
import { api } from './api'

const LINK_SECTIONS = [
  { id: 'home', label: 'Inicio' },
  { id: 'songs', label: 'Canciones' },
  { id: 'albums', label: 'Álbumes' },
  { id: 'artists', label: 'Artistas' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'genres', label: 'Géneros' },
  { id: 'stats', label: 'Tu resumen' },
  { id: 'tokens', label: 'Consumo' },
  { id: 'shop', label: 'Tienda' },
  { id: 'account', label: 'Cuenta' },
  { id: 'admin', label: 'Administración' },
]

function dateLabel(value) {
  if (!value) return 'Todavía no ha entrado'
  return new Date(`${value}Z`).toLocaleString('es-ES')
}

export function AdminView({ currentUser, tracks = [], products = [], onToast, onLibraryChanged, onOpenLink, onImportPlaylists }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [transferBusy, setTransferBusy] = useState('')
  const [transferMessage, setTransferMessage] = useState('')
  const [moods, setMoods] = useState([])
  const [moodName, setMoodName] = useState('')
  const [moodSaving, setMoodSaving] = useState(false)
  const [links, setLinks] = useState([])
  const [linkLabel, setLinkLabel] = useState('')
  const [linkType, setLinkType] = useState('music')
  const [linkTarget, setLinkTarget] = useState('')
  const [linkSaving, setLinkSaving] = useState(false)
  const [linkMessage, setLinkMessage] = useState('')
  const [artistProfiles, setArtistProfiles] = useState([])
  const [profileName, setProfileName] = useState('')
  const [profileBirthDate, setProfileBirthDate] = useState('')
  const [profileOrigin, setProfileOrigin] = useState('')
  const [profileBiography, setProfileBiography] = useState('')
  const [profileImageUrl, setProfileImageUrl] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState('')
  const playlistFileInput = useRef(null)
  const catalogFileInput = useRef(null)

  const loadUsers = useCallback(async () => {
    try {
      setUsers(await api('/admin/users'))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMoods = useCallback(async () => {
    try {
      setMoods(await api('/admin/styles'))
    } catch (requestError) {
      setTransferMessage(requestError.message)
    }
  }, [])

  const loadLinks = useCallback(async () => {
    try {
      setLinks(await api('/admin/custom-links'))
    } catch (requestError) {
      setLinkMessage(requestError.message)
    }
  }, [])

  const loadArtistProfiles = useCallback(async () => {
    try {
      setArtistProfiles(await api('/admin/artist-profiles'))
    } catch (requestError) {
      setProfileMessage(requestError.message)
    }
  }, [])

  useEffect(() => {
    let active = true
    api('/admin/users')
      .then((rows) => { if (active) setUsers(rows) })
      .catch((requestError) => { if (active) setError(requestError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    api('/admin/artist-profiles')
      .then((rows) => { if (active) setArtistProfiles(rows) })
      .catch((requestError) => { if (active) setProfileMessage(requestError.message) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    api('/admin/custom-links')
      .then((rows) => { if (active) setLinks(rows) })
      .catch((requestError) => { if (active) setLinkMessage(requestError.message) })
    return () => { active = false }
  }, [])

  const artistNames = useMemo(() => [...new Set([
    ...tracks.map((track) => track.artist),
    ...artistProfiles.map((profile) => profile.name),
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right, 'es')), [artistProfiles, tracks])
  const albumTargets = useMemo(() => {
    const rows = new Map()
    tracks.forEach((track) => {
      if (!track.album || !track.artist) return
      const id = JSON.stringify({ name: track.album, artist: track.artist, collectionId: null })
      if (!rows.has(id)) rows.set(id, { id, label: track.album, detail: track.artist })
    })
    return [...rows.values()].sort((left, right) => left.label.localeCompare(right.label, 'es'))
  }, [tracks])
  const linkTargets = useMemo(() => linkType === 'music'
    ? tracks.map((track) => ({ id: String(track.id), label: track.title, detail: track.artist }))
    : linkType === 'product'
      ? products.map((product) => ({ id: product.id, label: product.name, detail: product.category }))
      : linkType === 'artist'
        ? artistNames.map((name) => ({ id: name, label: name, detail: 'Perfil de artista' }))
        : linkType === 'album'
          ? albumTargets
          : LINK_SECTIONS, [albumTargets, artistNames, linkType, products, tracks])
  const selectedLinkTarget = linkTargets.some((target) => target.id === linkTarget) ? linkTarget : linkTargets[0]?.id || ''

  useEffect(() => {
    let active = true
    api('/admin/styles')
      .then((rows) => { if (active) setMoods(rows) })
      .catch((requestError) => { if (active) setTransferMessage(requestError.message) })
    return () => { active = false }
  }, [])

  async function createUser(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ displayName, email, password }),
      })
      setDisplayName('')
      setEmail('')
      setPassword('')
      await loadUsers()
      onToast('Cuenta de oyente creada.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  async function removeUser(user) {
    if (!window.confirm(`Eliminar la cuenta de ${user.displayName}? Sus datos personales se borrarán de este equipo.`)) return
    try {
      await api(`/admin/users/${user.id}`, { method: 'DELETE' })
      await loadUsers()
      onToast('Cuenta eliminada.')
    } catch (requestError) {
      onToast(requestError.message)
    }
  }

  async function downloadJson(endpoint, fileName, busyKey) {
    setTransferBusy(busyKey)
    setTransferMessage('')
    try {
      const payload = await api(endpoint)
      const url = URL.createObjectURL(new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setTransferMessage(`Archivo ${fileName} preparado.`)
      onToast('Exportación completada.')
    } catch (requestError) {
      setTransferMessage(requestError.message)
    } finally {
      setTransferBusy('')
    }
  }

  async function importPlaylists(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setTransferMessage('')
    if (file.size > 2 * 1024 * 1024) {
      setTransferMessage('El archivo supera el límite de 2 MB.')
      return
    }
    setTransferBusy('import-playlists')
    try {
      let payload
      try {
        payload = JSON.parse(await file.text())
      } catch {
        throw new Error('El archivo no contiene JSON válido.')
      }
      const result = onImportPlaylists
        ? await onImportPlaylists(payload, setTransferMessage)
        : await api('/admin/import/playlists', {
            method: 'POST',
            body: JSON.stringify(payload),
          })
      await onLibraryChanged?.()
      const linked = Number(result.linked || 0)
      const resolved = Number(result.moduleResolved || 0)
      const failed = Number(result.moduleFailed || 0)
      const moduleDetails = [
        resolved ? `${resolved} resuelta${resolved === 1 ? '' : 's'} con el módulo` : '',
        failed ? `${failed} con error del módulo` : '',
      ].filter(Boolean).join(' · ')
      const message = `${result.created} playlist${result.created === 1 ? '' : 's'} importada${result.created === 1 ? '' : 's'} · ${result.matched} canciones recuperadas${linked ? ` (${linked} por enlace)` : ''} · ${result.missing} sin coincidencia${moduleDetails ? ` · ${moduleDetails}` : ''}.`
      setTransferMessage(message)
      onToast('Playlists importadas.')
    } catch (requestError) {
      setTransferMessage(requestError.message)
    } finally {
      setTransferBusy('')
    }
  }

  async function importCatalog(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setTransferMessage('')
    if (file.size > 2 * 1024 * 1024) {
      setTransferMessage('El archivo supera el límite de 2 MB.')
      return
    }
    setTransferBusy('import-catalog')
    try {
      let payload
      try {
        payload = JSON.parse(await file.text())
      } catch {
        throw new Error('El archivo no contiene JSON válido.')
      }
      const result = await api('/admin/import/catalog', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      await Promise.all([loadMoods(), onLibraryChanged?.()])
      const details = [
        `${result.updated} estilos actualizados`,
        `${result.unchanged} sin cambios`,
        `${result.missing} canciones no encontradas`,
      ]
      if (result.invalidStyles) details.push(`${result.invalidStyles} estilos no válidos`)
      if (result.createdStyles?.length) details.push(`${result.createdStyles.length} estilos personalizados creados`)
      setTransferMessage(`${details.join(' · ')}.`)
      onToast('Estilos del catálogo importados.')
    } catch (requestError) {
      setTransferMessage(requestError.message)
    } finally {
      setTransferBusy('')
    }
  }

  async function createMood(event) {
    event.preventDefault()
    setMoodSaving(true)
    setTransferMessage('')
    try {
      const created = await api('/admin/styles', {
        method: 'POST',
        body: JSON.stringify({ name: moodName }),
      })
      setMoodName('')
      await Promise.all([loadMoods(), onLibraryChanged?.()])
      setTransferMessage(`Estilo "${created.name}" disponible en toda la biblioteca.`)
      onToast('Estilo personalizado creado.')
    } catch (requestError) {
      setTransferMessage(requestError.message)
    } finally {
      setMoodSaving(false)
    }
  }

  async function removeMood(mood) {
    try {
      await api(`/admin/styles/${mood.id}`, { method: 'DELETE' })
      await Promise.all([loadMoods(), onLibraryChanged?.()])
      setTransferMessage(`Estilo "${mood.name}" eliminado.`)
    } catch (requestError) {
      setTransferMessage(requestError.message)
    }
  }

  async function createLink(event) {
    event.preventDefault()
    setLinkSaving(true)
    setLinkMessage('')
    try {
      const created = await api('/admin/custom-links', {
        method: 'POST',
        body: JSON.stringify({ label: linkLabel, type: linkType, targetId: selectedLinkTarget }),
      })
      setLinkLabel('')
      await loadLinks()
      setLinkMessage(`Enlace creado: ${created.uri}`)
      onToast('Enlace Sonora creado.')
    } catch (requestError) {
      setLinkMessage(requestError.message)
    } finally {
      setLinkSaving(false)
    }
  }

  async function copyLink(link) {
    try {
      await navigator.clipboard.writeText(link.uri)
      onToast('Enlace copiado.')
    } catch {
      setLinkMessage('No se pudo copiar automáticamente. Selecciona el enlace y cópialo manualmente.')
    }
  }

  async function removeLink(link) {
    if (!window.confirm(`Eliminar el enlace “${link.label}”?`)) return
    try {
      await api(`/admin/custom-links/${link.id}`, { method: 'DELETE' })
      await loadLinks()
      setLinkMessage('Enlace eliminado.')
    } catch (requestError) {
      setLinkMessage(requestError.message)
    }
  }

  function editArtistProfile(name) {
    const profile = artistProfiles.find((item) => item.name.toLocaleLowerCase('es') === String(name || '').toLocaleLowerCase('es'))
    setProfileName(profile?.name || name || '')
    setProfileBirthDate(profile?.birthDate || '')
    setProfileOrigin(profile?.origin || '')
    setProfileBiography(profile?.biography || '')
    setProfileImageUrl(profile?.imageUrl || '')
    setProfileMessage('')
  }

  async function saveArtistProfile(event) {
    event.preventDefault()
    if (!profileName.trim()) return
    setProfileSaving(true)
    setProfileMessage('')
    try {
      const saved = await api(`/admin/artist-profiles/${encodeURIComponent(profileName.trim())}`, {
        method: 'PUT',
        body: JSON.stringify({
          birthDate: profileBirthDate,
          origin: profileOrigin,
          biography: profileBiography,
          imageUrl: profileImageUrl,
        }),
      })
      await loadArtistProfiles()
      setProfileName(saved.name)
      setProfileBirthDate(saved.birthDate || '')
      setProfileOrigin(saved.origin || '')
      setProfileBiography(saved.biography || '')
      setProfileImageUrl(saved.imageUrl || '')
      setProfileMessage('Perfil guardado. Los datos manuales tendrán prioridad sobre Apple Music España.')
      onToast('Perfil del artista actualizado.')
    } catch (requestError) {
      setProfileMessage(requestError.message)
    } finally {
      setProfileSaving(false)
    }
  }

  async function removeArtistProfile(profile) {
    if (!window.confirm(`Eliminar los datos manuales de ${profile.name}?`)) return
    try {
      await api(`/admin/artist-profiles/${encodeURIComponent(profile.name)}`, { method: 'DELETE' })
      await loadArtistProfiles()
      if (profileName.toLocaleLowerCase('es') === profile.name.toLocaleLowerCase('es')) {
        setProfileBirthDate('')
        setProfileOrigin('')
        setProfileBiography('')
        setProfileImageUrl('')
      }
      setProfileMessage('Datos manuales eliminados; el perfil volverá a usar los metadatos disponibles.')
    } catch (requestError) {
      setProfileMessage(requestError.message)
    }
  }

  return (
    <div className="admin-view">
      <header className="admin-hero">
        <span className="admin-symbol"><ShieldCheck /></span>
        <div><span>Control local</span><h2>Administración</h2><p>Gestiona quién puede entrar. Solo esta cuenta modifica la biblioteca; los oyentes reproducen y personalizan sus compras.</p></div>
        <span className="admin-status"><Check /> Sesión protegida</span>
      </header>

      <div className="admin-layout">
        <section className="admin-panel">
          <div className="section-heading"><div><h3>Nuevo oyente</h3><p>Crea un acceso individual con historial, Puntos y compras separados.</p></div><UserPlus /></div>
          <form className="admin-user-form" onSubmit={createUser}>
            <label>Nombre visible<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength="2" required placeholder="Ej. Daniel" /></label>
            <label>Correo<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="usuario@sonora.local" /></label>
            <label>Contraseña temporal<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength="8" required placeholder="8 caracteres como mínimo" /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button button-primary" disabled={saving}>{saving ? 'Creando…' : <><UserPlus /> Crear cuenta normal</>}</button>
          </form>
        </section>

        <section className="admin-panel admin-permissions">
          <div className="section-heading"><div><h3>Permisos claros</h3><p>Las restricciones también se validan en el servidor.</p></div><ShieldCheck /></div>
          <div><span><ShieldCheck /><strong>Administrador</strong></span><p>Configura carpetas, importa, reescanea y edita la biblioteca; también gestiona usuarios.</p></div>
          <div><span><Headphones /><strong>Oyente</strong></span><p>Escucha, paga consumos y compra o activa objetos personales. No cambia la biblioteca.</p></div>
        </section>
      </div>

      <section className="admin-panel admin-transfer">
        <div className="section-heading"><div><h3>Importar y exportar</h3><p>Copias portables en JSON; no incluyen ni modifican los archivos de audio.</p></div><FileText /></div>
        <div className="admin-transfer-row">
          <span className="admin-transfer-icon"><ListMusic /></span>
          <div><strong>Playlists</strong><p>Busca primero cada título y autor en la biblioteca. Las canciones no descargadas se resuelven con el módulo 8SPINE activo y se guardan con su enlace.</p></div>
          <div className="admin-transfer-actions">
            <button className="button button-secondary" disabled={Boolean(transferBusy)} onClick={() => downloadJson('/admin/export/playlists', `sonora-playlists-${new Date().toISOString().slice(0, 10)}.json`, 'export-playlists')}><Download /> {transferBusy === 'export-playlists' ? 'Exportando…' : 'Exportar'}</button>
            <button className="button button-secondary" disabled={Boolean(transferBusy)} onClick={() => playlistFileInput.current?.click()}><Upload /> {transferBusy === 'import-playlists' ? 'Resolviendo…' : 'Importar'}</button>
            <input ref={playlistFileInput} className="visually-hidden" type="file" accept=".json,.txt,application/json,text/plain" onChange={importPlaylists} />
          </div>
        </div>
        <div className="admin-transfer-row">
          <span className="admin-transfer-icon"><Music2 /></span>
          <div><strong>Catálogo de canciones</strong><p>Exporta toda la información. Al importar, solo se aplica el campo <code>estilo</code>; no cambia títulos, autores ni archivos.</p></div>
          <div className="admin-transfer-actions">
            <button className="button button-secondary" disabled={Boolean(transferBusy)} onClick={() => downloadJson('/admin/export/catalog', `sonora-catalogo-${new Date().toISOString().slice(0, 10)}.json`, 'export-catalog')}><Download /> {transferBusy === 'export-catalog' ? 'Exportando…' : 'Exportar catálogo'}</button>
            <button className="button button-secondary" disabled={Boolean(transferBusy)} onClick={() => catalogFileInput.current?.click()}><Upload /> {transferBusy === 'import-catalog' ? 'Importando…' : 'Importar estilos'}</button>
            <input ref={catalogFileInput} className="visually-hidden" type="file" accept=".json,.txt,application/json,text/plain" onChange={importCatalog} />
          </div>
        </div>
        {transferMessage && <p className="admin-transfer-message" role="status">{transferMessage}</p>}
      </section>

      <section className="admin-panel admin-styles">
        <div className="section-heading"><div><h3>Estilos de escucha</h3><p>Los estilos personalizados aparecen en Canciones, en las exportaciones y participan en el aprendizaje de recomendaciones.</p></div><Palette /></div>
        <form className="admin-style-form" onSubmit={createMood}>
          <label htmlFor="custom-style-name">Nuevo estilo</label>
          <div>
            <input id="custom-style-name" value={moodName} onChange={(event) => setMoodName(event.target.value)} minLength="2" maxLength="48" placeholder="Ej. A tope de power" required />
            <button className="button button-primary" disabled={moodSaving}><Plus /> {moodSaving ? 'Añadiendo…' : 'Añadir estilo'}</button>
          </div>
        </form>
        <div className="admin-style-list" aria-label="Estilos disponibles">
          {moods.map((mood) => (
            <div className="admin-style-row" key={mood.name}>
              <span><strong>{mood.name}</strong><small>Personalizado · {mood.count} canciones</small></span>
              <button className="icon-button" disabled={mood.count > 0} title={mood.count > 0 ? 'Quita este estilo de sus canciones antes de eliminarlo' : `Eliminar ${mood.name}`} aria-label={`Eliminar ${mood.name}`} onClick={() => removeMood(mood)}><Trash2 /></button>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-panel admin-artist-profiles">
        <div className="section-heading"><div><h3>Perfiles de artistas</h3><p>Completa nacimiento, origen, biografía y foto cuando el proveedor de metadatos no los ofrezca.</p></div><Mic2 /></div>
        <form className="admin-artist-form" onSubmit={saveArtistProfile}>
          <label className="admin-artist-name">Artista<input list="admin-artist-names" value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Escribe o elige un artista" required /></label>
          <datalist id="admin-artist-names">{artistNames.map((name) => <option value={name} key={name} />)}</datalist>
          <label>Fecha de nacimiento<input type="date" value={profileBirthDate} onChange={(event) => setProfileBirthDate(event.target.value)} /></label>
          <label>Origen u otro dato<input value={profileOrigin} onChange={(event) => setProfileOrigin(event.target.value)} maxLength="180" placeholder="Ej. Madrid, España" /></label>
          <label className="admin-artist-image">URL de la foto<input type="url" value={profileImageUrl} onChange={(event) => setProfileImageUrl(event.target.value)} placeholder="https://…" /></label>
          <label className="admin-artist-biography">Biografía<textarea value={profileBiography} onChange={(event) => setProfileBiography(event.target.value)} maxLength="6000" rows="5" placeholder="Información del artista que aparecerá en su perfil" /></label>
          <div className="admin-artist-actions">
            <button type="button" className="button button-secondary" disabled={!profileName.trim()} onClick={() => editArtistProfile(profileName)}>Cargar guardado</button>
            <button className="button button-primary" disabled={profileSaving || !profileName.trim()}><Check /> {profileSaving ? 'Guardando…' : 'Guardar perfil'}</button>
          </div>
        </form>
        {profileMessage && <p className="admin-transfer-message" role="status">{profileMessage}</p>}
        <div className="admin-artist-list" aria-label="Perfiles de artista editados manualmente">
          {artistProfiles.map((profile) => (
            <article className="admin-artist-row" key={profile.name}>
              <span className="admin-artist-avatar">{profile.imageUrl ? <img src={profile.imageUrl} alt="" /> : <Mic2 />}</span>
              <button type="button" onClick={() => editArtistProfile(profile.name)}><strong>{profile.name}</strong><small>{profile.birthDate || 'Sin fecha'} · {profile.origin || 'Sin origen'}</small></button>
              <button type="button" className="icon-button" aria-label={`Eliminar datos manuales de ${profile.name}`} onClick={() => removeArtistProfile(profile)}><Trash2 /></button>
            </article>
          ))}
          {!artistProfiles.length && <p className="empty-copy">Todavía no hay perfiles completados manualmente.</p>}
        </div>
      </section>

      <section className="admin-panel admin-links">
        <div className="section-heading"><div><h3>Enlaces Sonora</h3><p>Crea accesos directos a canciones, artistas, álbumes, productos o apartados. Pégalos en el buscador de Sonora para abrir su destino.</p></div><Link2 /></div>
        <form className="admin-link-form" onSubmit={createLink}>
          <label>Nombre del enlace<input value={linkLabel} onChange={(event) => setLinkLabel(event.target.value)} minLength="2" maxLength="80" placeholder="Ej. Mi canción favorita" required /></label>
          <label>Tipo de destino<select value={linkType} onChange={(event) => { setLinkType(event.target.value); setLinkTarget('') }}><option value="music">Música</option><option value="artist">Artista</option><option value="album">Álbum</option><option value="product">Producto</option><option value="section">Apartado de la web</option></select></label>
          <label>Destino<select value={selectedLinkTarget} onChange={(event) => setLinkTarget(event.target.value)} disabled={!linkTargets.length}>{linkTargets.length ? linkTargets.map((target) => <option key={target.id} value={target.id}>{target.label}{target.detail ? ` · ${target.detail}` : ''}</option>) : <option value="">No hay destinos disponibles</option>}</select></label>
          <button className="button button-primary" disabled={linkSaving || !selectedLinkTarget}><Plus /> {linkSaving ? 'Creando…' : 'Crear enlace'}</button>
        </form>
        {linkMessage && <p className="admin-link-message" role="status">{linkMessage}</p>}
        <div className="admin-link-list" aria-label="Enlaces Sonora creados">
          {links.length ? links.map((link) => (
            <article className={`admin-link-row ${link.targetAvailable ? '' : 'is-unavailable'}`} key={link.id}>
              <span className="admin-link-symbol"><Link2 /></span>
              <div className="admin-link-copy"><strong>{link.label}</strong><small>{link.targetLabel}{link.targetDetail ? ` · ${link.targetDetail}` : ''} · {dateLabel(link.createdAt)}</small><code>{link.uri}</code></div>
              <div className="admin-link-actions">
                <button className="icon-button" type="button" aria-label={`Copiar ${link.label}`} title="Copiar enlace" onClick={() => copyLink(link)}><Copy /></button>
                <button className="icon-button" type="button" aria-label={`Abrir ${link.label}`} title="Abrir destino" disabled={!link.targetAvailable} onClick={() => onOpenLink?.(link.uri)}><ExternalLink /></button>
                <button className="icon-button" type="button" aria-label={`Eliminar ${link.label}`} title="Eliminar enlace" onClick={() => removeLink(link)}><Trash2 /></button>
              </div>
            </article>
          )) : <p className="empty-copy">Todavía no has creado ningún enlace Sonora.</p>}
        </div>
      </section>

      <section className="admin-panel admin-users">
        <div className="section-heading"><div><h3>Usuarios de Sonora</h3><p>{users.length} cuenta{users.length === 1 ? '' : 's'} guardada{users.length === 1 ? '' : 's'} en este equipo.</p></div><UsersRound /></div>
        {loading ? <p className="empty-copy">Cargando usuarios…</p> : users.map((user) => (
          <article className="admin-user-row" key={user.id}>
            <span className={`admin-user-avatar ${user.role === 'admin' ? 'is-admin' : ''}`}>{user.displayName.slice(0, 1).toUpperCase()}</span>
            <div><strong>{user.displayName}</strong><small>{user.email} · {dateLabel(user.lastLoginAt)}</small></div>
            <span className={`role-badge ${user.role}`}>{user.role === 'admin' ? <><ShieldCheck /> Admin</> : <><Headphones /> Oyente</>}</span>
            <span className="admin-user-activity">{user.listens || 0} escuchas · {user.purchases || 0} compras</span>
            <button className="icon-button" disabled={user.id === currentUser.id || user.role === 'admin'} aria-label={`Eliminar a ${user.displayName}`} onClick={() => removeUser(user)}><Trash2 /></button>
          </article>
        ))}
      </section>
    </div>
  )
}
