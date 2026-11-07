"""
musica.py — Música original del vídeo de presentación (electrónica deportiva, sin derechos de terceros)

    python3 musica.py <linea.json> <salida.wav>

Sintetiza una pista de 120 BPM en La menor (Am · F · C · G) que sigue la línea
de tiempo del vídeo (audio/linea.json: inicio y fin de cada escena):
  intro      pad y arpegio que se abren, subida y golpe al aparecer el logo
  sistema…   bombo, hi-hats, bajo y acordes
  directo    a tope: palmas, arpegio, hi-hat abierto y acordes «stab»
  final      golpe en la celebración y el ritmo más alto
  cierre     solo el pad y un último golpe con el logo
Antes de cada escena con más energía hay una subida (ruido que se abre) y al
empezar, un golpe grave. Requiere numpy y scipy.
"""

import json
import sys
import wave

import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
BPM = 120
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)

timeline = json.load(open(sys.argv[1], encoding='utf-8'))
scenes = timeline['escenas']            # [{id, start, end}]
TOTAL = timeline['total'] + 2.5
N = int(TOTAL * SR)
t_all = np.arange(N) / SR

# Energía de cada escena (0 = ambiente … 3 = máximo)
LEVEL = {'intro': 0, 'sistema': 1, 'marcador': 1, 'configurar': 2, 'arbitro': 2, 'directo': 3, 'reglas': 2, 'final': 3, 'cierre': 0}


def level_at(t):
    for s in scenes:
        if s['start'] <= t < s['end']:
            return LEVEL.get(s['id'], 1)
    return 0


def note(name):
    names = {'C': -9, 'C#': -8, 'D': -7, 'D#': -6, 'E': -5, 'F': -4, 'F#': -3, 'G': -2, 'G#': -1, 'A': 0, 'A#': 1, 'B': 2}
    n, octave = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((names[n] + 12 * (octave - 4)) / 12)


# Am · F · C · G (un compás cada uno)
CHORDS = [
    (['A2'], ['A3', 'C4', 'E4'], ['A4', 'C5', 'E5', 'C5']),
    (['F2'], ['F3', 'A3', 'C4'], ['F4', 'A4', 'C5', 'A4']),
    (['C3'], ['C4', 'E4', 'G4'], ['C5', 'E5', 'G5', 'E5']),
    (['G2'], ['G3', 'B3', 'D4'], ['G4', 'B4', 'D5', 'B4']),
]

bus = {k: np.zeros(N) for k in ['kick', 'clap', 'hat', 'bass', 'pad', 'arp', 'fx', 'stab']}


def add(name, start, sig):
    i = int(start * SR)
    if i >= N or i + len(sig) <= 0:
        return
    j = min(N, i + len(sig))
    bus[name][i:j] += sig[: j - i]


def env(length, attack=0.005, decay=0.2):
    t = np.arange(int(length * SR)) / SR
    a = np.clip(t / attack, 0, 1)
    return a * np.exp(-t / decay)


def saw(freq, length, detune=(0.0,)):
    t = np.arange(int(length * SR)) / SR
    out = np.zeros_like(t)
    for d in detune:
        f = freq * (1 + d)
        phase = (t * f + rng.random()) % 1.0
        out += 2 * phase - 1
    return out / len(detune)


def lowpass(sig, cutoff, order=2):
    return sosfilt(butter(order, min(cutoff, SR / 2 - 100) / (SR / 2), 'low', output='sos'), sig)


def highpass(sig, cutoff, order=2):
    return sosfilt(butter(order, cutoff / (SR / 2), 'high', output='sos'), sig)


def bandpass(sig, lo, hi):
    return sosfilt(butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band', output='sos'), sig)


# ── Instrumentos ────────────────────────────────────────────────
def kick():
    t = np.arange(int(0.45 * SR)) / SR
    freq = 45 + 95 * np.exp(-t / 0.045)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    click = rng.standard_normal(len(t)) * np.exp(-t / 0.004) * 0.25
    return (np.sin(phase) * np.exp(-t / 0.28) + click) * 0.95


def clap():
    n = rng.standard_normal(int(0.35 * SR))
    e = np.zeros_like(n)
    t = np.arange(len(n)) / SR
    for k, off in enumerate([0, 0.011, 0.022]):
        e += (t >= off) * np.exp(-np.clip(t - off, 0, None) / (0.012 if k < 2 else 0.16))
    return bandpass(n * e, 900, 5200) * 0.55


def hat(open_=False):
    n = rng.standard_normal(int((0.28 if open_ else 0.06) * SR))
    return highpass(n, 7500, 4) * env(len(n) / SR, 0.001, 0.09 if open_ else 0.018) * (0.22 if open_ else 0.16)


def bass(freq, length):
    s = saw(freq, length, (0, 0.004)) + 0.6 * np.sin(2 * np.pi * freq * np.arange(int(length * SR)) / SR)
    return lowpass(s, 420) * env(length, 0.004, length * 0.9) * 0.55


def pad(freqs, length):
    t = np.arange(int(length * SR)) / SR
    s = sum(saw(f, length, (-0.006, 0, 0.007)) for f in freqs) / len(freqs)
    a = np.clip(t / 0.35, 0, 1) * np.clip((length - t) / 0.4, 0, 1)
    return lowpass(s, 2200) * a * 0.32


def pluck(freq, length=0.22, bright=5200):
    s = saw(freq, length, (0, 0.003))
    return lowpass(s, bright) * env(length, 0.002, 0.07) * 0.28


def stab(freqs):
    length = 0.32
    s = sum(saw(f, length, (-0.004, 0.005)) for f in freqs) / len(freqs)
    return lowpass(s, 3600) * env(length, 0.003, 0.1) * 0.35


def riser(length):
    n = rng.standard_normal(int(length * SR))
    t = np.arange(len(n)) / SR
    out = np.zeros_like(n)
    steps = 24
    for k in range(steps):           # ruido que se abre poco a poco (por tramos)
        a, b = int(k * len(n) / steps), int((k + 1) * len(n) / steps)
        cut = 400 + (9000 - 400) * (k / steps) ** 2
        out[a:b] = lowpass(n[a:b], cut)
    return out * (t / length) ** 2 * 0.35


def impact():
    t = np.arange(int(2.2 * SR)) / SR
    freq = 32 + 60 * np.exp(-t / 0.12)
    boom = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t / 0.7)
    noise = highpass(rng.standard_normal(len(t)), 3000) * np.exp(-t / 0.5) * 0.18
    return (boom * 0.9 + noise)


