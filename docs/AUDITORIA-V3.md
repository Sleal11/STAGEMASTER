# StageMaster · Auditoría y plan de la versión 3

Fecha: noviembre de 2026 · Punto de partida: `v2.2.0 · e469fef` (rama `claude/nice-pasteur-wbpgdz`)

## 1. Estado actual

| Área | Cómo funciona hoy | Archivos |
|---|---|---|
| Aplicación | Electron (un `.exe` portable) que arranca un servidor Node/Express/Socket.IO y abre la estación y las pantallas | `desktop/main.js`, `server/index.js` |
| Partidos | 2 pistas fijas (`COURTS`), un `Match` por pista: estado del motor, versión, pausa, PIN, teléfono. Se guardan en `data/matches/*.json` (escritura atómica) | `server/core/Match.js`, `matchRegistry.js`, `storage.js` |
| Reglas | Motor puro FIP (ventaja, punto de oro, punto estrella, tie break, súper tie break) | `server/sports/padel/engine.js` |
| Pantallas | 2 pantallas fijas (`pantalla-1`, `pantalla-2`); cada una: partido, vista (marcador / publicidad), cinta, lista de reproducción, publicidad al terminar, formato de salida (monitor completo o LED 832×416 / 416×208 con posición) | `server/core/screens.js`, `screenConfig.js` |
| Comunicación | Socket.IO por la red local. Estación y pantallas solo desde el propio portátil; teléfonos con PIN → token. Una sala por partido | `server/realtime/socketServer.js` |
| Publicidad | Biblioteca en `Documentos\StageMaster\Publicidad` (cinta y pantalla completa, imágenes y vídeos); subida desde la estación | `server/core/ads.js`, `server/http/adsApi.js` |
| Visualización | `score.html` decide la capa (marcador + cinta, lista, logo) y coloca la salida (todo el monitor o caja LED en píxeles físicos) | `public/js/display/*` |
| Monitores | La app de escritorio asigna cada pantalla a un monitor (o ventana de prueba) | `desktop/monitors.js` |
| Compilación | GitHub Actions en Windows: pruebas → `.exe` portable → "versión de prueba" (enlace fijo) y Releases con etiqueta `v*` | `.github/workflows/stagemaster-windows.yml` |
| Pruebas | Motor 55 · núcleo 59 · monitores 12 · integración 40 (todas pasan). Las pruebas de navegador y de la app empaquetada se ejecutaban fuera del repositorio | `server/**/*.test.js` |

## 2. Problemas y riesgos detectados

1. **Pantallas fijas (2)** en `screens.js` (`DEFAULT_SCREENS`) y `desktop/main.js` (`SCREEN_IDS`): impide 3 o más salidas.
2. **Las pantallas solo se aceptan desde el propio portátil** (`DISPLAY_LOCAL_ONLY`): impide la segunda laptop. Abrirlo sin más sería inseguro → hace falta un enlace con código (como el PIN de los teléfonos).
3. **El partido no guarda hora de inicio ni identificador propio**: necesario para el historial y la duración.
4. **La pausa solo pone "EN PAUSA"** en la pantalla: no hay enganche con la publicidad.
5. **Formatos de salida cerrados** (`fill`, `led-xl`, `led-sm`): no admite tamaños personalizados.
6. **No se ve la frecuencia (Hz) ni el modo real del monitor**, que es justo lo que provoca parpadeos en LED.
7. **Las pruebas de navegador / app empaquetada no estaban en el repositorio** → se incorporan en `tests/e2e/`.
8. `npm audit`: avisos *moderados* solo en herramientas de compilación (`electron-builder`); no van dentro del `.exe`. No se fuerza una actualización que rompería la compilación.

## 3. Estrategia por requerimiento

### Historial de partidos
- `Match` registra `uid` e `startedAt` al crear el partido, y el tiempo en pausa.
- Al **terminar** (por reglas o "Finalizar") se guarda el registro en `data/historial.jsonl`: una línea por evento, solo se añade (nunca se reescribe el archivo) → resistente a cortes de luz.
- Sin duplicados: clave `uid` del partido; si se deshace el final, se anula el registro; si se vuelve a terminar, se guarda el resultado nuevo.
- Un partido que no terminó (app cerrada a mitad) **no** se guarda.
- Estación: vista **Historial** con filtros (hoy, ayer, un día, rango, nombre), lista por días (lo más reciente primero), detalle y exportación CSV.

### Publicidad al pausar
- Por pantalla, opción "Al pausar el partido, mostrar la publicidad" (activada por defecto).
- Mismo mecanismo que la publicidad al terminar: el servidor avisa a las pantallas del partido; al reanudar vuelven al marcador. El marcador no se toca.
- Sin lista de reproducción: la pantalla sigue en el marcador con "EN PAUSA".

