# StageMaster · Resoluciones de las pantallas LED

## Dos resoluciones distintas

| | Qué es | Dónde se cambia |
|---|---|---|
| **Del monitor** (señal) | El modo que el portátil envía por el cable: ancho × alto **@ Hz** (p. ej. 1920 × 1080 @ 60 Hz) | Windows, o StageMaster → *Salida* → «Cambiar resolución del monitor…» |
| **De la pantalla LED** (formato) | La zona que ocupan los módulos dentro de esa señal (p. ej. 832 × 416 empezando en 0, 0) | StageMaster → *Salida* → *Formato* (fijo, **personalizado** o **guardado**) |

La tarjeta emisora LED (NovaStar, Colorlight, Linsn…) recibe la señal entera (1920 × 1080) y
recorta la zona de los módulos. Por eso lo normal es: **monitor a 1920 × 1080 @ 60 Hz** y en
StageMaster el **formato** del tamaño exacto del LED en la posición que tenga configurada la tarjeta.

### Píxeles reales y escalado de Windows

Windows puede «escalar» un monitor (125 %, 150 %…). Entonces una ventana de 1536 × 864 «de
Windows» ocupa en realidad 1920 × 1080 píxeles. StageMaster mide los formatos LED en **píxeles
reales** y compensa el escalado: un formato de 832 × 416 ocupa siempre 832 × 416 LEDs.
*Salida* muestra los dos datos («1920 × 1080 px reales · escala 125 %»).

## En StageMaster

- **Formato personalizado**: *Salida* → *Formato* → «Personalizado (ancho × alto)» y escribe el
  tamaño (16‑7680 × 16‑4320). **Guardar formato** le pone nombre («LED pista central») para
  elegirlo en otras pantallas. Si se borra, las pantallas que lo usaban se quedan igual.
- **Aviso si no cabe**: si el formato y su posición se salen del monitor, la tarjeta lo indica.
- **Diagnóstico del monitor** (*Salida* → *Resolución*): nombre del monitor que da Windows,
  resolución real, frecuencia (Hz) y escalado, con aviso si la frecuencia no es 50/60 Hz.
- **Cambiar resolución del monitor…** (Windows, monitores externos): lista **solo los modos que el
  monitor admite** (los que da su EDID). Al elegir uno:
  1. Windows lo comprueba antes (modo *test*, sin cambiar nada).
  2. Se aplica **sin guardar**.
  3. Si no pulsas **Mantener** en 15 s (p. ej. porque la pantalla se quedó en negro), **vuelve solo**
     al anterior. Con *Mantener* se guarda como definitivo.
  La pantalla del portátil (donde está la estación) no se cambia desde aquí.

## El caso 1920 × 1120 (parpadeo)

Windows (y StageMaster) solo pueden poner los modos que el **controlador de la tarjeta gráfica**
acepta para ese monitor, y los acepta según el **EDID**: la «ficha técnica» que envía el monitor o,
con LED, la **tarjeta emisora**. 1920 × 1120 no es un modo estándar: si se fuerza sin que el EDID
lo anuncie, la tarjeta emisora recibe una señal que no espera y **parpadea** o pierde la imagen.

Qué hacer, de más a menos recomendable:

1. **No hace falta 1920 × 1120** casi nunca: deja el monitor en **1920 × 1080 @ 60 Hz** y usa en
   StageMaster un **formato personalizado** del tamaño del LED. Si el LED es más alto que 1080
   (p. ej. 1120 filas), configura en la tarjeta emisora una zona de **dos columnas** o usa una
   resolución estándar mayor (1920 × 1200, 2560 × 1440) si la tarjeta la admite.
2. **EDID de la tarjeta emisora**: en NovaLCT (NovaStar) → *Display Control* / *EDID*, o en el
   programa de tu marca, se puede elegir o crear el EDID con la resolución que necesitas. Después
   esa resolución aparecerá en «Cambiar resolución del monitor…».
3. **Resolución personalizada en la tarjeta gráfica**:
   - NVIDIA: Panel de control → *Cambiar resolución* → *Personalizar* → *Crear resolución personalizada*.
   - AMD: Software Adrenalin → *Pantalla* → *Resoluciones personalizadas*.
   - Intel: Centro de comandos de gráficos Intel → *Pantalla* → *Personalizado*.
   - Cualquier tarjeta: **CRU** (Custom Resolution Utility) añade el modo al EDID del monitor.
   Usa **60 Hz** y los tiempos «CVT‑RB» (reduced blanking). Prueba siempre con la pantalla a la
   vista: si parpadea, ese modo no lo acepta la tarjeta emisora.
4. Si nada de lo anterior es posible, la resolución que mejor funciona es la **nativa del EDID**
   (la marcada como «Recomendada» en Windows).

## Lo que necesitamos para ajustar vuestras pantallas

1. **Tamaño en píxeles de cada LED** (ancho × alto de módulos × píxeles por módulo).
2. **Marca y modelo de la tarjeta emisora / procesador** y el programa con el que se configura.
3. La **resolución de entrada** que tiene configurada la tarjeta emisora y la **posición** de la
   zona del LED dentro de la señal (normalmente 0, 0).
4. Una captura de *Configuración de pantalla* de Windows con el LED conectado.
