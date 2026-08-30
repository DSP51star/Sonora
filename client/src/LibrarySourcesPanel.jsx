import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { AudioLines, Check, Download, FileText, Folder, Link2, Trash2, Upload, X } from './Icons.jsx'

export function LibrarySourcesPanel({
  busy,
  progress,
  modules = [],
  activeModuleId = null,
  onClose,
  onFolder,
  onJsonFile,
  onJsonUrl,
  onModuleDelete,
  onModuleSelect,
}) {
  const panelRef = useRef(null)
  const moduleMenuRef = useRef(null)
  const [catalogUrl, setCatalogUrl] = useState('')
  const [moduleMenu, setModuleMenu] = useState(null)

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== 'Escape') return
      if (moduleMenu) {
        setModuleMenu(null)
        moduleMenu.trigger?.focus()
      } else {
        onClose()
      }
    }
    function onPointerDown(event) {
      if (event.target.closest?.('.module-context-menu')) return
      if (!panelRef.current?.contains(event.target) && !event.target.closest('.library-source-trigger')) onClose()
      else if (moduleMenu) setModuleMenu(null)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [moduleMenu, onClose])

  useEffect(() => {
    if (!moduleMenu) return undefined
    moduleMenuRef.current?.querySelector('[role="menuitem"]')?.focus()
    function closeMenu() {
      setModuleMenu(null)
    }
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [moduleMenu])

  function openModuleMenu(event, module) {
    event.preventDefault()
    if (busy) return
    const trigger = event.currentTarget
    const rect = trigger.getBoundingClientRect()
    const pointerX = event.clientX || rect.right - 12
    const pointerY = event.clientY || rect.top + rect.height / 2
    setModuleMenu({
      module,
      trigger,
      x: Math.max(8, Math.min(pointerX, window.innerWidth - 220)),
      y: Math.max(8, Math.min(pointerY, window.innerHeight - 58)),
    })
  }

  function moduleMenuKeyDown(event, module) {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openModuleMenu(event, module)
  }

  async function deleteSelectedModule() {
    const selected = moduleMenu?.module
    setModuleMenu(null)
    if (selected) await onModuleDelete(selected)
  }

  async function submitUrl(event) {
    event.preventDefault()
    if (!catalogUrl.trim() || busy) return
    await onJsonUrl(catalogUrl.trim())
  }

  return (
    <motion.section
      ref={panelRef}
      id="library-sources-panel"
      className="library-sources-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="library-sources-title"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.18 }}
    >
      <header>
        <div>
          <h2 id="library-sources-title">Añadir música</h2>
          <p>Elige de dónde leer tu biblioteca.</p>
        </div>
        <button type="button" className="icon-button" aria-label="Cerrar fuentes de música" onClick={onClose}><X /></button>
      </header>

      <div className="source-actions">
        <label className={`source-action ${busy ? 'is-disabled' : ''}`}>
          <span className="source-action-icon"><Folder /></span>
          <span><strong>Carpeta del dispositivo</strong><small>Audio, carátulas y subtítulos con el mismo nombre</small></span>
          <Upload />
          <input
            type="file"
            multiple
            accept="audio/*,.mp3,.flac,.wav,.ogg,.m4a,.aac,.lrc,.txt,.vtt,.srt,image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={onFolder}
            {...{ webkitdirectory: '', directory: '' }}
          />
        </label>
        <label className={`source-action ${busy ? 'is-disabled' : ''}`}>
          <span className="source-action-icon"><FileText /></span>
          <span><strong>Archivo JSON</strong><small>Un catálogo de enlaces, títulos, portadas y subtítulos</small></span>
          <Upload />
          <input type="file" accept="application/json,.json" disabled={busy} onChange={onJsonFile} />
        </label>
      </div>

      <form className="catalog-url-form" onSubmit={submitUrl}>
        <label htmlFor="catalog-url">URL de catálogo o módulos 8SPINE</label>
        <div>
          <Link2 />
          <input
            id="catalog-url"
            type="url"
            inputMode="url"
            value={catalogUrl}
            onChange={(event) => setCatalogUrl(event.target.value)}
            placeholder="https://github.com/autor/modulos"
            disabled={busy}
          />
          <button className="button button-primary" disabled={busy || !catalogUrl.trim()}>Cargar</button>
        </div>
      </form>

      {modules.length > 0 && (
        <section className="module-source-list" aria-labelledby="module-source-title">
          <div>
            <strong id="module-source-title">Módulo de streaming</strong>
            <small>Cambia de proveedor; haz clic derecho para eliminar uno.</small>
          </div>
          {modules.map((module) => {
            const active = activeModuleId === module.catalogId
            return (
              <button
                key={module.catalogId}
                type="button"
                className={active ? 'is-active' : ''}
                disabled={busy}
                aria-haspopup="menu"
                aria-expanded={moduleMenu?.module.catalogId === module.catalogId}
                aria-pressed={active}
                onClick={() => onModuleSelect(module)}
                onContextMenu={(event) => openModuleMenu(event, module)}
                onKeyDown={(event) => moduleMenuKeyDown(event, module)}
              >
                <span className="source-action-icon"><AudioLines /></span>
                <span>
                  <strong>{module.name}</strong>
                  <small>{[module.author, module.version && `v${module.version}`, ...(module.labels || []).slice(0, 2)].filter(Boolean).join(' · ') || 'Módulo 8SPINE'}</small>
                </span>
                {active ? <Check /> : <span className="module-inactive-dot" />}
              </button>
            )
          })}
        </section>
      )}

      {moduleMenu && createPortal(
        <motion.div
          className="track-context-layer module-context-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
          onPointerDown={() => setModuleMenu(null)}
          onContextMenu={(event) => { event.preventDefault(); setModuleMenu(null) }}
        >
          <motion.div
            ref={moduleMenuRef}
            className="track-context-menu module-context-menu"
            role="menu"
            aria-label={`Acciones para ${moduleMenu.module.name}`}
            style={{ left: moduleMenu.x, top: moduleMenu.y }}
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setModuleMenu(null)
            }}
          >
            <button className="module-delete-action" type="button" role="menuitem" onClick={deleteSelectedModule}>
              <Trash2 /><span>Eliminar módulo</span>
            </button>
          </motion.div>
        </motion.div>,
        document.body,
      )}

      {busy && (
        <div className="source-progress" role="status" aria-live="polite">
          <span className="source-progress-bar"><span style={{ width: `${progress?.percent || 8}%` }} /></span>
          <small>{progress?.label || 'Preparando la biblioteca…'}</small>
        </div>
      )}

      <footer>
        <p>Las carpetas se quedan en este navegador. Los módulos comunitarios se ejecutan aislados y pueden contactar con sus propios servicios; instala solo fuentes en las que confíes.</p>
        <a href="/sonora-library.example.json" download><Download /> Descargar plantilla JSON</a>
      </footer>
    </motion.section>
  )
}
