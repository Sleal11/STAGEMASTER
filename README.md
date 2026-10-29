# StageMaster · Marcador profesional de pádel

Aplicación para Windows que convierte un **portátil** en la estación de un
evento de pádel: **hasta 2 partidos simultáneos**, **1 o 2 pantallas**
(monitores o pantallas LED de **832×416** y **416×208**) con marcador, cinta
publicitaria y vídeos, y un **teléfono de árbitro** por partido. Funciona
**sin Internet**: solo necesita una red Wi-Fi para los teléfonos.

```
 📱 Árbitro Pista 1 ─┐                         ┌─ cable ─► 📺 Pantalla 1 (LED / monitor)
                     ├─ Wi-Fi ─► 💻 StageMaster ┤
 📱 Árbitro Pista 2 ─┘          (portátil)      └─ cable ─► 📺 Pantalla 2 (LED / monitor)
```

---

## Para el cliente: usar StageMaster

1. Descargar la última versión desde
   **[Releases](https://github.com/Sleal11/STAGEMASTER/releases/latest)**
   (`StageMaster-<versión>.exe`, en *Assets*) y copiarla al portátil (no se instala nada).
2. Conectar las pantallas y conectar el portátil a la Wi-Fi del evento.
3. Doble clic en el `.exe`. Se abren solas la **estación** (en el portátil) y
   las **pantallas** (en los monitores externos).
   - La primera vez, Windows puede avisar *"Windows protegió su PC"*:
     **Más información → Ejecutar de todas formas** (el `.exe` no está firmado).
   - Si pregunta por el **Firewall**: **Permitir** (redes privadas).
4. Todo lo demás se explica en el botón **Ayuda** de la estación.

| Dónde | Qué guarda |
|---|---|
| `%APPDATA%\StageMaster\datos` | Partidos, PIN, teléfonos vinculados, pantallas (se recuperan al reabrir) |
| `Documentos\StageMaster\Publicidad` | Publicidad (botón **Carpeta de publicidad**): `banner\` para la cinta, `pantalla-completa\` para imágenes y vídeos |

### Qué puede hacer el moderador

| Función | Dónde |
|---|---|
| Configurar, **pausar/reanudar**, finalizar y reiniciar cada partido; puntuar como respaldo | Tarjeta de cada pista |
| QR + PIN para el teléfono del árbitro; desvincular | Tarjeta de cada pista |
| **Marcador** o **Publicidad y vídeos** (reproductor: pausar, reanudar, detener) | Tarjeta de cada pantalla |
| **Cinta publicitaria**: imágenes/logos y mensajes, fundido o desplazamiento continuo | Pestaña *Cinta* |
| **Lista de reproducción**: imágenes y vídeos MP4/WEBM en bucle, con o sin sonido | Pestaña *Lista de reproducción* |
| **Publicidad al terminar el partido** (activable, tras X s de resultado) | Pestaña *Contenido* |
| **Formato de salida**: monitor completo, LED XL 832×416 o LED pequeño 416×208 (píxeles exactos, con posición) | Pestaña *Salida* |

## Para desarrollo

Requisitos: **Node.js 18+**.

```bash
npm install          # dependencias (incluye Electron para la aplicación)
npm test             # todas las pruebas
npm run app          # abrir la aplicación de escritorio
npm start            # solo el servidor (páginas en el navegador: http://localhost:3000)
npm run dist:win     # generar dist/StageMaster-<versión>.exe
npm run simulate -- --match pista-1   # operador virtual que juega un partido
```

**Obtener el `.exe` sin compilar nada:** GitHub lo compila en Windows con cada
cambio (`.github/workflows/stagemaster-windows.yml`). Pestaña **Actions** →
última ejecución de *"StageMaster para Windows"* → **Artifacts** →
`StageMaster-Windows`.

**Publicar una versión nueva para el cliente:** subir `version` en
`package.json`, fusionar en `main` y crear la etiqueta `v<versión>` (ej.
`v2.1.0`) sobre ese commit. GitHub compila el `.exe` y lo publica en
**Releases**, cuyo enlace `releases/latest` siempre apunta a la última.

### Pruebas

| Comando | Qué prueba |
|---|---|
| `npm run test:engine` | Reglas del pádel (motor puro) y 4000 acciones aleatorias |
| `npm run test:server` | Partidos, versiones, pausa, PIN/tokens, pantallas, cinta, lista de reproducción, publicidad al terminar, formatos LED, migración |
| `npm run test:desktop` | Qué pantalla va en qué monitor (conectar/desconectar monitores) |
| `npm run test:integration` | Servidor real + estación + 2 teléfonos + 2 pantallas virtuales: reproductor, publicidad final (una sola vez), vídeo por rangos, QR, escritorio |

---

## Reglas implementadas (reglamento FIP 2026)

- Puntos 0 · 15 · 30 · 40 con **Ventaja**, **Punto de oro** o **Punto Estrella**
  (ventaja en el 1.er y 2.º 40-40; en el 3.º, punto decisivo, que la pantalla
  anuncia como **PUNTO DE ORO**).
- Sets de 1–6 games con 2 de diferencia; **Tie Break** a 7 y **Súper Tie Break**
  a 10 (sustituye al set decisivo), siempre con 2 de diferencia.
- Saque alterno; en el tie break, 1 punto y luego cada 2.
- Partidos a 1, 3 o 5 sets. **Deshacer** revierte la última acción.

## Arquitectura

| Capa | Tecnología |
|---|---|
| Aplicación de escritorio | Electron (servidor + ventanas en un solo `.exe`) |
| Interfaces | HTML + CSS + JavaScript (módulos ES, sin frameworks) |
| Servidor | Node.js + Express |
| Tiempo real | Socket.IO sobre Wi-Fi local, una sala por partido |
| Reglas | JavaScript puro (funciones puras) |
| Persistencia | Archivos JSON |

```
desktop/
├── main.js              Aplicación: arranca el servidor, abre estación y pantallas, monitores
└── monitors.js          Qué pantalla va en qué monitor (lógica pura, probada)
server/
├── index.js             startServer(): HTTP, páginas, publicidad
├── core/
│   ├── Match.js         Un partido: marcador, versión, pausa, protecciones, PIN, teléfono
│   ├── matchRegistry.js Las pistas (instancias de Match)
│   ├── screenConfig.js  Configuración de una pantalla: valores, límites, validación, migración
│   ├── screens.js       Pantallas: guardado, reproductor, publicidad al terminar, presencia
│   ├── ads.js           Biblioteca de publicidad (imágenes y vídeos)
│   ├── auth.js          PIN, tokens, límite de intentos, solo-localhost
│   ├── network.js       Dirección para los teléfonos y códigos QR
│   ├── storage.js       Archivos JSON con escritura atómica
│   └── errors.js        Errores con código
├── realtime/socketServer.js   Roles, permisos, salas por partido, difusión
└── sports/padel/              engine.js (motor) · config.js (validación)
public/
├── station.html · js/station/   Estación: main, context, dialogs, matches, screens
├── score.html   · js/display/   Pantalla: main (capas y salida LED), scoreboard,
│                                ribbon (cinta), media-player (imágenes y vídeos)
├── control.html · js/control.js Teléfono del árbitro
├── js/common/                   score-format, brand (logo), ui (iconos, utilidades)
├── img/icons.svg                Iconos SVG (sprite)
└── ayuda.html                   Ayuda para el cliente
publicidad/              Ejemplos (imagen y vídeo 2:1, cinta) que se copian a Documentos la primera vez
build/                   Iconos del .exe y logo original (fuente de diseño)
```

**Roles:** estación (solo en el portátil), pantalla (solo en el portátil, solo
lectura) y teléfono (vinculado a UNA pista con PIN → token). Cada actualización
de un partido se envía solo a la sala de ese partido. La publicidad nunca
modifica el marcador: el servidor solo avisa a las pantallas cuando un partido
termina o vuelve a jugarse. Detalles de red, sincronización y seguridad:
[`docs/RED-Y-COMUNICACION.md`](docs/RED-Y-COMUNICACION.md).

**Protocolo Socket.IO:** documentado al principio de `server/realtime/socketServer.js`.

**Añadir otro deporte:** crear `server/sports/<deporte>/engine.js` y `config.js`,
hacer que `Match.js` elija el motor según el deporte y crear su vista de pantalla.

## Documentación

- [`docs/CHECKLIST-EVENTO.md`](docs/CHECKLIST-EVENTO.md) — día del evento.
- [`docs/SIMULACRO-EVENTO.md`](docs/SIMULACRO-EVENTO.md) — prueba completa con el equipo real.
- [`docs/RED-Y-COMUNICACION.md`](docs/RED-Y-COMUNICACION.md) — Wi-Fi vs Bluetooth, red, sincronización, seguridad.

Tipografías **Inter** y **Oswald**: SIL Open Font License 1.1 (`public/fonts/LICENSE-*.txt`).
Iconos basados en **Lucide** (licencia ISC).
