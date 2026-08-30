# Sonora Local

Reproductor de música web completamente local. Indexa una carpeta del PC, reproduce sus archivos con Web Audio API y guarda biblioteca, playlists, historial, recomendaciones y progresión en SQLite.

## Arranque

Haz doble clic en `iniciar.bat`. En el primer arranque se instalarán las dependencias, se preparará la interfaz y se abrirá `http://localhost:3000`.

Requiere Node.js 20 o posterior.

## Primera configuración

1. Crea tu primer perfil; esa primera cuenta será la administradora local.
2. Pulsa **Elegir** para abrir el selector de carpetas de Windows.
3. Selecciona la carpeta raíz de tu música.
4. Sonora buscará recursivamente MP3, FLAC, WAV, OGG, M4A y AAC.
5. El análisis de ambiente continuará de fondo mientras utilizas la aplicación.

La ruta se conserva en `data/config.json` y la biblioteca en `data/sonora.db`. Ningún archivo se sube a Internet.

## Capacidades

- Biblioteca por canciones, álbumes, artistas y géneros, con búsqueda en vivo y una vista completa al pulsar Intro.
- Fuentes personales desde el pie de la barra lateral: carpeta privada procesada en el navegador, archivo JSON, catálogo JSON remoto o repositorio de módulos 8SPINE.
- Compatibilidad con índices y paquetes cifrados `8SM1` de 8SPINE: selector de proveedor, búsqueda remota, resolución de streams al reproducir y restauración del módulo activo.
- Descarga administrada de pistas 8SPINE a la carpeta de música, con reindexado automático, límites de tamaño y bloqueo de destinos de red privada.
- Letras sincronizadas desde LRCLIB y metadatos de Apple Music España para búsquedas, álbumes y perfiles.
- Perfiles de artista con discografía y canciones destacadas; nacimiento, origen, biografía y foto se pueden completar en Administración.
- Asociación automática de audio con carátulas `cover`/`folder` y subtítulos LRC, VTT, SRT o TXT del mismo nombre.
- Renderizado virtual de canciones y cola: solo permanecen en el DOM las filas visibles y un pequeño margen.
- Roles multiusuario: un administrador gestiona biblioteca y cuentas; los oyentes reproducen y personalizan compras sin modificar el catálogo.
- Carátulas embebidas y `folder.jpg` / `cover.jpg`.
- Streaming con soporte de rangos y reproducción mediante un grafo Web Audio.
- Ecualizador de seis bandas, espectro, waveform, crossfade y efecto espacial.
- Inicio editorial con Descubrimiento semanal estable —mezclando biblioteca y módulo activo—, rotación reciente y estaciones personales.
- Cola reordenable, shuffle, repetición, favoritos, Media Session, controles de auriculares y atajos.
- Playlists locales e importación JSON por título y autor: primero recupera la biblioteca descargada y después usa el módulo 8SPINE activo para guardar los enlaces que falten.
- Análisis DSP multipunto con Meyda: seis zonas por pista, firma sonora de 32 dimensiones y perfil de evolución.
- Recomendador contextual v3 con memoria positiva/negativa, varios grupos de gusto, perfiles temporales, control de fatiga, secuenciación y exploración adaptativa.
- Explicaciones basadas en las puntuaciones reales de afinidad, transición, contexto y novedad.
- Historial, afinidad, estadísticas y resumen de escucha.
- Tienda premium con ficha de producto, demostraciones vivas, filtros, biblioteca de objetos e historial.
- Compras ficticias separadas por moneda: Puntos sin tarjeta o euros simulados sin alterar el saldo.
- Paquete **Liquid Glass** por 59,99 € (o 4.285 Puntos), comprable, equipable, reversible y restaurable desde la tienda.
- Temas, marcos, visualizadores, presets de EQ y efectos de estación equipables y persistentes.
- Un único controlador de energía compartido por hero, visualizadores y estaciones.
- Estudio de color persistente: acento, superficie y densidad de la interfaz.
- Sound Lab Pro con refuerzo de graves, compresión dinámica y ambiente por convolución.
- Géneros compuestos normalizados: una canción etiquetada con varios géneros aparece en cada apartado.

