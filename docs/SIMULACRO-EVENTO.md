# StageMaster — Simulacro de evento

Guion para probar el marcador **como en un evento real**, con el equipo real,
antes de usarlo con público. Cada prueba tiene pasos concretos y un criterio de
aprobado. Duración total aproximada: **1 h 30 min** (más la prueba de duración,
que puede quedar corriendo sola).

---

## 0. Montaje recomendado

```
 iPhone (operador)  ──Wi-Fi──►  Router  ──cable o Wi-Fi──►  PC (servidor) ──HDMI──► Pantalla LED
                                                             └─ Chrome: http://localhost:3000/score.html
```

- **El PC hace de servidor y de pantalla.** La LED se abre con `localhost`,
  así **no depende del Wi-Fi**: aunque falle la red, la pantalla sigue mostrando
  el último marcador.
- **Router propio** (uno de viaje sirve; no necesita Internet). Evita el Wi-Fi
  del recinto: suelen tener "aislamiento de clientes", que impide que el iPhone
  vea al PC.
- PC conectado al router **por cable** si es posible.

### Material
| | Elemento | Comprobado |
|---|---|---|
| 1 | PC con el proyecto instalado (`npm install` hecho en casa) y cargador | ☐ |
| 2 | Router propio + alimentación (+ cable de red) | ☐ |
| 3 | iPhone del operador cargado (> 80 %) + cargador/powerbank | ☐ |
| 4 | Segundo teléfono de respaldo (opcional, recomendado) | ☐ |
| 5 | Cable HDMI a la pantalla LED / monitor grande | ☐ |
| 6 | Ratón (para cerrar Chrome si hace falta) | ☐ |

### Preparación del PC (Windows)
- Energía: *Configuración → Sistema → Inicio/apagado* → pantalla y suspensión en **"Nunca"** (con cargador).
- Notificaciones: activar **"No molestar"** para que no aparezcan avisos sobre la LED.
- Windows Update: pausar actualizaciones durante el evento.

### Preparación del iPhone
- *Ajustes → Pantalla y brillo → Bloqueo automático* → **Nunca** (durante el partido).
- **Modo avión + Wi-Fi activado**: evita llamadas que tapen el panel.
- Modo de bajo consumo **desactivado**.
- Safari → `http://IP-DEL-PC:3000` → *Compartir → Añadir a pantalla de inicio*
  (se abre como app, sin barra de Safari).

---

## 1. Pruebas automáticas (en el PC, 1 min)

```bash
npm test
```
**Aprobado:** tres resúmenes con `Fallidas: 0` (motor, gestor e integración).

---

## 2. Simulacro paso a paso

Anota el resultado de cada prueba en la tabla del final.

### S1 · Montaje en frío (objetivo: < 5 min)
1. Con todo apagado, pon en marcha un cronómetro.
2. Enciende router y PC, conecta la LED.
3. Doble clic en **`INICIAR-STAGEMASTER.bat`** (arranca el servidor y abre la LED
   en modo kiosco). Alternativa manual: `npm start` y abrir
   `http://localhost:3000/score.html` con **F11**.
4. Abre el panel en el iPhone y crea un partido.

**Aprobado:** marcador en la LED en menos de 5 min y la barra del iPhone en verde
"Conectado".

### S2 · Legibilidad a distancia
Con un partido en marcha, mira la LED desde **5 m, 10 m y la distancia real del
público**. Comprueba que se distinguen:
nombres · puntos · games · sets · pelota de saque 🎾 · badge (TIE BREAK / PUNTO DE ORO).

**Aprobado:** todo legible desde la posición más lejana del público.

### S3 · Partido real al ritmo de un vídeo ⭐ (la prueba más importante)
1. Pon en otra pantalla un partido real de pádel (ej. un vídeo de Premier Padel).
2. El operador lleva el marcador **en directo** con el iPhone, como si fuera el evento.
   Configura el partido igual que el del vídeo.
3. Juega al menos **un set completo**.

**Aprobado:**
- El marcador de la LED coincide con el del vídeo al final de cada game.
- El operador no necesita mirar la LED para saber qué pulsar.
- Si se equivoca, corrige con **Deshacer** en menos de 5 s.
- Anota cualquier botón incómodo o duda del operador.

### S4 · Cobertura del Wi-Fi
Camina con el iPhone hasta la **posición más lejana** donde estará el operador
(y detrás de obstáculos: gradas, columnas). Suma puntos desde allí.

**Aprobado:** la LED se actualiza al instante (< 0,5 s percibido) desde cualquier punto.

### S5 · iPhone bloqueado y desbloqueado
1. Bloquea el iPhone durante **5 minutos** mientras otro dispositivo (o el
   simulador, ver S12) suma puntos.
2. Desbloquéalo.

**Aprobado:** en menos de 3 s muestra "Conectado" y el marcador correcto.

