# StageMaster · Informe del proyecto (versión 2.6.1)

> Estado a **noviembre de 2026**. Versión que está operando en eventos reales.
> Resumen corto: [`RESUMEN.md`](../RESUMEN.md). Historial del desarrollo:
> [`docs/desarrollo/CONTEXTO-DESARROLLO.md`](desarrollo/CONTEXTO-DESARROLLO.md).

## 1. Qué es

StageMaster es un **marcador profesional de pádel para pantallas LED**. Es una
aplicación de Windows **portable** (un solo `.exe`, no se instala) que convierte un
portátil en la central de un evento:

- **Estación del operador** en el portátil: partidos, pantallas, publicidad, historial.
- **Teléfono del árbitro** (cualquier móvil, sin instalar nada): escanea el QR de su
  pista, escribe el PIN y puntúa con botones grandes.
- **Pantallas** (monitores o LED, hasta 8): marcador legible de lejos, cinta de
  patrocinadores, imágenes y vídeos, publicidad automática en la pausa y al terminar.
- **Portátiles remotos** para pistas lejanas: muestran pantallas por la red y pueden
  abrir la estación del principal para controlar a la vez.
- Funciona **sin Internet**: todo va por la red local (Wi‑Fi o cable).
- Reglas **FIP**: ventaja, punto de oro, FIP 2026; tie break y súper tie break.

```
 📱 Árbitro Pista 1 ─┐                                  ┌─► 📺 LED Pista 1
                     ├─ Wi‑Fi ─► 💻 StageMaster (estación + servidor) ┤
 📱 Árbitro Pista 2 ─┘                                  └─► 📺 LED Pista 2
                                     │ red local
                                     └─► 💻 Portátil remoto ─► 📺 LED pista lejana
```

## 2. Cómo está conformado

### 2.1 Tecnología

| Capa | Tecnología | Por qué |
|---|---|---|
| Aplicación de escritorio | **Electron 44** (portable con electron-builder) | Servidor y ventanas en un solo `.exe`; controla los monitores |
| Servidor | **Node.js + Express** (+ `compression`) | Sirve las páginas y la publicidad en la red local |
| Tiempo real | **Socket.IO 4** | Cada punto llega a teléfonos y pantallas al instante; reconexión sola |
| Interfaces | **HTML + CSS + JavaScript** (módulos ES, sin frameworks) | Ligero, rápido en móviles y en portátiles modestos |
| Reglas del pádel | **JavaScript puro** (funciones puras) | Fácil de probar a fondo |
| Persistencia | **Archivos JSON / JSONL** con escritura atómica | Sin base de datos que instalar; sobrevive a cortes de luz |
| Windows | **PowerShell + C#** (resoluciones, firewall) | Cambiar la resolución y abrir el firewall sin programas externos |

Dependencias de la aplicación: `express`, `compression`, `socket.io`,
`socket.io-client`, `qrcode`. **0 vulnerabilidades** en lo que va dentro del `.exe`
(`npm audit --omit=dev`).

### 2.2 Estructura de carpetas

