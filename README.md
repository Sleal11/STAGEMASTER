# StageMaster · Marcador profesional de pádel

Marcador en tiempo real para pantallas LED en eventos deportivos.
El operador lleva el partido desde un **iPhone** y la **pantalla LED** se
actualiza al instante. Funciona **sin Internet**, dentro de una red local.

```
 iPhone (control.html) ──Wi-Fi──► Servidor (PC) ──► Pantalla LED (score.html)
```

| Interfaz | Dispositivo | Dirección |
|---|---|---|
| Panel de control | iPhone del operador | `http://IP-DEL-PC:3000/control.html` |
| Pantalla LED | PC conectado a la LED | `http://localhost:3000/score.html` |

---

## Instalación (una sola vez, con Internet)

1. Instalar **Node.js 18 o superior** (versión LTS): <https://nodejs.org>
2. En la carpeta del proyecto:
   ```bash
   npm install
   npm test
   ```
   `npm test` debe terminar con `Fallidas: 0` en los tres bloques de pruebas.

A partir de aquí **no hace falta Internet**: tipografías, logo y librerías
están dentro del proyecto.

## Uso en el evento

**Opción rápida (Windows):** doble clic en **`INICIAR-STAGEMASTER.bat`**.
Arranca el servidor y abre la pantalla LED en modo kiosco (pantalla completa,
sin barras). En la ventana "SERVIDOR" aparece la dirección para el iPhone.

**Opción manual:**
```bash
npm start
```
Luego abrir la LED en Chrome/Edge (`http://localhost:3000/score.html`, F11)
y el panel en el iPhone con la dirección que muestra la consola.

Documentación para el evento:
- [`docs/MANUAL-OPERADOR.md`](docs/MANUAL-OPERADOR.md): guía del operador del iPhone.
- [`docs/CHECKLIST-EVENTO.md`](docs/CHECKLIST-EVENTO.md): montaje del día y qué hacer ante cada problema.
- [`docs/SIMULACRO-EVENTO.md`](docs/SIMULACRO-EVENTO.md): prueba completa con el equipo real antes de un evento.

## Pruebas

| Comando | Qué prueba |
|---|---|
| `npm test` | Todo (motor + servidor + integración) |
| `npm run test:engine` | Reglas del pádel (motor puro) |
| `npm run test:server` | Validación, versiones, persistencia |
| `npm run test:integration` | Servidor real + dispositivos virtuales: partido completo, doble toque, dos operadores, reconexión, reinicio del servidor, carga |
| `npm run simulate` | Operador virtual que juega un partido contra el servidor (ver `tools/simulate-match.js`) |

---

## Reglas implementadas (reglamento FIP 2026)

- Puntos 0 · 15 · 30 · 40, con tres sistemas al llegar a 40-40:
  - **Ventaja**: hay que ganar dos puntos seguidos.
  - **Punto de oro**: el siguiente punto gana el game.
  - **Punto Estrella** (FIP 2026): ventaja en el 1.er y 2.º 40-40, punto decisivo en el 3.º.
- **Set**: se gana con los games configurados (1–6) y 2 de diferencia; empate a N-N → desempate.
- **Tie Break** a 7 con 2 de diferencia (sin límite: 7-6 no termina, 8-6 sí).
  El set se registra como 7-6 (8-6).
- **Súper Tie Break** a 10 con 2 de diferencia: **sustituye al set decisivo**
  (1-1 en best-of-3, 2-2 en best-of-5). En partidos a 1 set se juega a 6-6.
- **Sin desempate**: el set decisivo continúa hasta 2 games de diferencia.
- **Saque**: alterna cada game; en el tie break, 1 punto y luego cada 2. El set
  siguiente lo empieza quien recibió primero en el tie break.
- **Partido**: best-of-1, 3 o 5 sets (número impar).
- **Deshacer** revierte la última acción (punto, cambio de saque o finalizar).

---

## Arquitectura

| Capa | Tecnología | Por qué |
|---|---|---|
| Frontend | HTML + CSS + JavaScript (sin frameworks) | Simple, sin compilación, fácil de entender |
| Backend | Node.js + Express | Mismo lenguaje que el frontend |
| Tiempo real | Socket.IO | Reconexión automática, funciona en red local |
| Reglas | JavaScript puro (funciones puras) | Probables de forma aislada |
| Persistencia | Archivo JSON (`data/match.json`) | Sin base de datos que instalar |

