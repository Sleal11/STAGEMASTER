# StageMaster · Checklist del día del evento

## Antes

- [ ] `StageMaster.exe` copiado en el portátil del evento (y una copia en un USB).
- [ ] Abierto al menos una vez en ese portátil (aviso de Windows y Firewall ya aceptados).
- [ ] Publicidad copiada con **Carpeta de publicidad**:
      `banner` (cinta: PNG/logos) y `pantalla-completa` (imágenes y vídeos MP4 H.264 en 2:1, ej. 1664 × 832).
- [ ] Vídeos probados en StageMaster (si alguno no se reproduce, la estación lo avisa).
- [ ] Jugadores y formato de cada partido preparados.
- [ ] Comprobado que el portátil admite **dos salidas de vídeo** a la vez (HDMI + USB-C/DisplayPort o dock).
- [ ] Tamaño de cada pantalla LED anotado (XL 832 × 416 / pequeña 416 × 208) y en qué píxel empieza
      en el controlador de la LED (normalmente 0, 0).

## Material

- [ ] Portátil + cargador
- [ ] Cables para cada pantalla (y el del controlador LED)
- [ ] 2 teléfonos de árbitro + cargadores (y uno de respaldo)
- [ ] Ratón y regleta
- [ ] Altavoces o salida de audio (solo si los vídeos llevan sonido)

## Montaje (≈ 10 min)

1. [ ] Conectar las pantallas al portátil y el portátil a la Wi-Fi del evento.
2. [ ] Portátil enchufado. Activar **"No molestar"** en Windows.
3. [ ] Abrir **StageMaster**. Las pantallas se abren solas en los monitores externos.
4. [ ] En la estación, **Identificar** cada pantalla. Si alguna está en el monitor
       equivocado, cambiarla en **Salida → Monitor**.
5. [ ] Pantallas LED: en **Salida → Formato** elegir **LED XL 832 × 416** o **LED pequeño
       416 × 208** y comprobar con **Identificar** que la LED muestra el tamaño correcto.
6. [ ] **Configurar partido** en cada pista; en cada pantalla elegir su partido,
       la **Cinta** y la **Lista de reproducción**.
7. [ ] Decidir si se activa **Publicidad al terminar el partido** (pestaña Contenido).
8. [ ] Cada árbitro (bloqueo automático "Nunca", modo avión + Wi-Fi) escanea el
       **QR** de su pista y escribe el **PIN**. La estación debe mostrar
       "conectado" en las dos pistas.
9. [ ] Prueba cruzada: un punto en la Pista 1 → **solo** cambia su pantalla.
       Deshacer. Repetir con la Pista 2.
10. [ ] Probar **Publicidad y vídeos** → **Detener** en cada pantalla.
11. [ ] Mirar las pantallas desde la posición del público.

## Si algo falla

Ver el botón **Ayuda** de la estación ("Si algo falla"). Lo más habitual:

| Problema | Solución |
|---|---|
| Un teléfono no abre la página | Misma Wi-Fi que el portátil; en Windows la red debe ser **Privada**; Firewall permitido |
| Pantalla "Sin conexión" | **Abrir ventana** en su tarjeta |
| La LED se ve cortada o con bordes | **Salida → Formato** LED correcto y posición del controlador |
| Un vídeo no se ve | Convertirlo a MP4 (H.264); la estación indica cuál falla y se salta |
| Se cerró StageMaster / corte de luz | Volver a abrirlo: todo se recupera solo |
| Diagnóstico de red | En el teléfono, abrir `http://IP-DEL-PORTÁTIL:3000/health` → debe responder `"ok":true` |
