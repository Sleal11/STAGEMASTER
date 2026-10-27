# StageMaster · Checklist del día del evento

## Antes

- [ ] `StageMaster.exe` copiado en el portátil del evento (y una copia en un USB).
- [ ] Abierto al menos una vez en ese portátil (aviso de Windows y Firewall ya aceptados).
- [ ] Publicidad PNG copiada con **📁 Carpeta de publicidad** y comprobada en las pantallas.
- [ ] Jugadores y formato de cada partido preparados.
- [ ] Comprobado que el portátil admite **dos monitores externos** a la vez (HDMI + USB-C/DisplayPort o dock).

## Material

- [ ] Portátil + cargador
- [ ] Cables para cada pantalla
- [ ] 2 teléfonos de árbitro + cargadores (y uno de respaldo)
- [ ] Ratón y regleta

## Montaje (≈ 10 min)

1. [ ] Conectar las pantallas al portátil y el portátil a la Wi-Fi del evento.
2. [ ] Portátil enchufado. Activar **"No molestar"** en Windows.
3. [ ] Abrir **StageMaster**. Las pantallas se abren solas en los monitores externos.
4. [ ] En la estación, **Identificar** cada pantalla. Si alguna está en el monitor
       equivocado, cambiarla en **Monitor**.
5. [ ] **Configurar partido** en cada pista; elegir en cada pantalla su partido,
       modo y publicidad.
6. [ ] Cada árbitro (bloqueo automático "Nunca", modo avión + Wi-Fi) escanea el
       **QR** de su pista y escribe el **PIN**. La estación debe mostrar
       "Teléfono conectado" en las dos pistas.
7. [ ] Prueba cruzada: un punto en la Pista 1 → **solo** cambia su pantalla.
       Deshacer. Repetir con la Pista 2.
8. [ ] Mirar las pantallas desde la posición del público.

## Si algo falla

Ver el botón **❔ Ayuda** de la estación ("Si algo falla"). Lo más habitual:

| Problema | Solución |
|---|---|
| Un teléfono no abre la página | Misma Wi-Fi que el portátil; en Windows la red debe ser **Privada**; Firewall permitido |
| Pantalla "Sin conexión" | **Abrir ventana** en su tarjeta |
| Se cerró StageMaster / corte de luz | Volver a abrirlo: todo se recupera solo |
| Diagnóstico de red | En el teléfono, abrir `http://IP-DEL-PORTÁTIL:3000/health` → debe responder `"ok":true` |
