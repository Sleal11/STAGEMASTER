# Vídeo de presentación · Score de Pádel

| Archivo | Para qué |
|---|---|
| `StageMaster-Score-Padel-con-voz.mp4` | Narración en español + música de fondo suave (baja sola cuando habla la voz). Para clientes, reuniones y la web |
| `StageMaster-Score-Padel-con-musica.mp4` | Solo música deportiva, sin voz: los rótulos explican cada paso. Para redes, ferias y pantallas del club |
| `GUION.md` | Guion audiovisual: escenas, textos y narración completa |

1920 × 1080 · 30 fps · H.264 + AAC. Las dos versiones tienen la misma imagen.

## Qué se ve

Todo es la aplicación **real** (estación, teléfono del árbitro y pantalla LED, grabados con
partidos de verdad del motor): introducción con la pista y la LED · el sistema · el marcador ·
configurar el partido · acceso del árbitro (QR y código) · el marcador en tiempo real
(puntos, saque, set, deshacer, pausa con publicidad) · las reglas (ventaja, punto de oro,
FIP 2026, tie break, súper tie break, final) · celebración, estadísticas e historial · cierre.

## Voz y música

- **Voz**: sintética en español (Piper, voz `es mls_10246`, gratuita y sin conexión). Se nota
  que es de ordenador. Para la versión definitiva: graba el texto de `GUION.md` (una escena por
  archivo) o genéralo con una voz IA (ElevenLabs…), guarda los archivos como
  `fuente/audio/escena-intro.wav`, `escena-sistema.wav`… y vuelve a generar: cada escena se
  alarga o acorta sola a la duración de la frase.
- **Música**: original, sintetizada para el vídeo (`fuente/musica.py`): 120 BPM, electrónica
  deportiva, sigue la energía de cada escena. Sin derechos de terceros.

## Regenerarlo (tras un cambio en la app)

```
node marketing/presentacion/fuente/capturar.js                         # capturas reales
python3 marketing/presentacion/fuente/voz.py <piper> <voz.onnx>        # narración (o tus archivos)
PYTHON=python3 node marketing/presentacion/fuente/generar.js           # música, imagen y mezcla
node marketing/presentacion/fuente/generar.js --revisar                # hoja de fotogramas
```

Requisitos: Playwright con Chromium, ffmpeg, Python 3 con numpy y scipy, y Piper
(`pip install piper-tts`) con una voz en español para la narración sintética.
