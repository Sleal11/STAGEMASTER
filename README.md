# StageMaster · Marcador profesional de pádel

Marcador en tiempo real para pantallas de eventos deportivos. Un **portátil**
(estación operadora + servidor) administra **hasta dos partidos simultáneos**
y **una o dos pantallas externas** conectadas por cable. Cada partido lo
controla un **árbitro desde su teléfono**. Funciona **sin Internet**, en una
red Wi-Fi local.

```
 📱 Árbitro Pista 1 ─┐                         ┌─ HDMI ─► 📺 Pantalla 1 (score + publicidad)
                     ├─ Wi-Fi ─► 💻 Portátil ──┤
 📱 Árbitro Pista 2 ─┘          (servidor +    └─ HDMI ─► 📺 Pantalla 2 (score + publicidad)
                                 estación)
```

| Interfaz | Dónde | Dirección |
|---|---|---|
| Estación operadora | Portátil (solo localhost) | `http://localhost:3000/station.html` |
| Pantalla 1 / Pantalla 2 | Monitores externos del portátil | `http://localhost:3000/score.html?pantalla=1` (y `=2`) |
| Teléfono del árbitro | Teléfonos en la Wi-Fi local | `http://IP-DEL-PORTÁTIL:3000/control.html` |

---

## Instalación (una sola vez, con Internet)

1. Instalar **Node.js 18 o superior** (LTS): <https://nodejs.org>
2. En la carpeta del proyecto:
   ```bash
   npm install
   npm test
   ```
   `npm test` debe terminar con `Fallidas: 0` en los tres bloques.

Después **no hace falta Internet**: tipografías, logo, librerías y publicidad
están dentro del proyecto.

## Uso en el evento

1. Conectar las pantallas al portátil (Windows + P → **Extender**) y el
   portátil a la Wi-Fi del evento.
2. Doble clic en **`INICIAR-STAGEMASTER.bat`**: arranca el servidor, abre la
   **estación** en el portátil y las **pantallas** en modo kiosco (configurar
   al principio del archivo cuántas pantallas hay y su posición).
3. En la estación: **Configurar partido** en cada pista y comprobar con
   **Identificar** que cada pantalla está en su monitor.
4. Cada árbitro abre en su teléfono la dirección que muestra la estación,
   elige su pista e introduce el **PIN** de esa pista.

Alternativa manual: `npm start` y abrir las tres direcciones de la tabla.

Documentación:
- [`docs/MANUAL-OPERADOR.md`](docs/MANUAL-OPERADOR.md): estación operadora y teléfono del árbitro.
- [`docs/CHECKLIST-EVENTO.md`](docs/CHECKLIST-EVENTO.md): montaje del día y qué hacer ante cada problema.
- [`docs/SIMULACRO-EVENTO.md`](docs/SIMULACRO-EVENTO.md): prueba completa con el equipo real.
- [`docs/RED-Y-COMUNICACION.md`](docs/RED-Y-COMUNICACION.md): Wi-Fi vs Bluetooth, red sin Internet, sincronización y seguridad.

## Publicidad

Copiar los anuncios en `publicidad/banner/` (franja bajo el marcador) o
`publicidad/pantalla-completa/` (entre partidos o modo "Solo publicidad").
Imágenes PNG/JPG/WEBP/GIF/SVG y vídeos MP4/WEBM. Después, en la estación:
**Actualizar publicidad** y marcar los anuncios de cada pantalla.
Ver [`publicidad/LEEME.txt`](publicidad/LEEME.txt).

## Pruebas

| Comando | Qué prueba |
|---|---|
| `npm test` | Todo |
| `npm run test:engine` | Reglas del pádel (motor puro) |
| `npm run test:server` | Núcleo: partidos aislados, versiones, PIN/tokens, pantallas, publicidad, persistencia |
| `npm run test:integration` | Servidor real + estación + 2 teléfonos + 2 pantallas virtuales: aislamiento, partido equivocado, reasignación de pantallas, publicidad, desconexiones, reinicio del servidor, carga |
| `npm run simulate -- --match pista-2` | Operador virtual que juega un partido (ejecutar en el portátil) |

---

## Reglas implementadas (reglamento FIP 2026)

- Puntos 0 · 15 · 30 · 40 con tres sistemas al llegar a 40-40: **Ventaja**,
  **Punto de oro** y **Punto Estrella** (ventaja en el 1.er y 2.º 40-40,
  punto decisivo en el 3.º).
- **Set** a 1–6 games con 2 de diferencia; empate N-N → desempate.
- **Tie Break** a 7 y **Súper Tie Break** a 10, siempre con 2 de diferencia.
  El Súper Tie Break **sustituye al set decisivo**.
- **Saque** alterno; en el tie break, 1 punto y luego cada 2; el set siguiente
  lo empieza quien recibió primero.
- Partidos a 1, 3 o 5 sets. **Deshacer** revierte la última acción.

---

## Arquitectura

| Capa | Tecnología | Por qué |
|---|---|---|
| Frontend | HTML + CSS + JavaScript (sin frameworks) | Simple, sin compilación |
| Backend | Node.js + Express | Mismo lenguaje que el frontend |
| Tiempo real | Socket.IO sobre Wi-Fi local | Reconexión automática, salas por partido |
| Reglas | JavaScript puro (funciones puras) | Probables de forma aislada |
| Persistencia | Archivos JSON en `data/` | Sin base de datos que instalar |