# ── Partitura ───────────────────────────────────────────────────
steps16 = int(TOTAL / (BEAT / 4))
for i in range(steps16):
    t = i * BEAT / 4
    if t >= timeline['total'] + 0.5:
        break
    lvl = level_at(t)
    beat_pos = i % 16           # posición dentro del compás (semicorcheas)
    chord = CHORDS[int(t // BAR) % 4]
    if beat_pos % 4 == 0 and lvl >= 1:
        add('kick', t, kick())
    if beat_pos in (4, 12) and lvl >= 2:
        add('clap', t, clap())
    if lvl >= 1 and beat_pos % 2 == 1:
        add('hat', t, hat())
    if lvl >= 3 and beat_pos % 4 == 2:
        add('hat', t, hat(open_=True))
    if lvl >= 1 and beat_pos % 2 == 1:          # bajo a contratiempo (empuja)
        add('bass', t, bass(note(chord[0][0]), BEAT / 2))
    if lvl >= 2 or (lvl == 0 and t < 12):
        arp = chord[2]
        bright = 1800 + 3400 * min(1, t / 10) if lvl == 0 else 5200
        add('arp', t, pluck(note(arp[i % 4]), bright=bright) * (0.6 if lvl == 0 else 1.0))
    if lvl >= 3 and beat_pos in (0, 6, 10):
        add('stab', t, stab([note(n) for n in chord[1]]))
    if beat_pos == 0:
        add('pad', t, pad([note(n) for n in chord[1]], BAR + 0.3) * (1.0 if lvl <= 1 else 0.75))

# Subidas antes de las escenas con más energía y golpes al empezar
for k, s in enumerate(scenes):
    if k == 0:
        add('fx', timeline.get('logoAt', 4.3) - 0.05, impact() * 0.8)     # aparece el logo
        continue
    prev = LEVEL.get(scenes[k - 1]['id'], 1)
    cur = LEVEL.get(s['id'], 1)
    if cur > prev or s['id'] in ('final',):
        add('fx', s['start'] - 2 * BEAT * 2, riser(4 * BEAT))
        add('fx', s['start'], impact() * 0.9)
    elif s['id'] == 'cierre':
        add('fx', s['start'] + 1.0, impact() * 0.8)

# ── Mezcla ──────────────────────────────────────────────────────
# Bombeo («sidechain»): pad, bajo y arpegio bajan un instante con cada bombo
duck = np.ones(N)
kick_env = np.abs(bus['kick'])
kick_env = lowpass(kick_env, 30)
duck = 1 - np.clip(kick_env * 1.6, 0, 0.7)


def reverb(sig, seconds=2.2, wet=0.25):
    ir_t = np.arange(int(seconds * SR)) / SR
    ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / (seconds / 5))
    ir = lowpass(ir, 6000)
    ir /= np.sqrt(np.sum(ir ** 2))
    return sig + wet * fftconvolve(sig, ir)[: len(sig)]


def delay(sig, seconds=BEAT * 0.75, feedback=0.35, mix=0.3):
    out = sig.copy()
    d = int(seconds * SR)
    echo = sig.copy()
    for _ in range(4):
        echo = np.concatenate([np.zeros(d), echo[:-d]]) * feedback
        out += echo * mix / feedback
    return out


mix = (bus['kick'] * 0.62 + bus['clap'] * 1.3 + bus['hat'] * 1.8
       + bus['bass'] * duck * 0.55 + reverb(bus['pad'] * duck, 2.6, 0.35) * 2.6
       + reverb(delay(bus['arp']), 1.8, 0.25) * duck * 2.6 + reverb(bus['stab'], 1.4, 0.3) * 2.0
       + reverb(bus['fx'], 2.5, 0.3) * 0.9)
# Entrada y salida suaves
fade_in = np.clip(t_all / 1.2, 0, 1)
fade_out = np.clip((TOTAL - t_all) / 2.5, 0, 1)
mix = mix * fade_in * fade_out
mix = mix / max(1e-9, np.percentile(np.abs(mix), 99.95))   # nivel antes de la saturación suave
mix = np.tanh(mix * 0.85) / np.tanh(0.85)
stereo = np.stack([mix, np.concatenate([np.zeros(int(0.012 * SR)), mix[: -int(0.012 * SR)]])], axis=1)
data = (stereo / max(1e-9, np.max(np.abs(stereo))) * 0.92 * 32767).astype(np.int16)
with wave.open(sys.argv[2], 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(data.tobytes())
print(f'✅ Música: {TOTAL:.1f} s → {sys.argv[2]}')
