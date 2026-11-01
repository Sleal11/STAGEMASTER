# StageMaster · Brillo de las pantallas LED

Hay tres "brillos" distintos. StageMaster solo puede controlar los que tiene a su alcance:

| Brillo | Qué cambia | ¿Lo controla StageMaster? |
|---|---|---|
| **De la imagen** | Lo luminosa que es la imagen que envía StageMaster por el cable (HDMI/DisplayPort) | **Sí**: pestaña *Salida* → *Brillo de la imagen*, por pantalla, sin reiniciar, con transición suave y se guarda |
| **Físico de los módulos LED** | La corriente de los LED (lo que de verdad ilumina) | **Todavía no**: lo controla el **procesador / tarjeta emisora LED** (ver abajo) |
| Pantalla del portátil | Solo la pantalla del portátil | No interesa (Windows) |

## Brillo de la imagen (ya disponible)

- Útil para bajar un poco la intensidad (de noche, interiores) sin tocar el procesador.
- Limitación: reduce la imagen, no la corriente de los LED. Por debajo del 40-50 % se pierden
  tonos (gradación) y los colores oscuros se aplastan. Para bajadas grandes, mejor el brillo físico.

## Brillo físico (necesita el procesador LED)

El brillo físico se ajusta en el **procesador o tarjeta emisora** que recibe la señal del portátil
(la caja a la que va el cable HDMI de la pantalla LED). Cada fabricante usa su propio programa y
protocolo, por ejemplo:

- **NovaStar** (MCTRL, VX, TB…): programa NovaLCT / SmartLCT / ViPlex; conexión USB, serie o red según el modelo.
- **Colorlight** (S, X, Z, A…): programa LEDVISION / iSet.
- **Linsn**: LEDStudio.

Para que StageMaster controle el brillo físico necesito:

1. **Marca y modelo exactos** del procesador o tarjeta emisora (está en la etiqueta del equipo).
2. **Cómo se conecta** al portátil para configurarlo: USB, cable serie (RS-232) o red (Ethernet).
3. **Qué programa** usáis hoy para ajustarlo (NovaLCT, LEDVISION…).
4. Si el fabricante os dio **documentación o SDK** (protocolo de control).
5. Poder hacer una prueba conectado al equipo real.

Con eso se añade un "controlador" para ese modelo y en la pestaña *Salida* aparece **Brillo de los
módulos LED**, que envía la orden al procesador y comprueba que la ha aplicado. Hasta entonces no se
muestra ese control: StageMaster no simula un brillo físico que no puede comprobar.
