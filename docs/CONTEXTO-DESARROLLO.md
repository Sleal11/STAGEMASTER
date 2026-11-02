# StageMaster · Contexto del desarrollo

Resumen para continuar el trabajo sin perder el rumbo (también tras una
compactación de la conversación). Estado: **versión 2.4.1** (2.3.0 + retoques
estéticos, pestaña «En vivo» y teléfonos que no conectaban, ver sección 8), rama `claude/nice-pasteur-wbpgdz`.

## 1. Qué es

Marcador profesional de pádel para eventos con pantallas LED. Aplicación de
Windows **portable** (`StageMaster.exe`, Electron) que lleva dentro un servidor
Node/Express + Socket.IO. Funciona **sin Internet** (red local). Reglas **FIP**
(Ventaja, Punto de oro, Punto Estrella; tie break a 7, súper tie break a 10).

| Pieza | Dónde | Quién la usa |
|---|---|---|
| Estación operadora | `public/station.html` + `js/station/` | El moderador, solo en el portátil |
| Pantalla de score | `public/score.html?pantalla=N` + `js/display/` | Monitores / LED (o portátil remoto) |
| Teléfono del árbitro | `public/control.html` + `js/control.js` | Un teléfono por pista (QR + PIN) |
| Servidor | `server/` (core, realtime, http, sports/padel) | — |
| Escritorio | `desktop/` (principal, remoto, ventanas, monitores, resoluciones) | — |

Tecnologías fijas (no cambiar por iniciativa propia): Electron 44.9.3,
electron-builder 26.17.0, Node + Express + Socket.IO, HTML/CSS/JS sin
frameworks (módulos ES), archivos JSON/JSONL con escritura atómica.

## 2. Forma de trabajar (acordada con Santiago)

- Responder **siempre en español**, paso a paso.
- Cambios **puntuales y graduales** en la rama `claude/nice-pasteur-wbpgdz`.
- **No pasar a `main`** hasta el análisis profundo final del proyecto.
- Cada push publica el exe de prueba (enlace fijo):
  https://github.com/Sleal11/STAGEMASTER/releases/download/prueba/StageMaster-prueba.exe
  y el mismo en .zip (si el navegador bloquea el .exe):
  https://github.com/Sleal11/STAGEMASTER/releases/download/prueba/StageMaster-prueba.zip
  La versión ya no se muestra en la interfaz (por estética): se comprueba
  pasando el ratón por el logo de la estación o al final de la Ayuda.
- Santiago actualiza con **`git pull` + `npm run app`** en Antigravity. No debe
  usar Commit/Push/Sync. Los exe descargados van **fuera** de la carpeta del
  proyecto (un commit accidental con el exe de 112 MB bloqueó el Sync).
- Las etiquetas `v*` (Releases oficiales) las crea Santiago: el push de
  etiquetas está denegado desde la sesión.
- Logos de marcas comerciales: solo de prueba, **nunca** en el repositorio.
- No simular funciones de hardware. Si falta información de hardware, decir
  exactamente qué hace falta y seguir con lo que no esté bloqueado.
- Antes de cada push: `npm test` y las pruebas de navegador afectadas.

## 3. Identidad visual (mantener)

- Paleta de la pantalla (`public/css/score.css`): fondo `#041024`, cabecera
  `#0A2350`, filas `#0C2C63` (borde `#1E4F9C`), sets `#1B5FB8`, **azul claro
  `#8FD3FF`** (puntos, filetes, set en juego), oro `#FFD54A` (punto de oro),
  pausa `#FFB020`. Ganador: fila azul más viva `#11408C` + **trofeo azul** (no estrella).
- Estación (`public/css/station.css`): misma gama de azules, tarjetas con la
  cabecera del color de su pista.
- Tipografías: **Oswald** (marcador, títulos) e **Inter** (interfaz).
- Logo: `public/img/logo-stagemaster.png` (respaldo: texto STAGE**MASTER**).
- Iconos SVG propios en `public/img/icons.svg` (sprite, estilo Lucide).
- Pantalla en unidades de contenedor (cqh/cqw): mismo diseño en monitor
  completo y en LED **XL 832×416** y **pequeña 416×208**. En la estación el
  formato es «Monitor completo», «Personalizado» (ancho × alto) o uno guardado;
  LED XL / pequeño siguen existiendo en el servidor por compatibilidad (formato pequeño =
  altura ≤ 300 px: sin títulos de columna, números más grandes).
- Composición actual: cabecera (logo · **sets** «SET 1 6-3 · SET 2 EN JUEGO» ·
  indicador · pista) / marcador (2 filas: nombres, sets, games, puntos) /
  **cinta publicitaria** (19 % del alto; 21 % en LED pequeña) sin separadores,
  logos sin fondo blanco y logos oscuros pasados a blanco.

## 4. Funcionalidades terminadas (verificadas con pruebas)

