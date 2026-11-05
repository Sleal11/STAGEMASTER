# StageMaster · Checklist del día del evento

## Antes

- [ ] `StageMaster.exe` copiado en el portátil del evento (y una copia en un USB).
- [ ] Abierto al menos una vez en ese portátil (aviso de Windows y Firewall ya aceptados; si sale el
      aviso rojo de los teléfonos, **Permitir teléfonos**). Un teléfono probado escaneando el QR.
- [ ] Publicidad subida con **Subir archivos…** (pestañas *Cinta* y *Lista de reproducción*):
      cinta (PNG/logos y vídeos cortos) y pantalla completa (imágenes y vídeos MP4 H.264 en 2:1, ej. 1664 × 832).
- [ ] Vídeos probados en StageMaster (si alguno no se reproduce, la estación lo avisa).
- [ ] Jugadores y formato de cada partido preparados.
- [ ] Comprobado que el portátil tiene **una salida de vídeo por pantalla** (HDMI + USB-C/DisplayPort o dock).
- [ ] Tamaño de cada pantalla LED anotado (XL 832 × 416 / pequeña 416 × 208 / otro: formato
      **personalizado** guardado con nombre) y en qué píxel empieza en el controlador (normalmente 0, 0).
- [ ] Monitor de cada LED a **1920 × 1080 a 60 Hz** (Salida → Resolución; ver `docs/RESOLUCIONES.md`).
- [ ] Pistas lejos del portátil: **portátil remoto** ya enlazado con el código y red probada
      (cable de red mejor que Wi-Fi; ver `docs/VARIAS-PANTALLAS.md`).

## Material

- [ ] Portátil + cargador
- [ ] Cables para cada pantalla (y el del controlador LED)
- [ ] Portátiles remotos + cargadores, cable de red / switch (si hay pistas lejos)
- [ ] 2 teléfonos de árbitro + cargadores (y uno de respaldo)
- [ ] Ratón y regleta
- [ ] Altavoces o salida de audio (solo si los vídeos llevan sonido)

## Montaje (≈ 10 min)

1. [ ] Conectar las pantallas al portátil y el portátil a la Wi-Fi del evento.
2. [ ] Portátil enchufado. Activar **"No molestar"** en Windows.
3. [ ] Abrir **StageMaster**. Las pantallas se abren solas en los monitores externos.
4. [ ] En la estación, **Identificar** cada pantalla. Si alguna está en el monitor
       equivocado, cambiarla en **Salida → Monitor**.
5. [ ] Pantallas LED: en **Salida → Formato** elegir **Personalizado** con el tamaño de la LED
       (ej. 832 × 416 o 416 × 208; o un formato guardado) y comprobar con **Identificar** que la LED muestra el tamaño correcto.
6. [ ] **Configurar partido** en cada pista; en cada pantalla elegir su partido,
       la **Cinta** y la **Lista de reproducción**.
7. [ ] Decidir la **publicidad en la pausa** y **al terminar el partido** (pestaña Contenido).
       Si dos LED deben verse igual, la segunda como **espejo** (Contenido → Origen).
7b. [ ] Portátiles remotos: abrir StageMaster en cada uno; en la estación, *Portátiles remotos*
       debe mostrarlos **Conectados** y qué pantalla muestra cada uno.
8. [ ] Cada árbitro (bloqueo automático "Nunca", modo avión + Wi-Fi) escanea el
       **QR único** y escribe el **código de su pista**. La estación debe mostrar
       "conectado" en las dos pistas.
9. [ ] Prueba cruzada: un punto en la Pista 1 → **solo** cambia su pantalla.
       Deshacer. Repetir con la Pista 2.
10. [ ] Probar **Publicidad y vídeos** → **Detener** en cada pantalla.
11. [ ] Mirar las pantallas desde la posición del público.

## Si algo falla

Ver el botón **Ayuda** de la estación ("Si algo falla"). Lo más habitual:

| Problema | Solución |
|---|---|
| Un teléfono no abre la página («el servidor no responde») | Misma Wi-Fi que indica «Acceso de los árbitros» (no datos móviles ni red de invitados); si la estación muestra el aviso rojo, **Permitir teléfonos**; o escribir la dirección que aparece junto al QR |
| Pantalla "Sin conexión" | **Abrir ventana** en su tarjeta |
| La LED se ve cortada o con bordes | **Salida → Formato** LED correcto y posición del controlador |
| El marcador llena la LED pero la publicidad sale cortada o con bandas | **Salida → Publicidad: Automático** (o «Estirar siempre»): ocupa lo mismo que el marcador |
| Un vídeo no se ve | Convertirlo a MP4 (H.264); la estación indica cuál falla y se salta |
| Se cerró StageMaster / corte de luz | Volver a abrirlo: todo se recupera solo |
| La LED parpadea | Monitor a 1920 × 1080 a 60 Hz (Salida → Cambiar resolución del monitor…) |
| Portátil remoto «Reconectando…» | Cable o Wi-Fi y StageMaster abierto en el principal; la pantalla mantiene la imagen |
| Diagnóstico de red | En el teléfono, abrir `http://IP-DEL-PORTÁTIL:3000/health` → debe responder `"ok":true` |