### Brillo
- **Brillo de la señal** (imagen que envía StageMaster), por pantalla, sin reiniciar: funcional y verificable, pero **no** cambia el brillo físico de los módulos (y a brillo bajo se pierde gama de grises).
- **Brillo físico**: lo controla el **procesador / tarjeta emisora LED** (NovaStar, Colorlight, Linsn…), cada uno con su protocolo (serie, USB o red). **Hace falta saber marca y modelo** y cómo está conectado. No se simula.

### Varias pantallas y varias laptops
- Pantallas **ilimitadas** (hasta 8) por portátil: añadir/quitar; varias pueden mostrar el mismo partido.
- Pantalla **espejo** de otra: copia todo el contenido (partido, vista, cinta, lista, pausas) y conserva su propia salida (monitor, formato).
- **Segunda laptop**: modo "Pantallas remotas". Se conecta a la laptop principal (la única que tiene los partidos) con su dirección y un **código de enlace**; muestra en sus monitores las pantallas que se le asignen. Detección automática en la red local.
- Autoridad única: solo el servidor principal cambia el marcador; las versiones evitan que dos dispositivos se pisen; al reconectar se recibe el estado completo.
- Red: misma red local (router/AP, cable Ethernet hasta 100 m, switches, fibra o enlaces Wi-Fi punto a punto para distancias mayores). Sin Internet.

### Resoluciones personalizadas
- **Resolución lógica** (lo que dibuja StageMaster): formatos personalizados ancho × alto guardables, en cualquier posición del monitor, en píxeles físicos exactos.
- **Resolución física** (la señal HDMI): la deciden la tarjeta gráfica y el **EDID** del procesador LED. Windows solo ofrece los modos que ambos aceptan. Una app no puede crear un modo nuevo; sí puede:
  - mostrar el modo real de cada monitor (ancho, alto, Hz, escalado) y avisar de lo que provoca parpadeos;
  - listar los modos que el driver admite y aplicar uno, **con vuelta atrás automática** si no se confirma (como hace Windows);
  - explicar cómo crear el modo exacto (EDID del procesador LED, panel de Intel/NVIDIA/AMD o CRU).

### Estética
- "SET 1 EN JUEGO" (y los sets terminados) pasa a la cabecera, junto al logo.
- La cinta crece con el espacio que deja libre.

## 4. Orden de trabajo

1. Auditoría (este documento)
2. Historial
3. Publicidad al pausar
4. Brillo de la señal (+ integración del brillo físico cuando se conozca el procesador)
5. Varias pantallas y laptops
6. Resoluciones personalizadas
7. Estética
8. Pruebas generales (unitarias, integración, navegador y app empaquetada)
9. `.exe` (versión de prueba en el enlace fijo)

## 5. Resultado (versión 2.3.0)

| Fase | Resultado | Pendiente / depende de vosotros |
|---|---|---|
| 2 · Historial | Pestaña *Historial*: guardado al terminar, sin duplicados, deshacer anula; búsqueda por día, rango, pista y jugador; detalle; CSV | — |
| 3 · Publicidad en la pausa | Lista de reproducción durante la pausa; vuelve al marcador con el mismo tanteo; opción por pantalla; «Volver al marcador» respeta esa pausa | — |
| 4 · Brillo | Brillo de la **imagen** por pantalla (10-100 %) | Brillo **físico**: marca/modelo del procesador LED, conexión, programa y SDK (`docs/BRILLO-LED.md`) |
| 5 · Varias pantallas | Hasta 8, añadir/quitar, **espejos**; **portátiles remotos** con código de enlace, descubrimiento en la red, reconexión y una sola autoridad | Distancias y tipo de red del recinto (`docs/VARIAS-PANTALLAS.md`) |
| 6 · Resoluciones | Formato personalizado y guardado; aviso si no cabe; diagnóstico (px reales, Hz, escala, EDID); cambio de resolución en Windows con vuelta automática (probado en Windows real) | Tamaño exacto de cada LED, tarjeta emisora y su resolución de entrada (`docs/RESOLUCIONES.md`) |
| 7 · Estética | Sets en la cabecera junto al logo; cinta 19 % / 21 % | Opinión sobre el resultado en vuestras LED |
| 8 · Pruebas | `npm test` (motor 55, núcleo 73, monitores 14, integración 43) + `npm run test:e2e` (9 conjuntos, 192 comprobaciones con navegador y Electron reales) + prueba de Windows en CI | Simulacro con el equipo real (`docs/SIMULACRO-EVENTO.md`) |

Riesgos de la sección 2 resueltos: pantallas fijas (ahora dinámicas), `DISPLAY_LOCAL_ONLY` (pantallas
remotas con token), sin hora de inicio (ahora `startedAt`), pausa sin publicidad, formatos cerrados,
sin diagnóstico de Hz y pruebas e2e fuera del repositorio. Sigue igual: los avisos de `npm audit` solo
afectan a electron-builder (herramienta de compilación, no va dentro del .exe).