Versión 2.x (antes de la V3): 2 partidos, teléfonos con PIN/QR, estación con
puntuación de respaldo, pausa, finalizar/reiniciar con confirmación, deshacer;
pantallas con marcador, cinta (imágenes, logos SVG, vídeos cortos, mensajes;
fundido o desplazamiento) y lista de reproducción (imágenes y vídeos MP4/WEBM);
publicidad al terminar; subir/borrar publicidad desde la estación (botón o
arrastrar); formatos LED exactos con escalado de Windows compensado; versión
visible y aviso si se abre otra versión; recuperación tras cierre o corte de luz.

Versión 3 (petición «NUEVA FASE», todas sus fases completadas):

| Fase | Resultado | Archivos principales |
|---|---|---|
| 1 Auditoría | `docs/AUDITORIA-V3.md` | — |
| 2 Historial | Pestaña Historial: día, rango, pista, jugador, detalle, CSV; sin duplicados; deshacer anula | `server/core/history.js`, `js/station/history.js` |
| 3 Publicidad en la pausa | Lista durante la pausa; vuelve con el mismo tanteo; opción por pantalla | `server/core/screens.js` (`matchPauseChanged`) |
| 4 Brillo | Brillo de la **imagen** por pantalla (10-100 %) | `d-dimmer` en `score.html`; `docs/BRILLO-LED.md` |
| 5 Varias pantallas | Hasta 8, añadir/quitar, **espejos**; **portátiles remotos** (código de 6 cifras, descubrimiento UDP, reconexión, una sola autoridad) | `screens.js`, `remotes.js`, `discovery.js`, `desktop/remote.js`, `desktop/screenWindows.js`; `docs/VARIAS-PANTALLAS.md` |
| 6 Resoluciones | Formato personalizado y guardado; aviso «no cabe»; diagnóstico (px reales, Hz, escala, EDID); cambiar resolución en Windows con vuelta en 15 s | `formats.js`, `desktop/displayModes.js`; `docs/RESOLUCIONES.md` |
| 7 Estética | Sets en la cabecera junto al logo; cinta más grande | `score.html`, `score.css`, `scoreboard.js` |
| 8 Pruebas | Ver sección 6 | `tests/e2e/` |
| 9 Exe | 2.3.0 compilado y publicado en el enlace de prueba | CI |

## 5. Pendiente / bloqueado

| Tema | Estado | Qué hace falta |
|---|---|---|
| Brillo **físico** de los módulos LED | Bloqueado (no se simula) | Marca/modelo del procesador o tarjeta emisora, conexión (USB/serie/red), programa (NovaLCT…), SDK, prueba con el equipo |
| Ajuste a las LED reales | Sin datos | Tamaño en píxeles de cada LED, resolución de entrada de la tarjeta emisora y posición |
| Portátiles remotos en el recinto | Probado en simulación y CI | Distancias, si hay cable de red, Wi-Fi propio o del recinto |
| Prueba con el hardware real | Pendiente | Simulacro (`docs/SIMULACRO-EVENTO.md`) |
| Opinión de la estética nueva en LED | Pendiente | Santiago |
| Análisis profundo final + paso a `main` + etiqueta | Cuando Santiago lo pida | — |
| `.gitignore` de `*.exe` en la raíz | Propuesto, sin hacer | Confirmación de Santiago |
| **Firma digital del .exe** («la app no es segura») | Sin firma. Mientras tanto: .zip en el enlace de prueba (con LEEME), USB y pasos en `docs/DESCARGA-Y-SEGURIDAD.md` | Decisión y coste: Azure Artifact Signing (solo empresas de EE. UU./Canadá/UE/RU o personas de EE. UU./Canadá) o certificado OV; datos legales de la empresa |
| **Colores de la marca** (índigo / claro) | **En espera** por decisión de Santiago: la app sigue con su paleta azul oscuro | Maquetas, paleta y temas listos en `docs/maquetas-marca/` (ver su LEEME); falta elegir opción por parte (LED / estación / teléfono) y el color de la Pista 2 |

## 6. Pruebas

| Comando | Contenido |
|---|---|
| `npm test` | Motor 55 · núcleo 73 · monitores 14 · integración 45 |
| `npm run test:e2e` | 11 conjuntos con Chromium y Electron reales: history, pause, brightness, screens, formats, station-ui (versión oculta, formatos, diálogo de resolución, avisos), live (pestaña En vivo), layout (matriz 4 formatos × 6 estados, incluido «GANADOR»), phone (partido completo), desktop, remote |
| CI (`.github/workflows/stagemaster-windows.yml`) | En Windows: `npm test`, `desktop/displayModes.win.test.js` (resoluciones reales, sin cambiar la pantalla), `desktop/firewall.win.test.js` (diagnóstico y reglas del firewall, que borra al terminar), compilación y publicación del exe |

