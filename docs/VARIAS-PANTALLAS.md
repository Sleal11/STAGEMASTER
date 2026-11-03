# StageMaster · Varias pantallas y varios portátiles

## Escenario 1 · Varias pantallas en el mismo portátil

Desde la estación, sección **Pantallas**:

- **Añadir pantalla** (hasta 8) y **Quitar** (icono de papelera, con confirmación).
- Cada pantalla elige su **monitor** en la pestaña *Salida* (o «Ventana de prueba»).
- **Espejo** (pestaña *Contenido* → *Origen* → «Igual que Pantalla 1»): muestra exactamente lo
  mismo que otra pantalla (marcador, cinta, lista de reproducción y publicidad automática, en el
  mismo instante) con **su propio monitor, formato LED y brillo**. Ejemplo: dos LED, uno a cada
  lado de la pista. El reproductor de un espejo controla el de su origen.
  - Sin cadenas: una pantalla no puede ser espejo de un espejo.
  - Si se quita la pantalla original, sus espejos pasan a independientes mostrando lo mismo.
- Dos pantallas también pueden mostrar el mismo partido **sin** ser espejo (cada una con su
  propia cinta y publicidad).

### Límite de hardware (no de StageMaster)

Cada pantalla necesita una **salida de vídeo** del portátil. Un portátil suele tener 1 o 2
(HDMI + USB‑C/Thunderbolt). Para más:

| Opción | Comentario |
|---|---|
| Dock USB‑C/Thunderbolt con varias salidas (DisplayPort MST) | Recomendado. Cada salida es un monitor independiente |
| Adaptadores USB «DisplayLink» | Funcionan, pero comprimen la imagen con el procesador: evitar con vídeos |
| Divisor HDMI (splitter) | Dos LED con **la misma imagen** sin gastar salidas (equivale a un espejo con el mismo formato) |

## Escenario 2 · Pantallas en otro portátil (pistas lejos)

```
 PORTÁTIL PRINCIPAL (estación, partidos, publicidad)        PORTÁTIL REMOTO (junto a la pista)
 StageMaster en modo principal  ── red local (cable/Wi‑Fi) ──  StageMaster en modo «pantalla remota»
        │                                                               │
   teléfonos de árbitro                                           pantalla LED (HDMI)
```

### Puesta en marcha (una vez)

1. Conecta los dos portátiles a la **misma red** (ver requisitos abajo).
2. En el **portátil remoto**: abre StageMaster → en la estación, sección *Portátiles remotos* →
   **«Usar este portátil como pantalla remota»**. StageMaster se reinicia en ese modo (lo recuerda).
3. En la ventana «Pantalla remota» aparece el principal («StageMaster en …»). Elígelo (o escribe su
   dirección, la que muestra la estación arriba, p. ej. `192.168.1.10:3000`).
4. Escribe el **código de enlace** de 6 cifras que muestra la estación del principal y pulsa *Enlazar*.
5. Elige qué pantalla va en cada monitor de este portátil (las demás: «No mostrar aquí»).
6. Si también quieres **controlar desde este portátil**, pulsa **«Abrir estación del moderador»**:
   se abre la estación del principal (la misma: partidos, puntos, pantallas, publicidad, En vivo e
   Historial) en una ventana de este portátil.

A partir de ahí, al abrir StageMaster en el portátil remoto se conecta solo.

### Cómo se comporta

- **Una sola autoridad**: los partidos, la configuración y la publicidad están solo en el principal.
  La ventana «Pantalla remota» no cambia nada; para controlar se abre la **estación del principal**
  desde el remoto («Abrir estación del moderador»), y todo lo que se hace ahí lo guarda el principal.
- **Dos estaciones a la vez** (principal y remotos): cada cambio llega a todas al instante. Los puntos
  llevan la versión del marcador: nunca se cuenta un punto dos veces ni sobre un tanteo viejo. Si
  dos personas cambian el mismo ajuste a la vez, queda el último y las dos lo ven.
- **Solo en el principal**: código de enlace, enlazar y desvincular portátiles, la resolución de
  sus monitores, «Permitir teléfonos» (firewall) y «Carpeta de publicidad». La estación del remoto
  no los muestra y el servidor los rechaza (`MAIN_ONLY`). La publicidad se sube con «Subir archivos…».
- **Tiempo real**: el marcador, la cinta, la publicidad automática (pausa/fin de partido) y los
  cambios de la estación llegan a la vez a todas las pantallas, también a las remotas.
