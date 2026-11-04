# Vídeos de StageMaster para pantallas LED

Vídeo promocional de 15 s (en bucle, sin sonido) en proporción **2:1**:

| Archivo | Tamaño | Uso |
|---|---|---|
| `StageMaster-LED-832x416.mp4` | 832 × 416 | LED 832 × 416 (píxeles exactos) |
| `StageMaster-LED-1664x832-HD.mp4` | 1664 × 832 | LED más grandes o monitores |

Para usarlo: en la estación, **Lista de reproducción → Subir archivos…**, y en
**Salida → Publicidad: Automático**.

Diseño para LED: letras grandes y gruesas, alto contraste (amarillo / blanco sobre
índigo), sin líneas finas; MP4 H.264, 30 fps.

Para cambiar textos o escenas: editar `fuente/promo.html` (función `render(t)`)
y ejecutar `node marketing/videos-led/fuente/generar.js` (necesita Playwright y ffmpeg).
Estos vídeos no van dentro del .exe.
