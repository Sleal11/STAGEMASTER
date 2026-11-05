# StageMaster · Marcador profesional de pádel

Aplicación para Windows que convierte un **portátil** en la estación de un
evento de pádel: **2 partidos simultáneos**, **hasta 8 pantallas** (monitores
o pantallas LED de **832×416**, **416×208** o tamaño personalizado), también
en **otros portátiles** de la red, con marcador, cinta publicitaria y vídeos,
**historial de partidos** y un **teléfono de árbitro** por partido. Funciona
**sin Internet**: solo necesita una red local para los teléfonos y portátiles.

> **En una página:** [`RESUMEN.md`](RESUMEN.md) · **Informe completo:** [`docs/INFORME-PROYECTO.md`](docs/INFORME-PROYECTO.md)
> · **Vídeos de cómo se usa:** [`marketing/tutoriales/`](marketing/tutoriales/)

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
   - Si el navegador **no deja descargar** el `.exe`, descarga el **.zip** (lleva
     instrucciones dentro). Todas las soluciones: [`docs/DESCARGA-Y-SEGURIDAD.md`](docs/DESCARGA-Y-SEGURIDAD.md).
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
| QR único de acceso para los árbitros + código de cada pista (nuevo código, desvincular) | Arriba de los partidos · tarjeta de cada pista |
| **Final del partido**: celebración de los ganadores y resumen con estadísticas (pantalla, teléfono e historial) | Automático |
| **Marcador** o **Publicidad y vídeos** (reproductor: pausar, reanudar, detener) | Tarjeta de cada pantalla |
| **Cinta publicitaria**: imágenes, logos, vídeos cortos y mensajes, fundido o desplazamiento continuo | Pestaña *Cinta* |
| **Lista de reproducción**: imágenes y vídeos MP4/WEBM en bucle, con o sin sonido | Pestaña *Lista de reproducción* |
| **Subir fotos y vídeos** (botón o arrastrar desde el Explorador) y borrarlos | Pestañas *Cinta* y *Lista de reproducción* |
| **Publicidad al terminar el partido** (activable, tras X s de resultado) y **en la pausa** (vuelve al marcador al reanudar) | Pestaña *Contenido* |
| **Añadir / quitar pantallas** (hasta 8) y **espejos** (igual que otra pantalla, con salida propia) | Sección *Pantallas* · pestaña *Contenido* |
| **Formato de salida**: monitor completo o **personalizado** con el tamaño exacto de la LED (ej. 832×416, 416×208; guardable con nombre), con posición; **brillo de la imagen** | Pestaña *Salida* |
| **Diagnóstico del monitor** (px reales, Hz, escalado) y **cambiar su resolución** con vuelta automática (Windows) | Pestaña *Salida* |
| **Portátiles remotos**: pantallas en otro portátil por la red (código de enlace) y la estación del moderador desde ese portátil | Sección *Portátiles remotos* |
| **Historial de partidos**: buscar por día, rango, pista o jugador; detalle; exportar CSV | Pestaña *Historial* |
| **En vivo**: vista previa en movimiento de todas las pantallas y su estado real; aviso si alguna no se ve | Pestaña *En vivo* |

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
cambio (`.github/workflows/stagemaster-windows.yml`) y lo publica como
**versión de prueba**, siempre en el mismo enlace (sin iniciar sesión):
**https://github.com/Sleal11/STAGEMASTER/releases/download/prueba/StageMaster-prueba.exe**.
Es una *pre-release*: el enlace del cliente (`releases/latest`) no cambia.
También queda en **Actions** → la ejecución → **Artifacts** → `StageMaster-Windows`.

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
| `npm run test:integration` | Servidor real + estación + 2 teléfonos + pantallas virtuales: reproductor, publicidad final y en la pausa, historial, varias pantallas y espejos, portátil remoto por la IP de red, resoluciones, QR, escritorio |
| `node desktop/displayModes.win.test.js` | Resoluciones de Windows en un Windows real (se ejecuta en GitHub Actions) |
| `npm run test:e2e` | Navegador y aplicación de escritorio reales (Playwright + Electron): historial, pausa, brillo, pantallas/espejos, formatos, detalles de la estación (diálogo de resolución, avisos), pestaña En vivo, matriz visual 4 formatos × 6 estados, partido completo desde el teléfono, modo principal y portátil remoto. Requiere Chromium de Playwright y `node node_modules/electron/install.js`; en Linux sin escritorio, Xvfb |

---

## Reglas implementadas (reglamento FIP 2026)