- **Si se corta la red**: la pantalla remota **mantiene la última imagen** (nunca se queda en negro),
  la ventana del remoto indica «Reconectando…» y vuelve sola al volver la red.
- **Si el principal cambia de IP** (otra red, DHCP): el remoto lo vuelve a encontrar por su nombre.
- **La estación del principal** muestra cada portátil remoto: conectado o no, su IP, si **tiene la
  estación abierta** y qué pantalla muestra en qué monitor. Cada tarjeta de pantalla dice dónde se ve («en Portátil pista 2»).
- **Desvincular** (estación del principal): sus pantallas y su estación se apagan al momento y su
  enlace deja de valer. **Nuevo código**: el anterior deja de servir; los ya enlazados siguen funcionando.
- Para volver a usar el portátil remoto como principal: botón «Usar este portátil como principal».

### Requisitos de red

| Requisito | Detalle |
|---|---|
| Misma red local | Mismo router o switch. **No hace falta Internet** |
| Puertos | TCP **3000** (o 3001‑3005 si estuviera ocupado) en el principal; UDP **41234** para encontrarlo |
| Cortafuegos de Windows | La primera vez Windows pregunta si StageMaster puede usar la red: **Permitir** en redes **privadas**. Marca la red del evento como *Privada* |
| Wi‑Fi de invitados | Muchas aíslan los equipos entre sí: no sirven. Usa una red propia |
| Ancho de banda | El marcador ocupa muy poco. Las imágenes y vídeos se descargan del principal (un vídeo de 50 MB tarda ~5 s por cable) |

### Distancias

| Distancia | Solución |
|---|---|
| Hasta 100 m | **Cable de red Cat5e/Cat6** (lo más fiable). Un switch en medio permite otros 100 m |
| Cientos de metros / km | Conversores de **fibra óptica** (media converters) |
| Sin poder tirar cable | **Puente Wi‑Fi punto a punto** exterior (5 GHz, con visión directa) |
| Alternativa sin segundo portátil | **Extensor HDMI HDBaseT** (hasta 100 m por Cat6) o **cable HDMI de fibra**: el LED es un monitor más del principal (sin red) |

Recomendación: cable siempre que se pueda. El Wi‑Fi del recinto puede saturarse con el público.

### Seguridad

- Una pantalla desde otro equipo solo se acepta con el **token** que se recibe al enlazar con el
  código (el principal guarda solo su *hash*). Sin enlazar, se rechaza.
- 5 códigos incorrectos seguidos bloquean los intentos desde ese equipo durante un minuto.
- La estación desde otro equipo exige el mismo **token** (solo portátiles enlazados); sin él, se
  rechaza. Subir o borrar publicidad desde la red, también.
- La red local va sin cifrar: usa una **red propia del evento** (no la de invitados) y no compartas
  el código de enlace. Si alguien lo viera, pulsa «Nuevo código» y desvincula lo que no reconozcas.

## Compartir el panel de partido entre portátiles (análisis)

| Opción | Estado |
|---|---|
| **Panel del árbitro** (`control.html`) en otro portátil o tableta, con el PIN de la pista | **Ya disponible**: un segundo operador puede llevar el marcador de una pista desde otro equipo de la red (un dispositivo por pista; vincular otro pide confirmación y reemplaza al anterior). Si la estación y ese equipo puntúan a la vez, no hay conflicto: cada acción lleva la versión del marcador y nunca se aplica sobre un tanteo antiguo ni se cuenta un punto dos veces |
| **Estación completa** (pantallas, publicidad) en otro portátil | **Disponible** (versión 2.6.0, petición de Santiago) en los **portátiles remotos enlazados**: «Abrir estación del moderador». Varias estaciones a la vez; el último cambio de un mismo ajuste es el que queda y todas lo ven al instante. Lo reservado al principal está arriba |

Recomendación: la **estación del principal** y, en las pistas lejanas, la **estación desde el portátil remoto**; para llevar solo el marcador de una pista, el **panel del árbitro**.

## Lo que necesitamos saber para el evento

1. **Distancia** entre la mesa del portátil principal y cada pantalla LED lejana.
2. Si se puede **tirar cable de red** o solo hay Wi‑Fi (y si el Wi‑Fi es propio o del recinto).
3. **Cuántas salidas de vídeo** tiene cada portátil (HDMI, USB‑C/Thunderbolt) y cuántas pantallas
   irá en cada uno.
4. Si dos pantallas deben mostrar **exactamente lo mismo** (espejo o divisor HDMI) o cosas distintas.