```
STAGEMASTER/
├── desktop/            Aplicación de escritorio (Electron)
│   ├── main.js           Modo principal: servidor, estación, pantallas, resolución, firewall
│   ├── remote.js         Modo «pantalla remota» (+ remote/: su ventana de control)
│   ├── screenWindows.js  Ventanas de las pantallas en los monitores
│   ├── monitors.js       Qué pantalla va en qué monitor (lógica pura, probada)
│   ├── displayModes.js   Resoluciones de Windows (con vuelta automática en 15 s)
│   ├── firewall.js       «Permitir teléfonos» (reglas solo para la red local)
│   └── mode.js           Modo de este portátil (principal / remoto)
├── server/             Servidor (también funciona solo: npm start)
│   ├── index.js          HTTP, páginas, publicidad, anuncio en la red
│   ├── core/             Partidos, pantallas, historial, formatos, remotos, PIN/tokens, almacenamiento
│   ├── realtime/         socketServer.js: roles, permisos, salas, difusión (protocolo documentado)
│   ├── http/             adsApi.js: subir y borrar publicidad
│   └── sports/padel/     Motor de reglas (engine.js) y validación (config.js)
├── public/             Lo que ven las personas
│   ├── station.html + js/station/   Estación (Panel, En vivo, Historial)
│   ├── score.html   + js/display/   Pantallas (marcador, cinta, reproductor, logos)
│   ├── control.html + js/control.js Teléfono del árbitro
│   ├── ayuda.html                   Ayuda para el cliente
│   └── css/ · fonts/ · img/         Estilos, tipografías (Inter, Oswald), logo e iconos
├── publicidad/         Ejemplos que se copian a Documentos la primera vez
├── tests/e2e/          Pruebas con navegador y aplicación reales (Playwright + Electron)
├── tools/              simulate-match.js: operador virtual que juega un partido
├── marketing/          Vídeo para las LED y vídeos explicativos (con su fuente)
├── docs/               Guías de uso y técnicas (índice en docs/README.md)
│   └── desarrollo/       Historial del desarrollo, auditoría y maquetas de marca (en espera)
├── build/              Iconos del .exe y texto del .zip
└── .github/workflows/  Compilación automática del .exe en Windows
```

### 2.3 Tamaño del código (sin pruebas ni librerías)

| Parte | Líneas |
|---|---|
| Servidor (`server/`) | ≈ 3 850 |
| Aplicación de escritorio (`desktop/`) | ≈ 1 900 |
| Interfaces: JavaScript (`public/js/`) | ≈ 4 600 |
| Interfaces: estilos y páginas | ≈ 3 650 |
| **Pruebas** | ≈ 4 800 |

### 2.4 Quién puede hacer qué (roles)

| Rol | Dónde | Puede |
|---|---|---|
| **Estación** | Portátil principal (localhost) | Todo |
| **Estación remota** | Portátil enlazado con el código (token) | Todo salvo: enlazar/desvincular portátiles, el código, la resolución y el firewall del principal, su carpeta |
| **Teléfono del árbitro** | Cualquier móvil de la red, con el PIN de su pista | Solo su partido |
| **Pantalla** | Portátil principal o remoto enlazado | Solo mostrar (nunca modifica nada) |
| **Vista previa** («En vivo») | Estación | Ver, sin contar como pantalla |

Todas las reglas se comprueban en el **servidor** (no solo se ocultan botones).

### 2.5 Cómo viaja un punto

1. El árbitro pulsa «Punto A» → el teléfono envía la acción con la **versión** del marcador.
2. El servidor comprueba que ese teléfono controla esa pista y que la versión es la actual
   (así **nunca se cuenta un punto dos veces** ni sobre un tanteo viejo).
3. El motor calcula el nuevo marcador, se guarda en disco y se envía **solo** a la sala de
   ese partido (su teléfono y sus pantallas) y a las estaciones.
4. Cada pantalla lo dibuja e informa a la estación de que está **al día**.

### 2.6 Datos que guarda

