# StageMaster — Simulacro de evento

Guion para probar el marcador **como en un evento real**, con el equipo real,
antes de usarlo con público. Cada prueba tiene pasos concretos y un criterio de
aprobado. Duración total aproximada: **1 h 30 min** (más la prueba de duración,
que puede quedar corriendo sola).

---

## 0. Montaje recomendado

```
 📱 Árbitro Pista 1 ─┐                                       ┌─ HDMI ─► 📺 Pantalla 1
                     ├─ Wi-Fi ─► Router ─ cable ─► 💻 Portátil ┤
 📱 Árbitro Pista 2 ─┘                         (servidor +    └─ HDMI ─► 📺 Pantalla 2
                                                estación)
```

- **El portátil es servidor, estación y pantallas.** Las pantallas se abren con
  `localhost`, así **no dependen del Wi-Fi**: aunque falle la red, siguen
  mostrando el último marcador.
- **Router propio o Wi-Fi portátil** (no necesita Internet). Evita el Wi-Fi del
  recinto: suele tener "aislamiento de clientes", que impide que los teléfonos
  vean al portátil. Ver [`RED-Y-COMUNICACION.md`](RED-Y-COMUNICACION.md).
- Portátil conectado al router **por cable** si es posible.
- Si solo tienes una pantalla o un teléfono, haz igualmente todas las pruebas
  que no los requieran por duplicado.

### Material
| | Elemento | Comprobado |
|---|---|---|
| 1 | Portátil con `StageMaster.exe` (abierto ya una vez) y cargador | ☐ |
| 2 | Router propio + alimentación (+ cable de red) | ☐ |
| 3 | 2 teléfonos de árbitro cargados (> 80 %) + cargadores | ☐ |
| 4 | Tercer teléfono de respaldo (opcional) | ☐ |
| 5 | Cables para las 2 pantallas (HDMI / USB-C / dock) | ☐ |
| 6 | Ratón (para cerrar Chrome si hace falta) | ☐ |

### Preparación del PC (Windows)
- Energía: *Configuración → Sistema → Inicio/apagado* → pantalla y suspensión en **"Nunca"** (con cargador).
- Notificaciones: activar **"No molestar"** para que no aparezcan avisos sobre las pantallas.
- Windows Update: pausar actualizaciones durante el evento.

### Preparación de los teléfonos
- *Ajustes → Pantalla y brillo → Bloqueo automático* → **Nunca** (durante el partido).
- **Modo avión + Wi-Fi activado**: evita llamadas que tapen el panel.
- Modo de bajo consumo **desactivado**.
- Navegador → dirección que muestra la estación → *Añadir a pantalla de inicio*.
- Elegir la pista e introducir su **PIN** (lo muestra la estación).

---

## 1. Pruebas automáticas (solo con el proyecto de desarrollo, 1 min)

```bash
npm test
```
**Aprobado:** cuatro resúmenes con `Fallidas: 0` (motor, núcleo, monitores e integración).
Con el `.exe` no hace falta: GitHub ejecuta estas pruebas en Windows antes de generarlo.

---

## 2. Simulacro paso a paso

Anota el resultado de cada prueba en la tabla del final.

### S1 · Montaje en frío (objetivo: < 5 min)
1. Con todo apagado, pon en marcha un cronómetro.
2. Enciende router y portátil, conecta las dos pantallas (Windows + P → Extender).
3. Abre **StageMaster** (estación + pantallas en sus monitores). En la estación,
   **Identificar** cada pantalla; si alguna está mal, cámbiala en **Salida → Monitor**.
   En pantallas LED, elige en **Salida → Formato** el tamaño de la LED (832 × 416 o 416 × 208).
4. Configura un partido en cada pista desde la estación.
5. Vincula cada teléfono a su pista con el PIN.

**Aprobado:** en menos de 5 min, cada pantalla en su monitor mostrando su
partido, y la estación con los dos teléfonos "conectado".

### S2 · Legibilidad a distancia
Con un partido en marcha, mira la pantalla desde **5 m, 10 m y la distancia real del
público**. Comprueba que se distinguen:
nombres · puntos · games · sets · pelota de saque 🎾 · badge (TIE BREAK / PUNTO DE ORO).

**Aprobado:** todo legible desde la posición más lejana del público.

