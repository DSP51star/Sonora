import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Check,
  ClipboardPaste,
  CreditCard,
  Disc3,
  Download,
  FileAudio,
  FileText,
  Gauge,
  Layers3,
  Pencil,
  ReceiptText,
  Save,
  Search,
  ShieldCheck,
  Upload,
  X,
} from './Icons.jsx'
import { api, formatEuros, formatTime, formatTokenAmount, formatTokenEuros } from './api'
import { DolbyAtmosLogo } from './DolbyAtmosLogo'

function formatBytes(bytes) {
  const value = Number(bytes || 0)
  if (!value) return '—'
  if (value < 1_000_000) return `${(value / 1_000).toLocaleString('es-ES', { maximumFractionDigits: 0 })} KB`
  return `${(value / 1_000_000).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`
}

function formatBitrate(bits) {
  const value = Number(bits || 0)
  return value ? `${Math.round(value / 1_000).toLocaleString('es-ES')} kbps` : '—'
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(`${value.replace(' ', 'T')}Z`))
}

function captionTime(value) {
  const match = String(value || '').trim().match(/^(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{1,3})/)
  if (!match) return null
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4]}`)
}

function parseCaptionCues(content) {
  return String(content || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .flatMap((block) => {
      const rows = block.split('\n').map((line) => line.trim()).filter(Boolean)
      const timingIndex = rows.findIndex((line) => line.includes('-->'))
      if (timingIndex < 0) return []
      const time = captionTime(rows[timingIndex].split('-->')[0])
      const cueText = rows.slice(timingIndex + 1).join(' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\{\\[^}]+}/g, '')
        .trim()
      return time == null || !cueText ? [] : [{ time, text: cueText }]
    })
    .sort((a, b) => a.time - b.time)
}

function parseLyrics(content, duration, format = 'lrc') {
  if (format === 'vtt' || format === 'srt') return parseCaptionCues(content)
  const sourceLines = String(content || '').replace(/\r\n?/g, '\n').split('\n')
  const timed = []
  const timestampPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?]/g

  if (format !== 'txt') {
    sourceLines.forEach((sourceLine) => {
      const timestamps = [...sourceLine.matchAll(timestampPattern)]
      const text = sourceLine.replace(timestampPattern, '').replace(/^\[[a-z]+:.*]$/i, '').trim()
      if (!text || !timestamps.length) return
      timestamps.forEach((match) => {
        const fraction = match[3] ? Number(`0.${match[3]}`) : 0
        timed.push({ time: Number(match[1]) * 60 + Number(match[2]) + fraction, text })
      })
    })
  }

  if (timed.length) return timed.sort((a, b) => a.time - b.time)

  const plain = sourceLines
    .map((line) => line.replace(timestampPattern, '').replace(/^\[[a-z]+:.*]$/i, '').trim())
    .filter(Boolean)
  if (!plain.length) return []
  const start = Math.min(4, Math.max(0, Number(duration || 0) * 0.03))
  const usableDuration = Math.max(plain.length * 4, Number(duration || 0) - start)
  const step = usableDuration / plain.length
  return plain.map((text, index) => ({ text, time: start + index * step, estimated: true }))
}

function Artwork({ track }) {
  return (
    <div className="now-artwork">
      {track?.artworkUrl ? <img src={track.artworkUrl} alt={`Carátula de ${track.album}`} /> : <Disc3 aria-hidden="true" />}
    </div>
  )
}

function LyricsPanel({ player }) {
  const [lyrics, setLyrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftFormat, setDraftFormat] = useState('lrc')
  const [saving, setSaving] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const lineRefs = useRef([])
  const track = player.currentTrack

  useEffect(() => {
    let cancelled = false
    async function loadLyrics() {
      if (track.lyrics?.content) return track.lyrics
      if (track.lyrics?.url) {
        const response = await fetch(track.lyrics.url, { headers: { Accept: 'text/plain' } })
        if (!response.ok) throw new Error(`No se pudieron cargar los subtítulos (${response.status}).`)
        return { ...track.lyrics, content: await response.text() }
      }
      if (track.browserOnly) return { content: '', sourceName: null, synced: false, format: 'lrc' }
      return api(`/tracks/${track.id}/lyrics`)
    }
    Promise.resolve()
      .then(() => {
        if (!cancelled) {
          setLoading(true)
          setSaveStatus('')
        }
        return loadLyrics()
      })
      .then((result) => { if (!cancelled) setLyrics(result) })
      .catch((error) => {
        if (!cancelled) {
          setLyrics({ content: '', sourceName: null, synced: false, format: 'lrc' })
          setSaveStatus(error.message)
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [track.browserOnly, track.id, track.lyrics])

  async function saveTrackLyrics(payload) {
    if (!track.browserOnly) {
      return api(`/tracks/${track.id}/lyrics`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
    }
    const format = payload.format || 'txt'
    return {
      ...payload,
      content: String(payload.content || '').replace(/\r\n?/g, '\n').trim(),
      synced: format !== 'txt',
      updatedAt: new Date().toISOString(),
    }
  }

  const lines = useMemo(() => parseLyrics(lyrics?.content, player.duration || track.duration, lyrics?.format), [lyrics?.content, lyrics?.format, player.duration, track.duration])
  const activeIndex = useMemo(() => {
    if (!lines.length) return -1
    let found = 0
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].time <= player.currentTime + 0.08) found = index
      else break
    }
    return found
  }, [lines, player.currentTime])
  useEffect(() => {
    if (activeIndex < 0) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    lineRefs.current[activeIndex]?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
  }, [activeIndex])

  async function importLyrics(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const content = await file.text()
      const format = file.name.toLowerCase().endsWith('.lrc') ? 'lrc'
        : file.name.toLowerCase().endsWith('.vtt') ? 'vtt'
          : file.name.toLowerCase().endsWith('.srt') ? 'srt' : 'txt'
      const saved = await saveTrackLyrics({ sourceName: file.name, content, format })
      setLyrics(saved)
      setEditorOpen(false)
      setSaveStatus(saved.synced ? 'Letras sincronizadas y guardadas' : 'Letras guardadas · sincronización estimada')
    } catch (error) {
      setSaveStatus(error.message)
    }
  }

  function openEditor() {
    setDraft(lyrics?.content || '')
    setDraftFormat(lyrics?.format || (lyrics?.synced ? 'lrc' : 'txt'))
    setSaveStatus('')
    setEditorOpen(true)
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      setDraft((current) => current ? `${current}\n${text}` : text)
    } catch {
      setSaveStatus('Usa Ctrl+V dentro del editor para pegar la letra')
    }
  }

  async function saveDraft(event) {
    event.preventDefault()
    if (!draft.trim()) {
      setSaveStatus('Pega o escribe la letra antes de guardarla')
      return
    }
    setSaving(true)
    setSaveStatus('')
    try {
      const saved = await saveTrackLyrics({
        sourceName: `${track.title || 'letras'}.${draftFormat}`,
        content: draft,
        format: draftFormat,
      })
      setLyrics(saved)
      setEditorOpen(false)
      setSaveStatus(saved.synced ? 'LRC sincronizado y guardado' : 'Letra guardada · temporización estimada')
    } catch (error) {
      setSaveStatus(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function lookupLrclib() {
    setLookingUp(true)
    setSaveStatus('')
    try {
      const params = new URLSearchParams({
        title: track.title || '',
        artist: track.artist || '',
        album: track.album || '',
        duration: String(Math.round(player.duration || track.duration || 0)),
      })
      const result = await api(`/metadata/lyrics?${params}`)
      const saved = await saveTrackLyrics(result)
      setLyrics(saved)
      setEditorOpen(false)
      setSaveStatus(saved.synced ? 'LRC sincronizado obtenido de LRCLIB' : 'Letra obtenida de LRCLIB')
    } catch (error) {
      setSaveStatus(error.message)
    } finally {
      setLookingUp(false)
    }
  }

  return (
    <section className="lyrics-panel" aria-labelledby="lyrics-title">
      <div className="lyrics-heading">
        <div>
          <span id="lyrics-title">Letras</span>
          <small>{lyrics?.sourceName || 'Todavía sin archivo'}</small>
        </div>
        <div className="lyrics-actions">
          <button type="button" className="lyrics-import button button-secondary" onClick={lookupLrclib} disabled={lookingUp}><Search /> {lookingUp ? 'Buscando…' : 'LRCLIB'}</button>
          {(lyrics?.content || editorOpen) && <button type="button" className="lyrics-import button button-secondary" onClick={editorOpen ? () => setEditorOpen(false) : openEditor}>{editorOpen ? <X /> : <Pencil />}{editorOpen ? 'Cancelar' : 'Editar'}</button>}
          <label className="lyrics-import button button-secondary">
            <Upload /> Importar
            <input type="file" accept=".lrc,.txt,.vtt,.srt,text/plain,text/vtt,application/x-subrip" onChange={importLyrics} />
          </label>
        </div>
      </div>

      <div className={`lyrics-viewport ${editorOpen ? 'lyrics-editor-viewport' : ''}`} aria-live="polite">
        {editorOpen && (
          <form className="lyrics-editor" onSubmit={saveDraft}>
            <div className="lyrics-editor-heading"><div><strong>Pegar letra</strong><small>Elige cómo debe interpretar Sonora el contenido.</small></div><button type="button" className="button button-secondary" onClick={pasteFromClipboard}><ClipboardPaste /> Pegar</button></div>
            <fieldset className="lyrics-format-picker">
              <legend>Formato</legend>
              <label className={draftFormat === 'lrc' ? 'selected' : ''}><input type="radio" name="lyrics-format" value="lrc" checked={draftFormat === 'lrc'} onChange={() => setDraftFormat('lrc')} /><span><strong>LRC sincronizado</strong><small>Líneas con marcas como [00:12.40]</small></span></label>
              <label className={draftFormat === 'txt' ? 'selected' : ''}><input type="radio" name="lyrics-format" value="txt" checked={draftFormat === 'txt'} onChange={() => setDraftFormat('txt')} /><span><strong>Texto normal</strong><small>Sonora distribuirá las líneas durante la canción</small></span></label>
            </fieldset>
            <label className="lyrics-textarea"><span>Contenido</span><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={draftFormat === 'lrc' ? '[00:12.40] Primera línea\n[00:17.80] Segunda línea' : 'Primera línea\nSegunda línea'} spellCheck="false" autoFocus /></label>
            <div className="lyrics-editor-footer"><small>{draft.trim() ? `${draft.trim().split(/\n/).length} líneas` : 'Sin contenido'}</small><button className="button button-primary" disabled={saving || !draft.trim()}>{saving ? 'Guardando…' : <><Save /> Guardar letra</>}</button></div>
          </form>
        )}
        {loading && (
          <div className="lyrics-loading" aria-label="Cargando letras">
            <span /><span /><span /><span />
          </div>
        )}
        {!editorOpen && !loading && !lines.length && (
          <div className="lyrics-empty">
            <FileText />
            <h3>Haz sitio a la voz</h3>
            <p>Importa un archivo LRC para sincronización exacta o un TXT para repartir las líneas durante la canción.</p>
            <div className="lyrics-empty-actions">
              <button type="button" className="button button-primary" onClick={lookupLrclib} disabled={lookingUp}><Search /> {lookingUp ? 'Buscando en LRCLIB…' : 'Buscar en LRCLIB'}</button>
              <button type="button" className="button button-primary" onClick={openEditor}><ClipboardPaste /> Pegar letra</button>
              <label className="button button-secondary"><Upload /> Elegir archivo<input type="file" accept=".lrc,.txt,.vtt,.srt,text/plain,text/vtt,application/x-subrip" onChange={importLyrics} /></label>
            </div>
          </div>
        )}
        {!editorOpen && !loading && lines.length > 0 && (
          <div className="lyrics-lines">
            {lines.map((line, index) => {
              const active = index === activeIndex
              return (
                <button
                  type="button"
                  key={`${line.time}-${index}`}
                  ref={(node) => { lineRefs.current[index] = node }}
                  className={`lyric-line ${active ? 'is-active' : ''} ${index < activeIndex ? 'is-past' : ''}`}
                  onClick={() => player.seek(line.time)}
                  aria-label={line.text}
                  aria-current={active ? 'true' : undefined}
                >
                  <span className="lyric-shape">
                    <span className="lyric-text">{line.text}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="lyrics-status">
        <span>{lyrics?.synced ? `${(lyrics.format || 'LRC').toUpperCase()} sincronizado` : lyrics?.content ? `${(lyrics.format || 'TXT').toUpperCase()} · temporización estimada` : 'LRC, VTT, SRT o TXT'}</span>
        {saveStatus && <span className="lyrics-save-status"><Check /> {saveStatus}</span>}
      </div>
    </section>
  )
}

export function NowPlayingView({ player, onClose, onOpenTokens, onOpenArtist, onOpenAlbum, onDownload, downloadBusy = false }) {
  const track = player.currentTrack
  if (!track) return null
  const format = [track.container, track.codec].filter(Boolean).filter((value, index, array) => array.indexOf(value) === index).join(' · ') || 'Desconocido'
  const channelLabel = track.channels ? `${track.channels} canal${track.channels === 1 ? '' : 'es'}` : '—'

  return (
    <motion.section className="now-playing-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      {track.artworkUrl && <div className="now-playing-backdrop" style={{ backgroundImage: `url(${track.artworkUrl})` }} aria-hidden="true" />}
      <div className="now-playing-topline">
        <button type="button" className="text-button now-back" onClick={onClose}><ArrowLeft /> Volver</button>
        <DolbyAtmosLogo className="dolby-mark" />
      </div>

      <div className="now-playing-layout">
        <div className="now-primary">
          <Artwork track={track} />
          <div className="now-title">
            <span>Reproduciendo</span>
            <h2>{track.title}</h2>
            <div className="now-title-meta">
              <p><button type="button" className="metadata-link" onClick={() => onOpenArtist(track.artist)}>{track.artist}</button><span aria-hidden="true"> · </span><button type="button" className="metadata-link" onClick={() => onOpenAlbum(track)}>{track.album}</button></p>
              <DolbyAtmosLogo className="dolby-title-logo" />
            </div>
          </div>
          <div className="now-position" aria-label={`Posición ${formatTime(player.currentTime)} de ${formatTime(player.duration)}`}>
            <span>{formatTime(player.currentTime)}</span>
            <div><i style={{ width: `${player.duration ? player.currentTime / player.duration * 100 : 0}%` }} /></div>
            <span>{formatTime(player.duration)}</span>
          </div>
        </div>

        <LyricsPanel key={track.id} player={player} />

        <aside className="track-facts" aria-label="Información del archivo">
          <div className="facts-heading"><FileAudio /><div><span>Archivo de origen</span><strong>Detalles técnicos</strong></div></div>
          <dl>
            <div><dt>Álbum</dt><dd><button type="button" className="metadata-link" onClick={() => onOpenAlbum(track)}>{track.album}</button></dd></div>
            <div><dt>Autor</dt><dd><button type="button" className="metadata-link" onClick={() => onOpenArtist(track.artist)}>{track.artist}</button></dd></div>
            <div><dt>Año</dt><dd>{track.year || '—'}</dd></div>
            <div><dt>Formato</dt><dd>{format}</dd></div>
            <div><dt>Tasa de bits</dt><dd>{formatBitrate(track.bitrate)}</dd></div>
            <div><dt>Canales</dt><dd>{channelLabel}</dd></div>
            <div><dt>Tamaño</dt><dd>{formatBytes(track.fileSize)}</dd></div>
            <div><dt>Duración</dt><dd>{formatTime(track.duration)}</dd></div>
          </dl>
          <div className="token-cost-block">
            <span><Gauge /> Coste de esta reproducción</span>
            <strong>
              {formatTokenAmount(track.tokenCost)} <small>tokens</small>
              <em>· {formatTokenEuros(track.tokenCost)}</em>
            </strong>
            <p>{track.sourceKind === '8spine' ? 'El streaming del módulo carga 0,18 € (12,86 tokens) al comenzar cada reproducción.' : 'Es el coste completo. Al cambiar o detener la canción se carga únicamente la parte que hayas escuchado.'}</p>
            <button type="button" className="button button-secondary" onClick={onOpenTokens}><ReceiptText /> Ver consumo acumulado</button>
            {track.sourceKind === '8spine' && onDownload && <button type="button" className="button button-secondary" onClick={() => onDownload(track)} disabled={downloadBusy}><Download /> {downloadBusy ? 'Descargando…' : 'Descargar en Música'}</button>}
          </div>
          <div className="file-location">
            <span>{track.sourceKind === '8spine' ? 'Fuente de streaming' : 'Ubicación local'}</span>
            <p title={track.location || track.path}>{track.location || track.path || '—'}</p>
          </div>
        </aside>
      </div>
    </motion.section>
  )
}

export function TokenAccountView({ account, onPay }) {
  const pending = account?.pending || []
  const payments = account?.payments || []
  return (
    <motion.div className="token-account" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}>
      <header className="token-account-heading">
        <div>
          <span>Consumo local</span>
          <h2>Tokens de reproducción</h2>
          <p>Los archivos locales se cobran según la parte escuchada. Cada reproducción de un módulo cuesta 0,18 € (12,86 tokens) al comenzar. Referencia: 1.000 tokens ≈ 14 €.</p>
        </div>
        <div className="token-balance">
          <small>Pendiente</small>
          <strong>{formatTokenAmount(account?.pendingTotal)}</strong>
          <span>tokens · {formatTokenEuros(account?.pendingTotal)}</span>
          <button type="button" className="button button-primary" disabled={!pending.length} onClick={onPay}><CreditCard /> Pagar consumo</button>
        </div>
      </header>

      <section className="token-ledger" aria-labelledby="pending-token-title">
        <div className="section-heading"><div><h3 id="pending-token-title">Reproducciones pendientes</h3><p>{pending.length} cargo{pending.length === 1 ? '' : 's'} todavía sin liquidar</p></div></div>
        {pending.length ? pending.map((entry) => (
          <article className="token-entry" key={entry.id}>
            <div className="token-entry-art">{entry.artworkUrl ? <img src={entry.artworkUrl} alt="" /> : <Disc3 />}</div>
            <div className="token-entry-copy"><strong>{entry.title}</strong><small>{entry.isStream ? `${entry.moduleId || '8SPINE'} · streaming de módulo · cargo fijo` : `${Math.round(Number(entry.completionRatio || 0) * 100)} % · ${formatTime(Number(entry.listenedSeconds || 0))} escuchados`} · {formatDate(entry.createdAt)}</small></div>
            <span>{formatBytes(entry.fileSize)}</span>
            <span>{formatBitrate(entry.bitrate)}</span>
            <b>{formatTokenAmount(entry.cost)} tokens · {formatTokenEuros(entry.cost)}</b>
          </article>
        )) : (
          <div className="token-empty"><Check /><div><strong>Todo está al día</strong><p>Las próximas reproducciones aparecerán aquí.</p></div></div>
        )}
      </section>

      <section className="token-payment-history" aria-labelledby="token-history-title">
        <div className="section-heading"><div><h3 id="token-history-title">Pagos</h3><p>Historial de recibos guardado en este equipo</p></div></div>
        {payments.length ? payments.map((payment) => (
          <div className="token-payment-row" key={payment.id}>
            <ShieldCheck />
            <span><strong>{formatTokenAmount(payment.amount)} tokens · {payment.amountCents ? formatEuros(payment.amountCents / 100) : formatTokenEuros(payment.amount)}</strong><small>{formatDate(payment.createdAt)}</small></span>
            <b>{payment.method === 'paypal' ? 'PayPal' : `${payment.brand || 'Tarjeta'} ···· ${payment.last4 || '0000'}`}</b>
          </div>
        )) : <p className="empty-copy">Aún no has realizado ningún pago.</p>}
      </section>
    </motion.div>
  )
}

export function TokenCheckout({ total, onClose, onComplete }) {
  const [method, setMethod] = useState('card')
  const [cardNumber, setCardNumber] = useState('')
  const [cardHolder, setCardHolder] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvc, setCvc] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onComplete({ method, cardNumber })
    } catch (requestError) {
      setError(requestError.message)
      setSaving(false)
    }
  }

  return (
    <motion.aside className="right-drawer token-checkout" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} role="dialog" aria-modal="true" aria-labelledby="token-checkout-title">
      <div className="drawer-heading"><div><span>Pago seguro</span><h2 id="token-checkout-title">Liquidar {formatTokenAmount(total)} tokens · {formatTokenEuros(total)}</h2></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}><X /></button></div>
      <div className="checkout-assurance"><ShieldCheck /><p><strong>Información de pago protegida.</strong> En el recibo sólo se conservarán el método, la marca y los últimos cuatro dígitos.</p></div>
      <form className="token-checkout-form" onSubmit={submit}>
        <fieldset>
          <legend>Método de pago</legend>
          <label><input type="radio" name="token-method" value="card" checked={method === 'card'} onChange={() => setMethod('card')} /><CreditCard /><span><strong>Tarjeta</strong><small>Visa, Mastercard y otras tarjetas</small></span></label>
          <label><input type="radio" name="token-method" value="paypal" checked={method === 'paypal'} onChange={() => setMethod('paypal')} /><Layers3 /><span><strong>PayPal</strong><small>Confirmación rápida con tu cuenta</small></span></label>
        </fieldset>
        {method === 'card' && <div className="checkout-card-fields">
          <label className="checkout-field"><span>Titular de la tarjeta</span><input value={cardHolder} onChange={(event) => setCardHolder(event.target.value)} autoComplete="cc-name" placeholder="Nombre y apellidos" required /></label>
          <label className="checkout-field"><span>Número de tarjeta</span><input value={cardNumber} onChange={(event) => setCardNumber(event.target.value.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim())} inputMode="numeric" autoComplete="cc-number" placeholder="1234 5678 9012 3456" minLength="15" required /></label>
          <div className="checkout-field-row"><label className="checkout-field"><span>Caducidad</span><input value={expiry} onChange={(event) => setExpiry(event.target.value.replace(/[^\d/]/g, '').slice(0, 5))} inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA" required /></label><label className="checkout-field"><span>CVC</span><input value={cvc} onChange={(event) => setCvc(event.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="cc-csc" placeholder="123" minLength="3" required /></label></div>
        </div>}
        {method === 'paypal' && <div className="payment-provider-note"><Layers3 /><p>Confirma el pago con PayPal al pulsar el botón inferior.</p></div>}
        <div className="token-checkout-total"><span>Total a liquidar</span><strong>{formatTokenAmount(total)} tokens · {formatTokenEuros(total)}</strong></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary button-large" disabled={saving}>{saving ? 'Procesando pago…' : `Pagar ${formatTokenEuros(total)}`}</button>
      </form>
    </motion.aside>
  )
}
