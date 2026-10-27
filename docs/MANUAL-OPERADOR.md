# StageMaster · Manual de uso

Dos personas usan el sistema durante el evento:

- **Operador** (portátil): la **estación operadora**. Configura partidos,
  pantallas y publicidad, y vigila que todo esté conectado y al día.
- **Árbitros** (teléfonos): cada uno lleva el marcador de **su** pista.

---

# Parte 1 · Estación operadora (portátil)

Se abre sola con `INICIAR-STAGEMASTER.bat`, o en `http://localhost:3000/station.html`.
Solo funciona en el propio portátil.

## Lo que se ve

- **Arriba:** la dirección que deben abrir los teléfonos de los árbitros.
- **Partidos (Pista 1 / Pista 2):** marcador, estado, **teléfono** (conectado,
  desconectado o sin vincular) y **PIN** de cada pista. Cada pista tiene un color
  propio (Pista 1 azul, Pista 2 ámbar) que se repite en el teléfono y en la pantalla.
- **Pantallas (Pantalla 1 / Pantalla 2):** si está conectada y su resolución,
  qué partido muestra, si el **marcador está al día**, el modo y la publicidad.

## Tareas

| Para… | Haz… |
|---|---|
| Crear un partido | **Configurar partido…** en su pista: jugadores (uno por casilla), games, sets, puntuación, desempate y saque |
| Dar acceso a un árbitro | Dile el **PIN** de su pista |
| Quitar el acceso a un teléfono | **Desvincular** (el teléfono vuelve a la pantalla del PIN) |
| Evitar que alguien más use un PIN que se ha visto | **Nuevo PIN** (el teléfono ya vinculado sigue funcionando) |
| Saber qué monitor es cada pantalla | **Identificar**: aparece "PANTALLA 1" en grande durante 6 s |
| Mostrar otro partido en una pantalla | Cambiar **Partido** en su tarjeta (las dos pantallas pueden mostrar el mismo) |
| Publicidad | Copiar archivos en `publicidad/…`, pulsar **Actualizar publicidad**, marcar los anuncios en cada pantalla y elegir el **Modo** |
| Entre partidos | Modo **Marcador + publicidad**: sin partido, la pantalla muestra la publicidad a pantalla completa |
| Si falla el teléfono de un árbitro | **Puntuar desde la estación** (desplegable de la pista) |
| Reabrir una pantalla cerrada | **Abrir ventana**, llevarla a su monitor y pulsar F11 |

## Avisos

| Aviso | Significado |
|---|---|
| ● verde "Marcador al día" | La pantalla ha dibujado el último marcador |
| ● rojo "Desincronizada" | La pantalla no ha dibujado el último marcador en 2 s: recárgala (clic en ella y F5) |
| ● rojo "Sin conexión" (pantalla) | La ventana de esa pantalla está cerrada o colgada: **Abrir ventana** |
| ● naranja "desconectado (hace X)" (teléfono) | El teléfono perdió la Wi-Fi o se bloqueó; se reconecta solo |
| "No se pudo mostrar: …" | Ese anuncio está dañado o en un formato no compatible: se salta automáticamente |
| "Hay 2 ventanas abiertas" | Cierra la ventana que sobra de esa pantalla |

---

# Parte 2 · Teléfono del árbitro

## Antes del partido

1. **Ajustes → Pantalla y brillo → Bloqueo automático → Nunca.**
2. **Modo avión + Wi-Fi activado**, conectado a la red del evento.
   (Android: si avisa de que la red "no tiene Internet", elegir *Mantener conexión*.)
3. Abrir la dirección que muestra la estación (ej. `http://192.168.0.121:3000`).
   Recomendado: *Compartir → Añadir a pantalla de inicio*.
4. Tocar **tu pista** y teclear el **PIN** que te da el operador.
5. Arriba aparece una barra de color: **CONTROLAS PISTA 1** (o 2). Compruébala
   siempre: es la pista cuyo marcador vas a cambiar.

Si recargas o se reinicia el teléfono, sigue vinculado: no hace falta el PIN otra vez.

## Configurar el partido (si no lo hizo la estación)

Jugadores (uno por casilla), games por set, sets, puntuación (Ventaja / Punto
de Oro / Punto Estrella), desempate y saque inicial → **INICIAR PARTIDO**.

## Durante el partido

| Botón | Cuándo |
|---|---|
| **PUNTO A / PUNTO B** | Al terminar cada punto |
| **DESHACER ÚLTIMA ACCIÓN** | Si te equivocas (dos toques: el primero pide confirmación) |
| **CAMBIAR SAQUE** | Solo si la pelota no coincide con quien saca |
| **Reiniciar / Finalizar** | Piden confirmación |
| **Cambiar de pista** | Deja de controlar esta pista (necesitarás el PIN para volver) |

## Si algo va mal

| Lo que ves | Qué hacer |
|---|---|
| Barra **roja "Desconectado"** | Espera sin pulsar: se reconecta solo. Los toques sin conexión **no** cuentan. |
| "Este teléfono ya no está vinculado" | El operador lo desvinculó u otro teléfono tomó la pista: pide el PIN. |
| "Pista ocupada… ¿reemplazarlo?" | Otro teléfono controla esa pista. Confirma solo si el otro teléfono ya no se usa. |
| "El marcador cambió desde otro dispositivo" | El operador puntuó desde la estación: revisa el marcador y sigue. |
| Pulsaste **Finalizar** por error | **Volver al marcador → Deshacer** |