### S3 · Partido real al ritmo de un vídeo ⭐ (la prueba más importante)
1. Pon en otra pantalla un partido real de pádel (ej. un vídeo de Premier Padel).
2. El operador lleva el marcador **en directo** con el teléfono, como si fuera el evento.
   Configura el partido igual que el del vídeo.
3. Juega al menos **un set completo**.

**Aprobado:**
- El marcador de la pantalla coincide con el del vídeo al final de cada game.
- El operador no necesita mirar la pantalla para saber qué pulsar.
- Si se equivoca, corrige con **Deshacer** en menos de 5 s.
- Anota cualquier botón incómodo o duda del operador.

### S4 · Cobertura del Wi-Fi
Camina con el teléfono hasta la **posición más lejana** donde estará el operador
(y detrás de obstáculos: gradas, columnas). Suma puntos desde allí.

**Aprobado:** la pantalla se actualiza al instante (< 0,5 s percibido) desde cualquier punto.

### S5 · teléfono bloqueado y desbloqueado
1. Bloquea el teléfono durante **5 minutos** mientras otro dispositivo (o el
   simulador, ver S12) suma puntos.
2. Desbloquéalo.

**Aprobado:** en menos de 3 s muestra "Conectado" y el marcador correcto.

### S6 · El teléfono pierde el Wi-Fi
1. Desactiva el Wi-Fi del teléfono 20 s. Pulsa un punto.
2. Actívalo.

**Aprobado:** sin Wi-Fi aparece "Desconectado" y un aviso al pulsar (el punto
**no** se suma); al volver, se reconecta solo con el marcador correcto.

### S7 · Router apagado 30 s
**Aprobado:** la pantalla **sigue mostrando** el marcador todo el tiempo; al volver el
router, el teléfono se reconecta solo y se puede seguir.

### S8 · Cierre accidental de StageMaster
1. A mitad de un game (ej. 30-15), cierra StageMaster (o termínalo desde el Administrador de tareas).
2. Vuelve a abrir StageMaster.

**Aprobado:** al reabrir, las pantallas vuelven solas a su monitor y, junto con el
teléfono (sin recargarlo ni volver a escribir el PIN), muestran **30-15 exacto**;
**Deshacer** sigue funcionando.

### S9 · Corte de luz del PC (el peor caso)
1. A mitad de partido, reinicia el PC (o desconéctalo si es un portátil sin batería).
2. Cronometra: arrancar servidor + abrir las pantallas.

**Aprobado:** el marcador vuelve exactamente igual. Anota el tiempo de recuperación.

### S10 · Errores del operador
| Acción | Aprobado |
|---|---|
| Sumar el punto al equipo equivocado → Deshacer (doble toque) | Vuelve al estado exacto |
| Tocar dos veces muy rápido "PUNTO A" | Cuenta **un** punto |
| Pulsar **Finalizar** por error → Confirmar → *Volver al marcador* → Deshacer | El partido sigue con los puntos intactos |
| Pulsar **Reiniciar** → Cancelar | No cambia nada |
| Corregir el saque con **Cambiar saque** | La pelota cambia en la pantalla |

### S11 · Dos partidos simultáneos ⭐
1. Cada árbitro lleva su partido a la vez durante 5 minutos (dos vídeos, o el
   simulador en una pista y una persona en la otra).
2. Comprueba que cada pantalla solo cambia con su teléfono.
3. En la estación, asigna la **Pista 1 a las dos pantallas**; después vuelve a
   dejar cada una con la suya.
4. Con el teléfono de la Pista 1, intenta elegir la Pista 2 con un PIN
   incorrecto.

**Aprobado:** ninguna acción de una pista cambia la otra; las dos pantallas
pueden mostrar el mismo partido; el PIN incorrecto se rechaza.

### S11b · Teléfono de respaldo
1. Con el árbitro de la Pista 1 conectado, en un tercer teléfono elige la
   Pista 1 y su PIN.
2. Confirma "reemplazar".

**Aprobado:** el teléfono original muestra que ya no está vinculado y no puede
sumar puntos; el de respaldo controla la pista. La estación lo refleja.

### S12 · Prueba de duración (puede ir en paralelo)
Deja StageMaster abierto 1–2 h con un partido en las pantallas. Con el proyecto
de desarrollo, además, puedes simular un partido largo de forma automática:

