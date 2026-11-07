"""
voz.py — Narración del vídeo de presentación con una voz sintética (Piper, sin conexión)

    python3 marketing/presentacion/fuente/voz.py <piper> <modelo.onnx>

Lee narracion.json, genera una pista por escena en audio/ (WAV 48 kHz mono,
con un tratamiento de locución: graves limpios, presencia, compresión y nivel
de emisión) y guarda audio/duraciones.json, que el vídeo usa para que cada
escena dure lo que dura su frase.

Para cambiar a una voz grabada (tu voz, un locutor o una voz IA), deja en audio/
un archivo por escena con el mismo nombre (escena-intro.wav…) y vuelve a
ejecutar generar.js: las duraciones se miden de los archivos.
"""

import json
import subprocess
import sys
from pathlib import Path

DIR = Path(__file__).resolve().parent
AUDIO = DIR / 'audio'
AUDIO.mkdir(exist_ok=True)
piper, model = sys.argv[1], sys.argv[2]
data = json.loads((DIR / 'narracion.json').read_text(encoding='utf-8'))

# Locución: sin graves de fondo, algo de presencia, compresión suave, -16 LUFS
CHAIN = ('highpass=f=90,equalizer=f=200:t=q:w=1.2:g=-2,equalizer=f=3200:t=q:w=1.5:g=3,'
         'acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=2,'
         'aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=7')

durations = {}
for scene in data['escenas']:
    raw = AUDIO / f"raw-{scene['id']}.wav"
    out = AUDIO / f"escena-{scene['id']}.wav"
    subprocess.run([piper, '-m', model, '-f', str(raw), '--length-scale', '0.95', '--sentence-silence', '0.3',
                    '--noise-scale', '0.55', '--noise-w-scale', '0.35'],
                   input=scene['tts'].encode('utf-8'), check=True, capture_output=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-af', CHAIN, '-ac', '1', str(out)], check=True)
    raw.unlink()
    probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(out)],
                           check=True, capture_output=True, text=True)
    durations[scene['id']] = round(float(probe.stdout.strip()), 2)
    print(f"✅ {scene['id']}: {durations[scene['id']]} s")

(AUDIO / 'duraciones.json').write_text(json.dumps(durations, indent=2), encoding='utf-8')
print(f"Total de voz: {sum(durations.values()):.1f} s")