### Conceptos

- **Partido (pista):** instancia de `Match` con estado, versión, archivo, PIN y
  teléfono propios. Hay dos (`pista-1`, `pista-2`); su número sale de una lista.
- **Pantalla:** ventana `score.html?pantalla=N`. **Independiente de los
  partidos**: dos pantallas pueden mostrar partidos distintos o el mismo.
  Cada una tiene modo (marcador / marcador + publicidad / solo publicidad) y
  su selección de anuncios.
- **Roles:** `station` (solo localhost), `controller` (teléfono vinculado a
  una pista con PIN → token) y `display` (solo lectura).

### Estructura

```
server/
├── index.js                 Arranque: HTTP, páginas, publicidad, consola
├── core/
│   ├── Match.js             Un partido: marcador, versión, protecciones, PIN, teléfono
│   ├── matchRegistry.js     Las pistas (instancias de Match)
│   ├── screens.js           Pantallas: partido asignado, modo, publicidad, presencia
│   ├── ads.js               Biblioteca de publicidad (carpeta publicidad/)
│   ├── auth.js              PIN, tokens, límite de intentos, localhost
│   ├── storage.js           Archivos JSON con escritura atómica
│   └── errors.js            Errores con código
├── realtime/
│   └── socketServer.js      Roles, permisos, salas por partido, difusión
└── sports/padel/
    ├── engine.js            MOTOR: reglas del pádel (funciones puras)
    └── config.js            Validación de la configuración del partido

public/
├── station.html · css/station.css · js/station.js   Estación operadora
├── score.html   · css/score.css   · js/score.js     Pantallas (score + publicidad)
├── control.html · css/control.css · js/control.js   Teléfono del árbitro
├── js/score-format.js       Textos del marcador (compartido por las tres)
├── js/brand.js              Logo
├── js/engine-browser.js     Copia del motor (solo para pruebas)
├── css/shared.css           Tokens de diseño, tipografías locales
├── fonts/ · img/

publicidad/                  Anuncios (banner/ y pantalla-completa/)
data/                        Partidos y pantallas guardados (se crea solo; no se versiona)
tools/simulate-match.js      Operador virtual
docs/                        Manuales, checklist, simulacro, red
```

### Flujo de una acción

```
Árbitro de la Pista 1 pulsa "PUNTO A"
 → control.js: sendRequest('matchAction', { matchId: 'pista-1', action: 'pointA', version })
 → socketServer: ¿teléfono vinculado a pista-1 con token válido? (si no: WRONG_MATCH / NOT_PAIRED)
 → Match.applyAction(): ¿versión actual? → engine.js → commit() → data/matches/pista-1.json
 → 'matchUpdate' SOLO a la sala match:pista-1 (su teléfono + las pantallas que la muestran)
 → 'stationState' a la estación
 → ack { ok: true } → el teléfono desbloquea sus botones
 → score.js dibuja y responde 'display:report' (versión dibujada → "Marcador al día")
```

### Protocolo Socket.IO

Conexión: `io({ auth: { role, screenId?, token? } })`.

| Evento (cliente → servidor) | Quién | Datos |
|---|---|---|
| `listCourts` | Todos | — |
| `pair` / `unpair` | Teléfono | `{ matchId, pin, deviceName, force }` |
| `setupMatch` | Teléfono vinculado / estación | `{ matchId, config, force }` |
| `matchAction` | Teléfono vinculado / estación | `{ matchId, action, version }` (`pointA`, `pointB`, `undo`, `changeServer`, `finishMatch`) |
| `resetMatch` | Teléfono vinculado / estación | `{ matchId, version }` |
| `station:updateScreen` | Estación | `{ screenId, changes: { matchId, mode, ads, adInterval } }` |
| `station:newPin` / `station:unpair` | Estación | `{ matchId }` |
| `station:identify` | Estación | `{ screenId }` |
| `station:refreshAds` | Estación | — |
| `display:report` | Pantalla | `{ viewport, renderedMatchId, renderedVersion, adErrors }` |

Todas responden `{ ok: true, ... }` o `{ ok: false, code, message }`.
Códigos: ver `server/core/errors.js`.

| Evento (servidor → cliente) | A quién |
|---|---|
| `matchUpdate { matchId, state }` | Sala del partido |
| `screenConfig` / `identify` | Ventanas de esa pantalla |
| `controllerSession` / `controllerRevoked` | Teléfono |
| `stationState` | Estación |

### Añadir otro deporte

1. Crear `server/sports/<deporte>/engine.js` (`createMatch`, `applyAction`) y su `config.js`.
2. Hacer que `Match.js` elija el motor según el deporte de la pista.
3. Crear la vista de pantalla de ese deporte.

Partidos, pantallas, publicidad, permisos, persistencia y sincronización se reutilizan tal cual.

---

## Licencias de terceros

Tipografías **Inter** y **Oswald**: SIL Open Font License 1.1 (`public/fonts/LICENSE-*.txt`).
