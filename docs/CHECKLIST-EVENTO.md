# StageMaster · Checklist del día del evento

---

## Días antes (en casa, con Internet)

- [ ] `git pull` y `npm install` en el PC del evento.
- [ ] `npm test` → `Fallidas: 0` en los tres bloques.
- [ ] Simulacro completo hecho ([`SIMULACRO-EVENTO.md`](SIMULACRO-EVENTO.md)).
- [ ] Nombres de las parejas preparados (máx. 30 caracteres).
- [ ] Formato del torneo confirmado: games, sets, ventaja/oro/estrella, desempate.

## Material

- [ ] PC + cargador
- [ ] Router propio + alimentación + cable de red
- [ ] iPhone del operador + cargador/powerbank
- [ ] Teléfono de respaldo
- [ ] Cable HDMI (y adaptador si hace falta) a la pantalla LED
- [ ] Ratón
- [ ] Alargador / regleta

## Montaje (≈ 15 min)

1. [ ] Enchufar el **router propio** (no hace falta Internet). El Wi-Fi del
       recinto suele aislar a los dispositivos: no usarlo.
2. [ ] Conectar el PC al router (por **cable** si es posible) y a la LED por HDMI.
3. [ ] PC: **Windows + P → "Extender"** (o "Solo segunda pantalla").
4. [ ] PC: suspensión y apagado de pantalla en **"Nunca"**; **"No molestar"** activado;
       Windows Update en pausa.
5. [ ] Doble clic en **`INICIAR-STAGEMASTER.bat`**.
       - Si la LED es un segundo monitor y la imagen sale en el principal:
         editar `LED_X=1920` al principio del `.bat` (o mover la ventana con
         **Windows + Shift + →**).
6. [ ] En la ventana **SERVIDOR**, anotar la dirección **"iPhone"** de la red Wi-Fi/Ethernet:
       `http://_______________:3000/control.html`
7. [ ] iPhone: modo avión + Wi-Fi del router, bloqueo automático "Nunca",
       abrir StageMaster → **● Conectado**.
8. [ ] Teléfono de respaldo: abrir la misma dirección → **● Conectado**.
9. [ ] Partido de prueba: sumar puntos, comprobar la LED, **Deshacer**,
       **Reiniciar**. Mirar la LED desde la posición del público.

> **IP fija (recomendado):** en la configuración del router, "Reserva DHCP" /
> "IP estática" para el PC. Así la dirección del iPhone es siempre la misma y el
> icono de la pantalla de inicio sigue sirviendo de un evento a otro.

## Durante el evento

- La ventana **SERVIDOR** debe seguir abierta (se puede minimizar).
- Cada partido nuevo: en el iPhone **Nuevo partido → configurar → Iniciar**.
- Cada punto queda guardado en `data/match.json` al momento.

## Qué hacer si…

| Problema | Solución |
|---|---|
| **El iPhone muestra "Desconectado"** | Esperar 5–10 s. Si sigue: ¿Wi-Fi del iPhone conectado al router propio? ¿Ventana SERVIDOR abierta? |
| **Se cerró la ventana del servidor** | Doble clic en `INICIAR-STAGEMASTER.bat`. El partido continúa exactamente donde estaba. |
| **Corte de luz / se reinició el PC** | Encender, doble clic en el `.bat`. El partido se recupera. En el iPhone, si no reconecta solo, cerrar y abrir StageMaster. |
| **La LED muestra el escritorio o una ventana** | Clic en la ventana del marcador o volver a ejecutar el `.bat`. Para salir del modo kiosco: **Alt + F4**. |
| **El router se reinició** | Esperar a que arranque (1–2 min). Todo se reconecta solo; la LED nunca deja de mostrar el marcador. |
| **"El puerto 3000 ya está en uso"** | Ya hay un servidor abierto: cerrar las ventanas SERVIDOR sobrantes y volver a ejecutar el `.bat`. |
| **La IP del PC cambió** | Ver la nueva en la ventana SERVIDOR y abrirla en el iPhone. Para evitarlo: reserva DHCP en el router. |
| **El iPhone del operador falla** | Seguir con el teléfono de respaldo: entra directo al partido actual. |
| **Diagnóstico rápido** | En el iPhone abrir `http://IP:3000/health`. Si responde `"ok":true`, la red funciona. Cada página abierta aparece en la ventana SERVIDOR como `[HTTP]`. |

## Al terminar

1. [ ] Cerrar la LED (**Alt + F4**) y la ventana SERVIDOR.
2. [ ] Restaurar los ajustes de energía del PC y el bloqueo automático del iPhone.
3. [ ] Anotar incidencias para mejorar el sistema.
