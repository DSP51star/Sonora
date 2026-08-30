# Catálogos JSON de Sonora

Sonora admite un array de canciones o un objeto con una propiedad `tracks`, `songs`, `music` o `library`.

```json
{
  "version": 1,
  "tracks": [
    {
      "title": "Título",
      "artist": "Artista",
      "album": "Álbum",
      "genre": "Género",
      "year": 2026,
      "duration": 213,
      "audio": "https://cdn.example.com/audio/cancion.mp3",
      "cover": "https://cdn.example.com/covers/cancion.jpg",
      "subtitles": "https://cdn.example.com/lyrics/cancion.lrc"
    }
  ]
}
```

`audio` es el único campo obligatorio. También se aceptan `url`, `src`, `streamUrl`, `music` o `link`. Para la portada se puede usar `cover`, `coverUrl`, `artwork`, `artworkUrl` o `image`. Las letras o subtítulos pueden indicarse con `lyrics`, `lyricsUrl`, `subtitles`, `subtitlesUrl`, `captions` o `captionsUrl`.

Los subtítulos pueden ser archivos LRC, VTT, SRT o TXT. También se puede incluir el contenido directamente:

```json
{
  "audio": "https://cdn.example.com/audio/cancion.mp3",
  "lyrics": {
    "format": "lrc",
    "name": "cancion.lrc",
    "content": "[00:04.20]Primera línea\n[00:08.70]Segunda línea"
  }
}
```

Cuando el catálogo se carga desde una URL, `audio`, `cover` y `subtitles` pueden ser rutas relativas al propio JSON. El servidor que aloja el catálogo, el audio y los subtítulos debe permitir solicitudes CORS desde el dominio donde se publique Sonora.

## Módulos de streaming 8SPINE

El mismo campo **URL de catálogo o módulos 8SPINE** admite fuentes del ecosistema 8SPINE. Se puede pegar cualquiera de estas direcciones:

- La portada de un repositorio de GitHub, por ejemplo `https://github.com/KissAnotherDay/Geolier2-8spine`.
- La URL directa de su `index.json`.
- La URL directa de un archivo `.8spine` o de un módulo JavaScript compatible.

Si la URL contiene un índice, Sonora muestra todos sus módulos debajo del campo y permite cambiar el proveedor activo sin volver a importar la fuente. El módulo elegido se recuerda en ese navegador. Las búsquedas de la barra superior combinan la biblioteca de Sonora con los resultados remotos; el enlace de audio se resuelve justo al pulsar una pista para evitar que caduque antes de reproducirse.

Al pulsar Intro, Sonora abre una búsqueda completa con canciones reproducibles del módulo, artistas y álbumes enriquecidos por Apple Music España. Las recomendaciones semanales también intercalan resultados del módulo activo aunque todavía no estén descargados.

En una instalación con servidor y una cuenta administradora, el botón **Descargar en Música** resuelve el enlace temporal y guarda la pista en la carpeta configurada, dentro de `Artista/Álbum`. Después se indexa como cualquier archivo local. Por seguridad, la descarga solo acepta HTTPS, limita el tamaño y rechaza direcciones privadas o locales.

Sonora reconoce los paquetes cifrados con cabecera `8SM1` y el contrato estándar `searchTracks(query, limit)` / `getTrackStreamUrl(id, quality)`. Los módulos se ejecutan en un Web Worker separado: no tienen acceso al DOM, a las cookies de sesión ni a la base de datos de Sonora. Sí pueden comunicarse con los servicios externos definidos por su autor, por lo que solo deben instalarse fuentes de confianza. Tanto el índice y el archivo del módulo como las API y los audios que utilice necesitan permitir solicitudes CORS desde el navegador.