```bash
npm run simulate -- --match pista-1 --interval 20000
```
(un punto cada 20 s ≈ ritmo real; un partido a 3 sets dura 1–2 h).
Para una prueba más rápida: `--interval 3000`.

**Aprobado:** tras 1–2 h, la pantalla sigue fluida, el PC no se ha suspendido, no han
aparecido notificaciones y la memoria de StageMaster (Administrador de tareas)
no ha crecido de forma continua.

> Se ejecuta en el portátil. Puedes lanzar uno por pista (`--match pista-2`) a la vez.
> Mientras corre, el árbitro también puede sumar puntos desde su teléfono:
> el simulador lo detecta ("el marcador cambió desde otro dispositivo") y sigue.

### S13 · Las pantallas
| Comprobación | Aprobado |
|---|---|
| Mover el ratón sobre una pantalla | No aparece el cursor |
| Resolución de cada pantalla (la muestra la estación) | Anotarla; marcador sin cortes ni solapes |
| Cinta publicitaria (imágenes y mensajes, "cambia" y "desplazamiento continuo") | Se lee bien, no tapa nombres ni números; los cambios se ven al momento |
| **Publicidad y vídeos**: Reproducir, Pausar, Reanudar, Detener | Vídeos en bucle sin pantallas negras; Detener vuelve al marcador |
| Vídeo con sonido (si se usa) | Se oye por la salida de audio elegida en Windows |
| Publicidad al terminar el partido (activada) | Primero el resultado, después la lista; "Volver al marcador" funciona |
| Formato LED (832 × 416 / 416 × 208) | La LED muestra el marcador entero, sin bordes ni recortes (ajustar la posición si hace falta) |
| Cerrar una pantalla (Alt + F4) | La otra sigue funcionando; la estación muestra "Sin conexión" y la reabre con **Abrir ventana** |
| Nombres más largos del torneo | Se ajustan, nunca se salen |
| Resolución real de la pantalla (anotarla) | El marcador ocupa la pantalla sin cortes |
| 30 min sin tocar nada | La pantalla no se apaga ni aparece protector |
| Final del partido | Trofeo azul junto al ganador, su fila resaltada en azul, "PARTIDO FINALIZADO" arriba |
| Cinta con logos de fondo blanco | Se ven sin el recuadro blanco, separados por igual; los logos negros, en blanco |
| Pausar el partido (estación o teléfono) | La pantalla muestra EN PAUSA; no se puede puntuar hasta Reanudar |

---

## 3. Hoja de resultados

Fecha: ________  Lugar: ________  Operador: ________
Resolución de la pantalla: ________  Router: ________

| Prueba | Resultado | Tiempo / observaciones |
|---|---|---|
| Pruebas automáticas | ☐ OK ☐ Falla | |
| S1 Montaje en frío | ☐ OK ☐ Falla | ___ min |
| S2 Legibilidad | ☐ OK ☐ Falla | distancia máx.: ___ m |
| S3 Partido al ritmo del vídeo | ☐ OK ☐ Falla | errores del operador: ___ |
| S4 Cobertura Wi-Fi | ☐ OK ☐ Falla | |
| S5 teléfono bloqueado | ☐ OK ☐ Falla | |
| S6 teléfono sin Wi-Fi | ☐ OK ☐ Falla | |
| S7 Router apagado | ☐ OK ☐ Falla | |
| S8 Cierre de StageMaster | ☐ OK ☐ Falla | |
| S9 Corte de luz del PC | ☐ OK ☐ Falla | recuperación: ___ min |
| S10 Errores del operador | ☐ OK ☐ Falla | |
| S11 Dos partidos simultáneos | ☐ OK ☐ Falla | |
| S11b Teléfono de respaldo | ☐ OK ☐ Falla | |
| S12 Duración | ☐ OK ☐ Falla | ___ h |
| S13 Pantallas | ☐ OK ☐ Falla | resoluciones: ___ / ___ |

### Cómo reportar un fallo
```
Prueba: S6
Configuración del partido: 6 games, 3 sets, Ventaja, Súper TB
Qué hice:
Qué esperaba:
Qué pasó:
Dónde: teléfono / LED / consola del servidor (foto si es posible)
```