- Puntos 0 · 15 · 30 · 40 con **Ventaja**, **Punto de oro** o **FIP 2026**
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
├── main.js              Modo principal: servidor, estación, pantallas, resolución de monitores
├── remote.js · remote/  Modo «pantalla remota»: enlace con el principal y ventana de control
├── screenWindows.js     Ventanas de las pantallas en los monitores (común a los dos modos)
├── monitors.js          Qué pantalla va en qué monitor (lógica pura, probada)
├── displayModes.js      Resoluciones reales de Windows (EnumDisplaySettings / ChangeDisplaySettingsEx)
├── firewall.js          «Permitir teléfonos»: reglas del firewall de Windows solo para la red local
└── mode.js              Modo de este portátil (principal / remoto)
server/
├── index.js             startServer(): HTTP, páginas, publicidad
├── core/
│   ├── Match.js         Un partido: marcador, versión, pausa, protecciones, PIN, teléfono
│   ├── matchRegistry.js Las pistas (instancias de Match)
│   ├── screenConfig.js  Configuración de una pantalla: valores, límites, validación, migración
│   ├── screens.js       Pantallas: lista dinámica, espejos, reproductor, publicidad automática, presencia
│   ├── history.js       Historial de partidos terminados (archivo JSONL, sin duplicados)
│   ├── formats.js       Formatos de salida guardados por el operador
│   ├── remotes.js       Portátiles remotos enlazados (código, tokens)
│   ├── discovery.js     Anuncio UDP para encontrar el portátil principal en la red
│   ├── ads.js           Biblioteca de publicidad (imágenes y vídeos, nombres seguros)
│   ├── auth.js          PIN, tokens, límite de intentos, solo-localhost
│   ├── network.js       Dirección para los teléfonos y códigos QR
│   ├── storage.js       Archivos JSON con escritura atómica
│   └── errors.js        Errores con código
├── http/adsApi.js     Subir y borrar publicidad (estación del principal o de un portátil enlazado)
├── realtime/socketServer.js   Roles, permisos, salas por partido, difusión
└── sports/padel/              engine.js (motor) · config.js (validación)
public/
├── station.html · js/station/   Estación: main, context, dialogs, matches, screens, uploads,
│                                remotes (portátiles), live (En vivo), history (Historial)
├── score.html   · js/display/   Pantalla: main (capas y salida LED), scoreboard,
│                                ribbon (cinta), media-player (imágenes y vídeos), logo-cleaner
├── control.html · js/control.js Teléfono del árbitro
├── js/common/                   score-format, brand (logo), ui (iconos, utilidades)
├── img/icons.svg                Iconos SVG (sprite)
└── ayuda.html                   Ayuda para el cliente
publicidad/              Ejemplos (imagen y vídeo 2:1, cinta) que se copian a Documentos la primera vez
tests/e2e/               Pruebas con navegador y aplicación de escritorio reales
tools/                   simulate-match.js (operador virtual)
marketing/               Vídeo de marca para las LED y vídeos explicativos (con su fuente)
docs/                    Guías (índice en docs/README.md); docs/desarrollo/: historial del desarrollo
build/                   Iconos del .exe, logo original y texto del .zip
```

**Roles:** estación (en el portátil principal, o en un portátil remoto enlazado
con su token: todo salvo enlazar/desvincular portátiles y el hardware del
principal), pantalla (solo lectura; en el portátil o en un portátil remoto
enlazado con código → token), portátil remoto (muestra pantallas y abre la
estación del principal) y teléfono (QR único → código de pista → token de UNA pista). Cada actualización
de un partido se envía solo a la sala de ese partido. La publicidad nunca
modifica el marcador: el servidor solo avisa a las pantallas cuando un partido
termina o vuelve a jugarse. Detalles de red, sincronización y seguridad:
[`docs/RED-Y-COMUNICACION.md`](docs/RED-Y-COMUNICACION.md).

**Protocolo Socket.IO:** documentado al principio de `server/realtime/socketServer.js`.

**Añadir otro deporte:** crear `server/sports/<deporte>/engine.js` y `config.js`,
hacer que `Match.js` elija el motor según el deporte y crear su vista de pantalla.

## Documentación

Índice completo: [`docs/README.md`](docs/README.md).

- [`RESUMEN.md`](RESUMEN.md) — StageMaster en una página.
- [`docs/INFORME-PROYECTO.md`](docs/INFORME-PROYECTO.md) — cómo está hecho, pruebas, errores corregidos, limitaciones y recomendaciones.
- [`marketing/`](marketing/LEEME.md) — vídeo de marca para las LED y vídeos explicativos.
- [`docs/CHECKLIST-EVENTO.md`](docs/CHECKLIST-EVENTO.md) — día del evento.
- [`docs/SIMULACRO-EVENTO.md`](docs/SIMULACRO-EVENTO.md) — prueba completa con el equipo real.
- [`docs/RED-Y-COMUNICACION.md`](docs/RED-Y-COMUNICACION.md) — Wi-Fi vs Bluetooth, red, sincronización, seguridad.
- [`docs/VARIAS-PANTALLAS.md`](docs/VARIAS-PANTALLAS.md) — varias pantallas, espejos y portátiles remotos: requisitos de red y distancias.
- [`docs/RESOLUCIONES.md`](docs/RESOLUCIONES.md) — resolución del monitor vs formato LED, EDID, el caso 1920×1120.
- [`docs/BRILLO-LED.md`](docs/BRILLO-LED.md) — brillo de la imagen vs brillo físico de los módulos.
- [`docs/desarrollo/AUDITORIA-V3.md`](docs/desarrollo/AUDITORIA-V3.md) — auditoría y plan de la versión 3.
- [`docs/DESCARGA-Y-SEGURIDAD.md`](docs/DESCARGA-Y-SEGURIDAD.md) — «la app no es segura»: descargar y abrir el .exe; firma digital.
- [`docs/desarrollo/CONTEXTO-DESARROLLO.md`](docs/desarrollo/CONTEXTO-DESARROLLO.md) — estado, forma de trabajar, identidad visual, pendientes y decisiones (para continuar el desarrollo).

Tipografías **Inter** y **Oswald**: SIL Open Font License 1.1 (`public/fonts/LICENSE-*.txt`).
Iconos basados en **Lucide** (licencia ISC).
