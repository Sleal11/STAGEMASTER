# StageMaster · Red y comunicación

Análisis de cómo se comunican el portátil (estación + servidor), los teléfonos
de los árbitros y las pantallas, y por qué se eligió cada opción.

```
 📱 Teléfono árbitro Pista 1 ─┐                       ┌─ HDMI ─► 📺 Pantalla 1
                              ├─ Wi-Fi ─► 💻 Portátil ─┤
 📱 Teléfono árbitro Pista 2 ─┘   local   (servidor +  └─ HDMI ─► 📺 Pantalla 2
                                           estación)
```

---

## 1. Teléfonos ↔ portátil: Wi-Fi local (elegido)

| Criterio | Wi-Fi local + Socket.IO | Bluetooth |
|---|---|---|
| Funciona en el navegador del teléfono | ✅ Sí, en cualquier navegador | ❌ Safari (iPhone) **no** admite Web Bluetooth; en Android solo Chrome y con limitaciones |
| Necesita instalar apps | No | Sí: una app nativa para iOS y otra para Android |
| Alcance práctico | 30–50 m con un router decente | ~10 m, muy sensible a cuerpos y obstáculos |
| Dos teléfonos a la vez | ✅ Sin límite práctico | Posible, pero frágil (emparejamientos, desconexiones) |
| Reconexión automática | ✅ Socket.IO reconecta solo y se reenvía el estado | Hay que implementarla a mano |
| Encaje con el código actual | ✅ Es lo que ya usa el proyecto | Requeriría un segundo protocolo completo |

**Conclusión:** Bluetooth no aporta ventajas aquí y obligaría a construir apps
nativas solo para tener menos alcance. Se usa **Wi-Fi local** y **no** se
implementan ambos. El adaptador Bluetooth del portátil no es necesario.

## 2. ¿Qué red Wi-Fi usar? (sin Internet)

El sistema **no necesita Internet**: solo que teléfonos y portátil estén en la
misma red local.

| Opción | Valoración |
|---|---|
| **Router de viaje propio** (recomendado) | ✅ La más estable. Funciona sin Internet, el portátil puede ir por cable y la IP se puede fijar (reserva DHCP). |
| **Wi-Fi portátil (MiFi)** | ✅ Válido si permite que los dispositivos se vean entre sí. Algunos modelos traen **"aislamiento de clientes"** activado: hay que desactivarlo. Comprobar que crea la red aunque no tenga datos móviles. |
| **Zona Wi-Fi del propio portátil** (Windows) | ⚠ No verificado para este proyecto: según la versión de Windows puede exigir una conexión a Internet para activarse, y reparte la antena del portátil. Usar solo como último recurso tras probarlo. |
| **Wi-Fi del recinto** | ❌ Evitar: suele aislar a los dispositivos entre sí y no está bajo nuestro control. |

**Teléfonos Android:** algunos cambian a datos móviles si la Wi-Fi "no tiene
Internet". Al conectarse, aceptar "Mantener conexión" o desactivar los datos
móviles durante el partido.

## 3. Sincronización

- **Una sola fuente de verdad:** el servidor (portátil) calcula el marcador.
  Los teléfonos envían acciones, nunca marcadores.
- **Salas por partido:** cada actualización se envía solo a los dispositivos
  de ese partido (`match:pista-1`, `match:pista-2`). La Pista 1 nunca recibe
  datos de la Pista 2.
- **Versiones:** cada acción lleva la versión del marcador que veía el árbitro.
  Si no coincide (doble toque, otro dispositivo), se rechaza (`STALE_VERSION`):
  no hay puntos duplicados ni conflictos.
- **Acuse de recibo:** cada acción recibe respuesta; el teléfono bloquea nuevos
  toques hasta recibirla (≈ 3 ms en las pruebas locales, ≈ 50 ms del toque a la
  pantalla en las pruebas con navegador).
- **Pantallas al día:** cada pantalla informa de la versión que ha dibujado; la
  estación marca "Desincronizada" si tarda más de 2 s.

## 4. Desconexiones y recuperación

| Situación | Qué ocurre |
|---|---|
| El teléfono pierde la Wi-Fi | Barra roja "Desconectado"; los toques **no** se envían (evita puntos tardíos). Al volver se reconecta solo, sigue vinculado (token) y recibe el marcador actual. |
| Se cierra el servidor o se va la luz | Las pantallas mantienen el último marcador. Al arrancar, cada partido, PIN, teléfono vinculado y configuración de pantallas se recupera de `data/`. |
| Una pantalla se desconecta | No afecta a la otra ni a los partidos. La estación la muestra "Sin conexión" con un botón para reabrirla. |
| El teléfono del árbitro falla | Otro teléfono se vincula con el PIN (pide confirmación para reemplazar) o el operador puntúa desde la estación. |

## 5. Seguridad básica

- **Estación solo en el portátil:** la página y su conexión se rechazan si no
  vienen de `localhost`. Un teléfono de la red no puede administrar nada.
- **PIN por pista** (4 dígitos, mostrado en la estación) para vincular un
  teléfono. Tras 5 PIN fallidos desde un mismo dispositivo, bloqueo de 1 minuto.
- **Token por teléfono:** aleatorio de 192 bits; en disco solo se guarda su hash.
  Un teléfono solo puede modificar **su** partido (`WRONG_MATCH`).
- **Pantallas de solo lectura y solo desde el portátil:** no pueden modificar
  nada y un dispositivo de la red no puede hacerse pasar por una pantalla
  (`STAGEMASTER_REMOTE_DISPLAYS=1` lo permite si algún día se usa una pantalla
  conectada a otro equipo).
- **Datos validados en el servidor** (configuración, acciones, publicidad).

Limitación conocida: la red local no va cifrada (HTTP). En una red privada
del evento con contraseña Wi-Fi es suficiente; si algún día se usa una red
compartida, conviene añadir HTTPS.
