# StageMaster en una página

**Marcador profesional de pádel para pantallas LED.** Un `.exe` para Windows (no se
instala) que convierte un portátil en la central del evento. Funciona **sin Internet**.
Versión **2.10.0**.

## Las 4 piezas

| Pieza | Qué hace |
|---|---|
| 💻 **Estación** (portátil) | El operador crea los partidos, elige qué muestra cada pantalla, sube la publicidad y ve el historial (al instante). Zonas de pistas y de pantallas bien separadas; lo que no se usa se minimiza |
| 📱 **Teléfono del árbitro** | Escanea el QR único, escribe el código de su pista y puntúa con botones grandes. Sin instalar nada |
| 📺 **Pantallas LED** (hasta 8) | Marcador legible de lejos con SET POINT y MATCH POINT, cinta de patrocinadores (logos legibles con realce automático o contorno, en el orden y tamaño que elijas, con tiradores como en Word), imágenes y vídeos; publicidad automática en la pausa y al terminar; celebración de los ganadores y estadísticas animadas |
| 💻 **Portátil remoto** | Para pistas lejos: muestra pantallas por la red y abre la estación del principal para controlar a la vez |

## Cómo se usa (en 5 pasos)

1. Conecta las LED al portátil (**Windows + P → Extender**) y el portátil a la red del evento.
2. Abre `StageMaster.exe`: se abren la estación y las pantallas.
3. En cada pista, **Nuevo partido…**: parejas, sets y reglas FIP (ventaja, punto de oro o FIP 2026).
4. El árbitro **escanea el QR** con su teléfono y escribe el **código de su pista**: cada punto llega a la LED al instante.
5. En cada pantalla elige **Marcador** o **Publicidad y vídeos**; en **Salida**, el monitor,
   el formato LED, el brillo y que la publicidad **llene toda la LED**.

## Lo importante

- **Fiable**: los puntos nunca se duplican; si se corta la red, las pantallas mantienen la
  imagen y todo se reconecta solo; un corte de luz no pierde nada.
- **Seguro**: el teléfono necesita el código de su pista; otro portátil necesita el código
  de enlace, y el principal puede desvincularlo al instante.
- **Para que se vea perfecto**: monitor a **1920 × 1080 · 60 Hz**; publicidad en **2:1**
  (832 × 416 o 1664 × 832) y vídeos **MP4 (H.264)**.

## Dónde está cada cosa

| Necesito… | Archivo |
|---|---|
| El programa (prueba) | `releases/download/prueba/StageMaster-prueba.exe` (o `.zip`) |
| Ver cómo se usa | `marketing/tutoriales/` (vídeo de 90 s y 4 tutoriales) |
| Vídeo de marca para las LED | `marketing/videos-led/` |
| Ayuda para el cliente | Botón **Ayuda** en la estación |
| Preparar un evento | `docs/CHECKLIST-EVENTO.md` y `docs/SIMULACRO-EVENTO.md` |
| El informe completo | `docs/INFORME-PROYECTO.md` |
| Desarrollar | `README.md` |