### S6 · El iPhone pierde el Wi-Fi
1. Desactiva el Wi-Fi del iPhone 20 s. Pulsa un punto.
2. Actívalo.

**Aprobado:** sin Wi-Fi aparece "Desconectado" y un aviso al pulsar (el punto
**no** se suma); al volver, se reconecta solo con el marcador correcto.

### S7 · Router apagado 30 s
**Aprobado:** la LED **sigue mostrando** el marcador todo el tiempo; al volver el
router, el iPhone se reconecta solo y se puede seguir.

### S8 · Cierre accidental del servidor
1. A mitad de un game (ej. 30-15), cierra la ventana del servidor.
2. Vuelve a arrancarlo (`npm start`).

**Aprobado:** la LED nunca queda en blanco; tras arrancar, el iPhone y la LED
siguen con **30-15 exacto** sin recargar nada; **Deshacer** sigue funcionando.

### S9 · Corte de luz del PC (el peor caso)
1. A mitad de partido, reinicia el PC (o desconéctalo si es un portátil sin batería).
2. Cronometra: arrancar servidor + abrir LED.

**Aprobado:** el marcador vuelve exactamente igual. Anota el tiempo de recuperación.

### S10 · Errores del operador
| Acción | Aprobado |
|---|---|
| Sumar el punto al equipo equivocado → Deshacer (doble toque) | Vuelve al estado exacto |
| Tocar dos veces muy rápido "PUNTO A" | Cuenta **un** punto |
| Pulsar **Finalizar** por error → Confirmar → *Volver al marcador* → Deshacer | El partido sigue con los puntos intactos |
| Pulsar **Reiniciar** → Cancelar | No cambia nada |
| Corregir el saque con **Cambiar saque** | La pelota cambia en la LED |

### S11 · Operador + teléfono de respaldo
1. Abre el panel en un segundo teléfono.
2. Suma puntos alternando entre ambos.
3. En el 2.º teléfono intenta iniciar un partido nuevo.

**Aprobado:** los dos ven siempre lo mismo; el partido nuevo pide confirmación
("Partido en curso") y, si se cancela, la LED no cambia.

### S12 · Prueba de duración (puede ir en paralelo)
Simula un partido largo de forma automática y deja la LED a la vista:

```bash
npm run simulate -- --interval 20000
```
(un punto cada 20 s ≈ ritmo real; un partido a 3 sets dura 1–2 h).
Para una prueba más rápida: `--interval 3000`.

**Aprobado:** tras 1–2 h, la LED sigue fluida, el PC no se ha suspendido, no han
aparecido notificaciones y la memoria de Chrome/Node (Administrador de tareas)
no ha crecido de forma continua.

> Mientras el simulador corre, también puedes sumar puntos desde el iPhone:
> el simulador lo detecta ("el marcador cambió desde otro dispositivo") y sigue.

### S13 · La pantalla LED
| Comprobación | Aprobado |
|---|---|
| Mover el ratón sobre la LED | No aparece el cursor |
| Nombres más largos del torneo | Se ajustan, nunca se salen |
| Resolución real de la LED (anotarla) | El marcador ocupa la pantalla sin cortes |
| 30 min sin tocar nada | La pantalla no se apaga ni aparece protector |
| Final del partido | ⭐ junto al ganador, nombre en dorado, "GANADOR DEL PARTIDO" |

---

## 3. Hoja de resultados

Fecha: ________  Lugar: ________  Operador: ________
Resolución de la LED: ________  Router: ________

| Prueba | Resultado | Tiempo / observaciones |
|---|---|---|
| Pruebas automáticas | ☐ OK ☐ Falla | |
| S1 Montaje en frío | ☐ OK ☐ Falla | ___ min |
| S2 Legibilidad | ☐ OK ☐ Falla | distancia máx.: ___ m |
| S3 Partido al ritmo del vídeo | ☐ OK ☐ Falla | errores del operador: ___ |
| S4 Cobertura Wi-Fi | ☐ OK ☐ Falla | |
| S5 iPhone bloqueado | ☐ OK ☐ Falla | |
| S6 iPhone sin Wi-Fi | ☐ OK ☐ Falla | |
| S7 Router apagado | ☐ OK ☐ Falla | |
| S8 Cierre del servidor | ☐ OK ☐ Falla | |
| S9 Corte de luz del PC | ☐ OK ☐ Falla | recuperación: ___ min |
| S10 Errores del operador | ☐ OK ☐ Falla | |
| S11 Teléfono de respaldo | ☐ OK ☐ Falla | |
| S12 Duración | ☐ OK ☐ Falla | ___ h |
| S13 Pantalla LED | ☐ OK ☐ Falla | |

### Cómo reportar un fallo
```
Prueba: S6
Configuración del partido: 6 games, 3 sets, Ventaja, Súper TB
Qué hice:
Qué esperaba:
Qué pasó:
Dónde: iPhone / LED / consola del servidor (foto si es posible)
```
