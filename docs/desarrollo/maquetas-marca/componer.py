from PIL import Image, ImageDraw, ImageFont
import sys, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'tests', 'e2e', 'out', 'maqueta'))
F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
NAMES = [('actual', 'ACTUAL'), ('indigo', 'A · ÍNDIGO'), ('claro', 'B · CLARO')]
def compose(section, scale=1.0, out=None, crop=None):
    ims = []
    for tid, label in NAMES:
        im = Image.open(f'{tid}-{section}.png').convert('RGB')
        if crop: im = im.crop(crop)
        if scale != 1: im = im.resize((int(im.width*scale), int(im.height*scale)), Image.LANCZOS)
        ims.append((label, im))
    w = max(i.width for _, i in ims); h = max(i.height for _, i in ims)
    gap, top = 24, 56
    canvas = Image.new('RGB', (w*3 + gap*4, h + top + gap), (255, 255, 255))
    d = ImageDraw.Draw(canvas)
    for n, (label, im) in enumerate(ims):
        x = gap + n*(w+gap)
        d.text((x, 12), label, fill=(30, 34, 112), font=F)
        canvas.paste(im, (x, top))
    canvas.save(out or f'comparar-{section}.png')
for s, sc in [('led-xl-juego', 1), ('led-xl-ganador', 1), ('led-sm', 2), ('telefono-pin', 0.5), ('telefono-partido', 0.5)]:
    compose(s, sc)
for s in ['estacion-panel', 'estacion-pantallas', 'estacion-envivo', 'estacion-historial']:
    compose(s, 0.62)
print('ok')