## Atajos

- `Espacio`: reproducir o pausar.
- `←` / `→`: canción anterior o siguiente.
- `↑` / `↓`: subir o bajar volumen.
- `M`: silenciar.

## Desarrollo y verificación

```powershell
npm run dev
npm run check
npm run smoke
npm run build
```

La prueba de humo usa una carpeta temporal y un WAV generado al vuelo; no modifica la biblioteca real.

La arquitectura y la fórmula del recomendador están documentadas en `docs/RECOMMENDER.md`.

El formato para catálogos de música enlazada está documentado en `docs/CATALOG_JSON.md`; la interfaz también permite descargar una plantilla.

## Importar playlists con un módulo 8SPINE

Desde **Administración > Importar y exportar > Playlists** se puede cargar el mismo JSON portable de Sonora usando únicamente el título y el autor de cada canción:

```json
{
  "formato": "sonora-playlists",
  "version": 2,
  "playlists": [
    {
      "nombre": "Mi lista",
      "canciones": [
        { "titulo": "Nombre de la canción", "autor": "Nombre del artista" }
      ]
    }
  ]
}
```

También se aceptan `title`/`artist` y el array `tracks`. Sonora intenta primero una coincidencia local exacta. Para lo que falta, busca por título y autor en el módulo 8SPINE activo, resuelve cada canción de forma secuencial y guarda su enlace en la playlist. Si una canción no aparece o falla, continúa con las siguientes y muestra un resumen al terminar. El archivo JSON original no se modifica.

## Publicación en Vercel

El proyecto incluye `vercel.json`: Vercel ejecutará `npm run build`, publicará `client/dist` y enviará las rutas de la SPA a `index.html`. Sin `/api`, Sonora activa automáticamente el modo navegador, incluida la importación privada de carpetas y catálogos JSON.

Vercel también puede ejecutar Express como una Function, pero la SQLite y los archivos del disco local no deben tratarse como almacenamiento persistente. Para conservar cuentas, tienda, historial compartido y subidas, migra esos datos a una base y un almacén de objetos persistentes o conecta `/api` a un backend externo.

Los audios, carátulas, JSON y subtítulos remotos deben servirse por HTTPS y responder con una cabecera CORS que permita el dominio de la aplicación.

## Tokens de reproducción

El coste medio de la biblioteca ronda 1,5 tokens por canción completa. Como referencia, escuchar entre 12 y 20 canciones al día supone aproximadamente entre 500 y 1.000 tokens al mes. La conversión simulada es de 1.000 tokens por unos 14 €; las escuchas parciales locales solo consumen la fracción reproducida. Cada reproducción iniciada desde un módulo 8SPINE tiene un cargo fijo de 0,18 €, equivalente a 12,86 tokens.

## Usuarios y permisos

En una base nueva, Sonora pide crear el primer perfil y le asigna el rol de administrador. Desde **Administración** puede crear o eliminar cuentas de oyente. Las rutas de escritura de la biblioteca también comprueban el rol en el servidor; ocultar un botón no es la única protección.

Para instalaciones automatizadas se puede activar `SONORA_SEED_DEFAULT_ADMIN=1` y definir `SONORA_ADMIN_EMAIL` y `SONORA_ADMIN_PASSWORD` antes del primer arranque. El panel de administración es el método recomendado para crear el resto de cuentas.

## Privacidad del checkout

El pago es una simulación local. No existe conexión con Stripe, PayPal ni ninguna pasarela. Las compras con Puntos nunca crean un perfil de pago; las compras en euros no descuentan Puntos. Si se usa el formulario de tarjeta, la base de datos solo conserva la marca y los últimos cuatro dígitos.

## Acceso desde otros dispositivos

Sonora admite acceso desde la red local y está preparada para publicarse detrás de una VPN o un proxy HTTPS. Las instrucciones de Firewall de Windows, Vodafone Station, CGNAT y las variables de configuración están en [docs/NETWORKING.md](docs/NETWORKING.md).