| Dónde | Qué |
|---|---|
| `%APPDATA%\StageMaster\datos` | Partidos, PIN, teléfonos, pantallas, formatos, portátiles enlazados (solo el *hash* de los tokens), historial |
| `Documentos\StageMaster\Publicidad` | `banner\` (cinta) y `pantalla-completa\` (imágenes y vídeos) |

### 2.7 Distribución

- Cada cambio en la rama de trabajo compila el `.exe` y el `.zip` **en un Windows real**
  (GitHub Actions) tras pasar las pruebas, y los publica en el enlace fijo de prueba:
  `releases/download/prueba/StageMaster-prueba.exe` (y `.zip`).
- Versión para el cliente: fusionar en `main` y crear la etiqueta `v2.6.1` → Releases.

## 3. Funcionalidades (todas probadas)

| Área | Qué hace |
|---|---|
| Partidos | 2 pistas simultáneas; nombres, games por set (1‑6), 1/3/5 sets, ventaja · punto de oro · FIP 2026, tie break · súper tie break, saque; pausar, finalizar, reiniciar, deshacer |
| Teléfono | QR → PIN de 4 cifras → configurar y puntuar; deshacer con doble toque; pausa; un teléfono por pista (reemplazar pide confirmación); reconexión sola |
| Pantallas | Hasta 8; espejos; marcador con sets en la cabecera, saque, punto de oro, ganador; identificar; pantalla «Próximo partido» |
| Publicidad | Cinta (logos sin fondo blanco, vídeos cortos, mensajes, cambio o desplazamiento); lista de reproducción (imágenes y vídeos en bucle, con o sin sonido); publicidad automática en la pausa y al terminar; subir arrastrando; **ajuste a la salida** (llena la LED como el marcador) |
| Salida | Monitor completo o tamaño exacto de la LED (guardable con nombre) y posición; brillo de la imagen; diagnóstico (píxeles reales, Hz, escala, EDID); cambiar resolución en Windows con vuelta automática |
| En vivo | Vista previa en movimiento de cada pantalla y su estado real; aviso si alguna no se ve |
| Historial | Partidos terminados por día, rango, pista o jugador; detalle; exportar CSV |
| Portátiles remotos | Descubrimiento en la red, enlace con código, pantallas por la red, reconexión, sigue al principal si cambia de IP, **estación remota** |
| Red | Diagnóstico del firewall y «Permitir teléfonos»; página del árbitro comprimida y en caché |

## 4. Calidad: pruebas

| Conjunto | Pruebas | Qué cubre |
|---|---|---|
| Motor del pádel | 55 | Todas las reglas FIP y 4 000 acciones aleatorias |
| Núcleo del servidor | 73 | Partidos, versiones, PIN/tokens, pantallas, publicidad, formatos, migraciones |
| Monitores | 14 | Qué pantalla va en qué monitor al conectar/desconectar |
| Integración | 46 | Servidor real + estación + teléfonos + pantallas + portátil remoto por la IP de red |
| Navegador y Electron (e2e) | 12 conjuntos · 276 comprobaciones | Estación, teléfono (partido completo), pantallas (matriz visual 4 formatos × 6 estados), publicidad, En vivo, aplicación de escritorio y portátil remoto reales |
| Windows real (CI) | 2 | Cambio de resolución y firewall en un Windows de verdad |

## 5. Análisis de errores de esta revisión (y su corrección)

| Problema | Efecto | Corrección |
|---|---|---|
| La estación mostraba «1921 × 1081 px» en un monitor de 1920 × 1080 | Confusión al revisar la salida (visto en las fotos del evento) | La pantalla mide su tamaño sin redondear (escalado de Windows) |
| `modo.json` (token del portátil remoto) y la elección de monitores se escribían directamente | Un apagón a mitad de guardado podía obligar a enlazar de nuevo | Escritura atómica (archivo temporal + renombrar), como el resto de datos |
| Los scripts de PowerShell quedaban en la carpeta temporal de Windows | Archivos acumulados en cada arranque | Se borran al cerrar StageMaster |
| Publicidad «cortada» en la LED con el monitor completo (2.5.0) | La LED recibía bandas | Ajuste «Automático» que llena la salida como el marcador |
| `compression` < 1.8.2 (2.5.0) | Aviso de seguridad (fuga de memoria) | Actualizado: 0 vulnerabilidades |
| Simulador de partidos (2.5.0) | Mostraba el tanteo anterior | Espera al estado nuevo |
| Exportaciones y estilos sin uso (2.5.0) | Código sobrante | Eliminados |

Revisado sin problemas: no hay fugas de memoria (los registros que crecen tienen
límite), no hay funciones vacías ni código comentado olvidado, el guardado de partidos
ya era atómico y todas las órdenes validan sus datos.

## 6. Limitaciones conocidas

1. **Brillo físico de los módulos LED**: StageMaster atenúa la *imagen*; el brillo real
   lo controla el procesador LED. Para hacerlo desde StageMaster hace falta la marca,
   el modelo y el SDK del procesador.
2. **El `.exe` no está firmado**: Windows y algunos navegadores avisan («app no segura»).
   Solución gratuita: el `.zip` y los pasos de [`DESCARGA-Y-SEGURIDAD.md`](DESCARGA-Y-SEGURIDAD.md).
3. **Un splitter HDMI** cuenta como **un solo monitor** (misma imagen en ambas salidas).
   Para contenido distinto por LED hacen falta salidas de vídeo independientes.
4. La red local va **sin cifrar** (HTTP): usar una red propia del evento, no la de invitados.
5. Las pruebas con navegador y Electron se ejecutan en local, no en la compilación automática.

## 7. Recomendaciones

### Para los eventos (ya, sin programar)
1. **Monitor de cada LED a 1920 × 1080 · 60 Hz** (Salida → Cambiar resolución…): evita los centellazos.
2. **Router propio** para el evento (sin Internet, con contraseña) y el portátil enchufado a la corriente.
3. Publicidad en **2:1** (832 × 416 o 1664 × 832, como `marketing/videos-led/`) y vídeos MP4 H.264.
4. Hacer el **simulacro** de [`SIMULACRO-EVENTO.md`](SIMULACRO-EVENTO.md) antes de cada evento grande.
5. Publicar la versión para el cliente en **Releases** (`v2.6.1`) y usar ese enlace fijo.

### Mejoras de funcionalidad (por orden de valor)
| # | Mejora | Valor | Esfuerzo |
|---|---|---|---|
| 1 | **Cola de partidos por pista** (cargar los próximos partidos de un torneo y pasar al siguiente con un clic) | Ahorra tiempo entre partidos | Medio |
| 2 | **Copia de seguridad de la configuración** (pantallas, formatos, publicidad) para pasarla a otro portátil | Montaje más rápido | Bajo |
| 3 | **Aviso sonoro** en la estación si una pantalla o un teléfono se desconecta | Reacción inmediata | Bajo |
| 4 | **Colores de marca** del marcador (maquetas listas en `docs/desarrollo/maquetas-marca/`) | Identidad visual | Medio |
| 5 | **Brillo físico** desde StageMaster (SDK del procesador LED) | Control total de la LED | Depende del fabricante |
| 6 | **Firma digital** del `.exe` (certificado OV o servicio de firma) | Sin avisos de Windows | Coste anual |
| 7 | **Estadísticas** en el historial (duración por set, puntos de oro) y exportar PDF del resultado | Valor para organizadores | Medio |
| 8 | **Otros deportes** (tenis, pickleball): el motor está separado (`server/sports/`) | Nuevos clientes | Medio‑alto |
| 9 | **Arranque automático** con Windows y recuperación del último estado | Menos pasos al montar | Bajo |

### Mejoras técnicas
- Ejecutar las pruebas con navegador también en la compilación automática (Linux + Xvfb).
- Dividir `server/realtime/socketServer.js` (≈ 1 000 líneas) en un archivo por rol.
- Comprobar tipos con JSDoc (`tsc --checkJs`) sin cambiar a TypeScript.
- Registro de eventos en archivo (con rotación) para diagnosticar después de un evento.

## 8. Material promocional y de formación

| Archivo | Qué es |
|---|---|
| `marketing/videos-led/StageMaster-LED-832x416.mp4` (y HD) | Vídeo de marca de 15 s para las LED (2:1) |
| `marketing/tutoriales/StageMaster-resumen-90s.mp4` | Todo StageMaster en 90 s |
| `marketing/tutoriales/StageMaster-tutorial-1-estacion.mp4` | La estación del operador |
| `marketing/tutoriales/StageMaster-tutorial-2-arbitro.mp4` | El árbitro: QR, PIN y marcador |
| `marketing/tutoriales/StageMaster-tutorial-3-pantallas-y-publicidad.mp4` | Pantallas LED y publicidad |
| `marketing/tutoriales/StageMaster-tutorial-4-varias-pantallas-y-remoto.mp4` | Varias pantallas, En vivo y portátil remoto |

Los vídeos se hacen con **capturas reales** de la aplicación y se pueden regenerar
(por ejemplo, tras un cambio de diseño) con `marketing/tutoriales/fuente/`.