### Responsabilidades

```
server/
├── index.js               Comunicación: Express + Socket.IO, ack, /health
├── matchManager.js        Partido activo: versión, protecciones, estado público
├── storage.js             Guarda y recupera el partido en disco
└── sports/
    └── padel/
        ├── config.js      Valida la configuración del partido
        └── engine.js      MOTOR: reglas del pádel (funciones puras)

public/
├── control.html / css/control.css / js/control.js   Panel del iPhone
├── score.html   / css/score.css   / js/score.js     Pantalla LED (solo presentación)
├── css/shared.css         Tokens de diseño, tipografías locales, logo
├── js/brand.js            Muestra el logo si existe img/logo-stagemaster.png
├── js/engine-browser.js   Copia del motor para el navegador (solo pruebas)
├── fonts/                 Inter y Oswald (licencia SIL OFL)
└── img/                   Logo

tools/simulate-match.js    Operador virtual (pruebas)
docs/                      Manual del operador, checklist y simulacro
data/                      Partido guardado (se crea solo; no se versiona)
```

### Flujo de una acción

```
Operador pulsa "PUNTO A"
 → control.js: sendRequest('pointA', { version })     (bloquea nuevos toques)
 → index.js:   handleRequest → matchManager.action('pointA', version)
 → matchManager: ¿versión actual? → engine.applyAction() → commit()
                 (nueva versión + guardado en data/match.json)
 → io.emit('matchUpdate', estadoPúblico)               → todos los dispositivos
 → ack({ ok: true })                                    → el iPhone desbloquea
 → score.js: renderScore() + animaciones               (pantalla LED)
```

### Protocolo Socket.IO

| Evento (cliente → servidor) | Datos | Respuesta (ack) |
|---|---|---|
| `setupMatch` | `{ config, force }` | `{ ok }` o `{ ok:false, code, message, state }` |
| `pointA` `pointB` `undo` `changeServer` `finishMatch` | `{ version }` | ídem |
| `resetMatch` | `{ version }` | ídem |

Códigos de error: `INVALID_CONFIG`, `MATCH_IN_PROGRESS`, `STALE_VERSION`, `NO_MATCH`.

| Evento (servidor → clientes) | Datos |
|---|---|
| `matchUpdate` | Estado público del partido, o `null` si no hay partido. Se envía también al conectar. |
| `serverConnected` / `clientsCount` | Número de dispositivos conectados |

### Estado público del partido

```javascript
{
  config:    { sport: 'padel', gamesPerSet, totalSets, setsToWin, scoringSystem, tiebreakType, initialServer },
  players:   { A: { name, points, games, sets }, B: { ... } },  // points: 0|15|30|40|'AD' o 0,1,2… en tie break
  currentSet, server: 'A'|'B', status: 'playing'|'finished', winner: null|'A'|'B',
  phase:     'normal'|'tiebreak'|'superTiebreak',
  setScores: [{ A: 6, B: 3 }, { A: 7, B: 6, tiebreak: { A: 8, B: 6 } }, { A: 1, B: 0, tiebreak: {...}, superTiebreak: true }],
  deuceCount, decisivePoint,          // Punto Estrella / punto decisivo
  version, canUndo                    // añadidos por el servidor
}
```

### Protecciones

- **Doble pulsación y dos operadores**: cada acción lleva la versión del marcador
  que veía el operador; si ya cambió, se rechaza (`STALE_VERSION`).
- **Partido en curso**: iniciar otro exige confirmación (`force`).
- **Datos inválidos**: el servidor valida la configuración (`config.js`).
- **Desconexiones**: Socket.IO reconecta solo y el servidor reenvía el estado.
  Sin conexión, el panel no envía acciones (evita puntos "tardíos").
- **Reinicio del servidor o corte de luz**: el partido se recupera de
  `data/match.json` (escritura atómica), con historial para deshacer.

### Añadir otro deporte

1. Crear `server/sports/<deporte>/engine.js` con `createMatch(config)` y
   `applyAction(state, action)` (funciones puras) y su `config.js`.
2. Hacer que `matchManager.js` elija el motor según `config.sport`.
3. Crear la vista de la LED de ese deporte.

El protocolo, la persistencia, las versiones y las protecciones se reutilizan tal cual.

---

## Licencias de terceros

Tipografías **Inter** y **Oswald**: SIL Open Font License 1.1 (`public/fonts/LICENSE-*.txt`).
