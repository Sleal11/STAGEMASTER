# Colores de marca · EN ESPERA (no aplicados en la app)

Santiago decidió dejar los colores de la empresa en espera. La app sigue con su
paleta azul oscuro. Aquí está todo para retomarlo sin empezar de cero.

## Paleta de la marca (sacada de las imágenes que envió Santiago)

| Color | Código | Uso en la marca |
|---|---|---|
| Índigo de marca | `#3C40C4` | Fondo de los diseños índigo; títulos («ASIENTOS») |
| Índigo profundo | `#242888` · `#444490` | Logo sobre fondo claro |
| Azul cielo | `#3898F4` · `#3088E4` | «TIPO ESTADIO», «SUBEN DE NIVEL» |
| Azul real | `#1E5AC6` | Asiento del anuncio |
| Celeste | `#84D0FC` | Franjas |
| Fondo claro | `#F0F8FC` · `#E0F0F8` | Diseños claros |
| Amarillo | `#F9D207` | «LED», «NUMERADOS» |
| Blanco | `#FCFCFC` | Logo y textos sobre índigo |

## Opciones maquetadas

- **A · Índigo** (`indigo.css`): fondo índigo, logo blanco, celeste y amarillo.
- **B · Claro** (`claro.css`): fondo blanco azulado, logo índigo (`logo-indigo.png`,
  generado a partir del logo actual), azul cielo y botones índigo.
- Recomendación dada: **LED en índigo** (el blanco deslumbra en LED y se lee peor de
  lejos); estación y teléfono, A o B a elección. Pendiente también decidir si la
  Pista 2 pasa de naranja a amarillo de marca.

Los `.css` son capas de color encima del diseño actual (variables y algunos textos
que eran blancos fijos), probadas en todos los apartados. Al aplicarlo de verdad,
convertirlos en un tema de la app (variables en `shared.css`, `station.css`,
`score.css`, `control.css` y `desktop/remote/remote.css`) y revisar la matriz visual
(`tests/e2e/layout.e2e.js`) en LED XL, LED pequeña y monitores.

## Volver a generar las maquetas

```bash
node docs/desarrollo/maquetas-marca/maqueta.js      # capturas de la app real con cada tema
python3 docs/desarrollo/maquetas-marca/componer.py   # comparativas ACTUAL · A · B
```

Resultado en `tests/e2e/out/maqueta/` (`comparar-*.png`). Requiere Playwright con
Chromium (en Linux sin escritorio, Xvfb y `DISPLAY=:99`) y Pillow.
