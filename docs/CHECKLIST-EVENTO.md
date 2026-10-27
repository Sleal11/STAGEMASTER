# StageMaster · Checklist del día del evento

---

## Días antes (en casa, con Internet)

- [ ] `git pull` y `npm install` en el portátil del evento.
- [ ] `npm test` → `Fallidas: 0` en los tres bloques.
- [ ] Simulacro hecho ([`SIMULACRO-EVENTO.md`](SIMULACRO-EVENTO.md)), con las **dos pantallas reales** y los **dos teléfonos**.
- [ ] Publicidad copiada en `publicidad/banner` y `publicidad/pantalla-completa` y probada en las pantallas.
- [ ] Jugadores de cada partido preparados (máx. 24 caracteres por jugador).
- [ ] Formato del torneo confirmado: games, sets, ventaja/oro/estrella, desempate.
- [ ] Comprobado que el portátil admite **dos monitores externos** a la vez (HDMI + USB-C/DisplayPort o dock).

## Material

- [ ] Portátil + cargador
- [ ] Router de viaje o Wi-Fi portátil (MiFi) + alimentación (+ cable de red)
- [ ] 2 teléfonos de árbitro + cargadores/powerbanks
- [ ] Teléfono de respaldo (opcional)
- [ ] Cables (HDMI / USB-C a HDMI / dock) para **cada** pantalla
- [ ] Ratón y regleta

## Montaje (≈ 20 min)

1. [ ] Encender el **router / Wi-Fi portátil** (no necesita Internet). Si es un
       MiFi, comprobar que **no** tiene "aislamiento de clientes".
2. [ ] Conectar el portátil a esa red (por **cable** si es posible).
3. [ ] Conectar las pantallas. **Windows + P → Extender**. En *Configuración →
       Pantalla*, anotar el ancho de cada monitor y su orden.
4. [ ] Portátil: suspensión y apagado de pantalla en **"Nunca"**; **"No molestar"**;
       Windows Update en pausa.
5. [ ] Editar al principio de `INICIAR-STAGEMASTER.bat`: `SCREENS` (1 o 2),
       `SCREEN1_X` y `SCREEN2_X`.
6. [ ] Doble clic en **`INICIAR-STAGEMASTER.bat`**.
7. [ ] En la estación: **Identificar** cada pantalla y comprobar que "PANTALLA 1"
       sale en el monitor correcto. Si no, arrastrar la ventana (o **Windows +
       Shift + →**) y corregir los números del `.bat` para la próxima vez.
8. [ ] En la estación: **Configurar partido** en cada pista; asignar a cada
       pantalla su partido, modo y publicidad.
9. [ ] Cada árbitro: modo avión + Wi-Fi, abrir la dirección de la estación,
       elegir su pista y teclear el **PIN**. En la estación debe aparecer
       "Teléfono conectado" en las dos pistas.
10. [ ] Prueba cruzada: el árbitro de la Pista 1 suma un punto → **solo** cambia
        la pantalla de la Pista 1. Deshacer. Repetir con la Pista 2.
11. [ ] Mirar las pantallas desde la posición del público.

> **IP fija (recomendado):** reserva DHCP para el portátil en el router. Así la
> dirección de los teléfonos no cambia y el icono de la pantalla de inicio sirve
> de un evento a otro.

## Durante el evento

- La ventana **SERVIDOR** debe seguir abierta (se puede minimizar).
- Vigilar en la estación: teléfonos "conectado" y pantallas "Marcador al día".
- Entre partidos: **Nuevo partido…** en la estación (o desde el teléfono).
- Todo se guarda en `data/` al momento.

## Qué hacer si…

| Problema | Solución |
|---|---|
| **Un teléfono aparece "desconectado"** | Esperar 5–10 s. Si sigue: ¿Wi-Fi del teléfono en la red del evento? ¿Bloqueado? Desbloquear: se reconecta solo. |
| **El teléfono de un árbitro falla** | Otro teléfono: elegir la pista, PIN y confirmar "reemplazar". O puntuar desde la estación. |
| **Una pantalla "Sin conexión" o "Desincronizada"** | Clic en esa pantalla y **F5**; o **Abrir ventana** en la estación. La otra pantalla no se ve afectada. |
| **Una pantalla en el monitor equivocado** | Arrastrarla o **Windows + Shift + →**; comprobar con **Identificar**. |
| **Se cerró la ventana del servidor** | Doble clic en el `.bat`. Partidos, PIN, teléfonos y pantallas se recuperan solos. |
| **Corte de luz / se reinició el portátil** | Encender, doble clic en el `.bat`. Los teléfonos se reconectan solos. |
| **"El puerto 3000 ya está en uso"** | Ya hay un servidor abierto: cerrar las ventanas SERVIDOR sobrantes. |
| **Un anuncio no se ve** | La estación indica cuál; se salta solo. Revisar el archivo (formato, que no esté dañado). |
| **Diagnóstico de red** | En el teléfono abrir `http://IP:3000/health`. Si responde `"ok":true`, la red funciona. |

## Al terminar

1. [ ] Cerrar las pantallas (clic + **Alt + F4**), la estación y la ventana SERVIDOR.
2. [ ] Restaurar energía del portátil y bloqueo automático de los teléfonos.
3. [ ] Anotar incidencias.