Notas del entorno de pruebas en la nube: Electron se descarga con
`node node_modules/electron/install.js`; sin escritorio se usa Xvfb
(`Xvfb :99 -screen 0 1920x1080x24 &`, `DISPLAY=:99`). En ese entorno Chromium no
puede abrir WebSocket hacia la IP de red (la red del contenedor responde 403);
Socket.IO sigue por HTTP y en una red real no ocurre. Las capturas se guardan
en `tests/e2e/out/` (no se suben); `out/matriz/` tiene la matriz visual actual.

## 7. Decisiones técnicas que no hay que deshacer

- Una sola autoridad: el servidor del portátil principal. Acciones con versión
  (`STALE_VERSION`): nunca se aplica un punto sobre un tanteo viejo.
- Estación solo desde localhost; pantallas desde la red solo con token de
  portátil enlazado; teléfonos con PIN → token (en disco solo hashes).
- La publicidad nunca modifica el marcador.
- Páginas servidas con compresión y `no-cache` + ETag (el navegador las guarda pero
  pregunta siempre si cambiaron: 304 si no; al actualizar se ve la versión nueva).
  Tipografías con caché larga. `/publicidad` con CSP (un SVG no ejecuta código).
- Historial append-only (JSONL), la última línea de cada partido manda.
- Los espejos no encadenan; el reproductor de un espejo es el de su origen.
- Resoluciones de Windows: solo modos del EDID, validación `CDS_TEST`, aplicar
  sin guardar y vuelta automática; nunca en la pantalla de la estación.
- El undo del teléfono pide doble toque; un set necesita 2 games de diferencia
  (con «1 game por set», 1-0 no cierra el set).

## 8. Retoques estéticos (rondas pedidas por Santiago)

Ronda 1 (versión 2.3.1):
1. «GANADOR» cabe entre las dos filas (separador 8cqh, etiqueta 5cqh); la matriz
   visual lo comprueba en todos los formatos.
2. Sin números de versión en la interfaz (cabecera de la estación, «v351» de
   los partidos, ventana del portátil remoto). Se consultan pasando el ratón por
   el logo o al final de la Ayuda.
3. Formato: solo «Monitor completo», guardados y «Personalizado». LED XL /
   pequeño siguen en el servidor (compatibilidad) y se muestran como
   personalizado con el mismo tamaño.
4. Diálogo de resolución: X en la esquina (sin «Cancelar»), la resolución elegida
   resaltada con marca y repetida junto a «Probar»; barras de desplazamiento
   oscuras; las pestañas ya no muestran la barra blanca (pasan a otra línea si no caben).
5. Los avisos amarillos de las pantallas se ocultan solos a los 10 s y vuelven
   a salir si el problema desaparece y reaparece. (Los mensajes flotantes ya
   desaparecían solos: 4 s, errores 6 s.)

Ronda 2 (versión 2.4.0) — pestaña **«En vivo»** (petición de Santiago: ver qué
se está viendo en todas las pantallas cuando el moderador no ve las LED):
- Una tarjeta por pantalla con vista previa en movimiento (`score.html?vista=previa`,
  rol `preview`: solo localhost, recibe lo mismo que la pantalla, NO cuenta como
  ventana, no informa, no suena) al tamaño real del formato, escalada.
- Estado real informado por la pantalla: qué muestra, dónde (monitor, ventana de
  prueba o portátil remoto), resolución, marcador al día, qué se reproduce, problemas.
- Aviso rojo en la pestaña con el número de pantallas que no se ven, aunque esté cerrada.
- Las vistas previas solo existen con la pestaña abierta. «Ajustes» lleva a la tarjeta del Panel.
- Límite: es una réplica de lo que StageMaster envía; si la LED física está apagada
  o el cable suelto, no se puede saber sin información del hardware.
- Archivos: `public/js/station/live.js`, `public/js/display/main.js` (modo previa),
  `server/realtime/socketServer.js` (rol preview); pruebas `tests/e2e/live.e2e.js`.

Ronda 3 (versión 2.4.1):
- Cabecera de la estación sin «Teléfonos de árbitro»: la Wi-Fi del portátil y la
  dirección para escribir a mano están junto al QR de cada pista. Arriba solo
  sale un aviso si el portátil no tiene red. El logo ya no se aplasta y las
  pestañas («En vivo») caben en una línea.
- QR que no abría («el servidor no responde»): diagnóstico del firewall de
  Windows al arrancar y cada 2 min (`desktop/firewall.js`: reglas de StageMaster,
  bloqueos, red pública, Wi-Fi). Si no pueden entrar, aviso rojo en el Panel con
  **Permitir teléfonos**: pide permiso de administrador (UAC), quita los bloqueos
  de StageMaster y abre TCP 3000-3005 y UDP 41234 SOLO a la subred local, en
  cualquier tipo de red. Probado en Windows real en CI.
- Página del árbitro más ligera: compresión (módulo `compression` de Express),
  caché con revalidación, cliente Socket.IO minificado y texto visible al momento
  (font-display swap solo en el teléfono). 1ª visita 372 → 274 KB; siguientes
  334 → 4 KB. El logo PNG (123 KB) se deja tal cual: comprimirlo cambiaba la marca.
