# Recomendador contextual de Sonora

## Principio

El motor no utiliza artista, álbum, género, título ni etiquetas como fuente de afinidad. Esos campos solo se emplean para presentar la canción y para evitar fatiga inmediata de un mismo artista.

La recomendación se basa en dos fuentes locales:

1. La firma sonora obtenida directamente del audio.
2. El comportamiento observado durante las sesiones.

## Firma de audio v2

Cada pista se analiza en seis posiciones distribuidas entre el inicio y el final. En cada zona se muestrean varias ventanas y se extraen:

- RMS y variación de energía.
- Centroide, dispersión y rolloff espectral.
- Flatness, sharpness y cruces por cero.
- Ocho coeficientes MFCC normalizados.
- Distribución cromática de doce clases.
- Tempo, evolución de energía y posición del clímax.

Las zonas producen embeddings parciales de 28 dimensiones. Su agregación, tempo y estructura forman un embedding global normalizado de 32 dimensiones.

Los embeddings y sus resúmenes se guardan en `track_audio_profiles`. El campo `analysis_version` permite recalcular la biblioteca si cambia el modelo.

## Memoria de gusto v3

Los eventos tienen pesos diferentes:

| Evento | Efecto |
| --- | ---: |
| Favorito | +3,0 |
| Añadir a playlist | +2,4 |
| Repetición voluntaria | +2,0 |
| Canción completada | +1,2 |
| Reproducción desde búsqueda | +1,1 |
| Salto temprano | −2,2 |
| Retirar de la cola | −1,4 |
| Salto tardío | −0,7 |

Se mantienen vectores positivos y negativos independientes para:

- Preferencia general.
- Preferencia reciente.
- Franja horaria.
- Intención de escucha.

El perfil reciente tiene una vida media de 14 días. Los perfiles de contexto tienen una vida media de 120 días. El perfil general conserva el gusto histórico.

Además del centro de cada perfil, v3 conserva hasta 18 anclas positivas y 12 negativas derivadas de canciones concretas. Para puntuar una candidata combina su cercanía al perfil general con sus tres vecinos de gusto más próximos. Así puede reconocer varios grupos de preferencia distintos —por ejemplo, música tranquila y música enérgica— sin convertirlos en un promedio artificial.

## Ranking

Cada candidata recibe valores normalizados:

- Afinidad con el perfil positivo menos proximidad al perfil negativo.
- Ajuste al contexto e intención.
- Compatibilidad entre el final de la pista anterior y el comienzo de la candidata.
- Novedad respecto al gusto conocido y las últimas pistas elegidas.
- Valor de exploración mediante un bandit UCB.
- Exposición reciente.
- Riesgo de salto.
- Penalización por similitud excesiva, exposición reciente y fatiga de artista o álbum durante las últimas 32 escuchas.

Los saltos tempranos pesan más que los tardíos. Las repeticiones voluntarias, favoritos, canciones completas y adiciones a playlists elevan la confianza en una región sonora concreta.

La secuencia se construye canción por canción. En cada posición cambia el objetivo de energía para formar un arco de entrada, desarrollo, punto alto y cierre.

## Exploración adaptativa

Las sesiones normales reservan aproximadamente un 15 % del ranking a exploración. La intención `Descubrir` eleva el valor al 34 %.

Tras un primer salto temprano, la exploración baja de forma suave. Con dos saltos entra en modo de recuperación; con tres o más se vuelve muy conservadora hasta que la sesión se estabiliza.

Después de dos saltos consecutivos:

- La exploración de una sesión normal baja al 6 %.
- La exploración de `Descubrir` baja al 18 %.
- El servidor vuelve a secuenciar el resto de la cola desde la pista actual.

La música ya escuchada permanece en la cola; solo se sustituye el futuro de la sesión.

## Cold start

Sin historial suficiente, la afinidad personal pierde peso y el sistema busca pistas representativas que cubran regiones sonoras distintas. Favoritos, reproducciones completas y canciones que ya estaban en playlists permiten abandonar rápidamente este modo.

## Explicaciones

Cada decisión guarda:

- Puntuación total.
- Desglose de señales.
- Dos razones como máximo.
- Posición de la canción.
- Resultado posterior: aceptada o saltada.

Las razones se generan antes de reproducir y solo aparecen cuando la señal correspondiente supera un umbral real.

## Evaluación local

`GET /api/recommendations/metrics` devuelve:

- Aceptación por algoritmo.
- Saltos durante los primeros 30 segundos.
- Finalizaciones.
- Descubrimientos aceptados.
- Novedad y calidad media de transición.

El endpoint de sesiones acepta `"algorithm": "legacy"` para ejecutar la antigua línea base por mood. Esto permite comparar `legacy-mood-v1` con `sonora-context-v3` sin enviar telemetría fuera del ordenador.
