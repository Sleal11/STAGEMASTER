# Vídeos explicativos de StageMaster

1920 × 1080 · 30 fps · MP4 (H.264) · sin sonido.

| Vídeo | Duración | Contenido |
|---|---|---|
| `StageMaster-resumen-90s.mp4` | 90 s | Todo el sistema: estación, partido, QR + PIN, LED en tiempo real, cinta, publicidad en la pausa, salida, En vivo, portátil remoto e historial |
| `StageMaster-tutorial-1-estacion.mp4` | ≈ 1 min | La estación: crear un partido, reglas FIP, puntuar como respaldo, teléfono conectado, historial |
| `StageMaster-tutorial-2-arbitro.mp4` | ≈ 1 min | El árbitro: escanear el QR, PIN, botones, deshacer, LED al instante, pausa con publicidad |
| `StageMaster-tutorial-3-pantallas-y-publicidad.mp4` | ≈ 1 min | Marcador LED, cinta, lista de reproducción, publicidad automática, salida (brillo, formato, ajuste) y consejos |
| `StageMaster-tutorial-4-varias-pantallas-y-remoto.mp4` | ≈ 1 min | Añadir pantallas y espejos, En vivo, portátil remoto con su estación y seguridad |

## Volver a generarlos

Requisitos: Playwright con Chromium y ffmpeg.

```bash
node marketing/tutoriales/fuente/capturar.js          # capturas reales (nombres de ejemplo)
node marketing/tutoriales/fuente/generar.js           # los 5 vídeos (unos minutos)
node marketing/tutoriales/fuente/generar.js resumen   # solo uno
node marketing/tutoriales/fuente/generar.js --revisar resumen   # hoja de fotogramas para revisar
```

- `fuente/videos.js`: guiones (escenas, textos y tiempos). Aquí se cambian los textos.
- `fuente/motor.js` y `motor.css`: dispositivos, acercamientos, resaltados y estilo de marca.
- `fuente/capturar.js`: arranca StageMaster con datos de ejemplo y captura cada vista.
