'use strict';

/**
 * ─────────────────────────────────────────────────────────────────
 * STAGEMASTER — SIMULADOR DE PARTIDO ("operador virtual")
 * Archivo: tools/simulate-match.js
 *
 * Se conecta al servidor como si fuera un iPhone y juega un partido
 * punto a punto, a un ritmo configurable. Sirve para:
 *   - Mirar la pantalla LED REAL durante un partido entero sin pulsar nada
 *   - Pruebas de duración (dejarlo horas y comprobar que nada se degrada)
 *   - Probar a la vez con el iPhone: si el operador real también pulsa,
 *     el control de versiones evita que se pisen
 *
 * Uso (con el servidor ya arrancado):
 *   npm run simulate
 *   npm run simulate -- --interval 1000
 *   npm run simulate -- --url http://192.168.0.121:3000 --new --sets 5 --scoring starPoint
 *
 * Opciones:
 *   --url <dirección>     Servidor (por defecto http://localhost:3000)
 *   --interval <ms>       Tiempo entre puntos (por defecto 2500)
 *   --new                 Empieza un partido nuevo aunque haya uno en curso
 *   --sets <1|3|5>        Sets del partido nuevo (por defecto 3)
 *   --games <1-6>         Games por set (por defecto 6)
 *   --scoring <advantage|goldenPoint|starPoint>   (por defecto advantage)
 *   --tiebreak <tiebreak|superTiebreak|none>      (por defecto superTiebreak)
 *
 * Si ya hay un partido en curso (iniciado desde el iPhone) y no se pasa
 * --new, el simulador lo CONTINÚA. Ctrl+C lo detiene en cualquier momento.
 * ─────────────────────────────────────────────────────────────────
 */

const { io } = require('socket.io-client');

// ─────────────────────────────────────────────────────────────────
// OPCIONES DE LA LÍNEA DE COMANDOS
// ─────────────────────────────────────────────────────────────────

function readOptions(argv) {
  const get = (name, fallback) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
  };
  return {
    url:      get('url', 'http://localhost:3000'),
    interval: Math.max(100, Number(get('interval', 2500)) || 2500),
    forceNew: argv.includes('--new'),
    config: {
      nameA:         'Simulación A',
      nameB:         'Simulación B',
      totalSets:     Number(get('sets', 3)),
      gamesPerSet:   Number(get('games', 6)),
      scoringSystem: get('scoring', 'advantage'),
      tiebreakType:  get('tiebreak', 'superTiebreak'),
      initialServer: 'A',
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// PRESENTACIÓN EN CONSOLA
// ─────────────────────────────────────────────────────────────────

/** Una línea legible del marcador, ej: "Set 2 | A 40 · 3 · 1  —  B 15 · 2 · 0 | saca A" */
function describe(state) {
  const p   = state.players;
  const tag = state.phase === 'normal' ? '' : ` [${state.phase === 'tiebreak' ? 'TIE BREAK' : 'SUPER TB'}]`;
  const set = state.status === 'finished' ? 'FINAL' : `Set ${state.currentSet}${tag}`;
  return `${set} | ` +
    `${p.A.name} ${p.A.points} · ${p.A.games} · ${p.A.sets}  —  ` +
    `${p.B.name} ${p.B.points} · ${p.B.games} · ${p.B.sets} | saca ${state.server}`;
}

function formatSets(state) {
  return state.setScores.map((s) => (s.superTiebreak
    ? `STB ${s.tiebreak.A}-${s.tiebreak.B}`
    : `${s.A}-${s.B}${s.tiebreak ? ` (${s.tiebreak.A}-${s.tiebreak.B})` : ''}`)).join('  ');
}

// ─────────────────────────────────────────────────────────────────
// SIMULACIÓN
// ─────────────────────────────────────────────────────────────────

/**
 * Elige la siguiente acción como en un partido real:
 *   - El que saca gana algo más de la mitad de los puntos (ventaja del saque)
 *   - De vez en cuando el "operador" se equivoca y deshace (2 %)
 */
function nextAction(state) {
  if (Math.random() < 0.02 && state.canUndo) return 'undo';
  const serverWins = Math.random() < 0.58;
  const winner     = serverWins ? state.server : (state.server === 'A' ? 'B' : 'A');
  return 'point' + winner;
}

function main() {
  const options = readOptions(process.argv.slice(2));
  const socket  = io(options.url, { reconnectionDelayMax: 2000 });

  let state     = undefined;
  let timer     = null;
  let busy      = false;
  let started   = false;
  let actions   = 0;
  const startAt = Date.now();

  console.log(`\n🎾 Simulador StageMaster → ${options.url} (un punto cada ${options.interval} ms)`);
  console.log('   Ctrl+C para detener.\n');

  socket.on('connect', () => console.log('🟢 Conectado al servidor'));
  socket.on('disconnect', (reason) => {
    // 'io client disconnect' = lo cerramos nosotros al terminar: no es un fallo
    if (reason !== 'io client disconnect') console.log('🔴 Desconectado. Reconectando...');
  });
  socket.on('connect_error', (err) => {
    if (!started) console.log(`⚠  No se puede conectar a ${options.url} (${err.message}). ¿Está el servidor arrancado?`);
  });

  socket.on('matchUpdate', async (newState) => {
    state = newState;

    // Primera vez: decidir si continuar el partido actual o crear uno nuevo
    if (!started) {
      started = true;
      if (!state || state.status === 'finished' || options.forceNew) {
        const res = await socket.timeout(3000).emitWithAck('setupMatch', { config: options.config, force: true });
        if (!res.ok) {
          console.log(`❌ No se pudo crear el partido: ${res.message}`);
          process.exit(1);
        }
        console.log('▶  Partido nuevo creado');
      } else {
        console.log('▶  Continuando el partido en curso');
      }
      timer = setInterval(tick, options.interval);
    }
  });

  async function tick() {
    if (busy || !socket.connected || !state) return;

    if (state.status === 'finished') {
      clearInterval(timer);
      const minutes = ((Date.now() - startAt) / 60000).toFixed(1);
      const winner  = state.winner ? state.players[state.winner].name : 'sin ganador';
      console.log(`\n🏆 Partido terminado: gana ${winner}  |  ${formatSets(state)}`);
      console.log(`   ${actions} acciones en ${minutes} min\n`);
      socket.disconnect();
      return;
    }

    busy = true;
    const accion = nextAction(state);
    try {
      const res = await socket.timeout(3000).emitWithAck(accion, { version: state.version });
      actions++;
      if (res.ok) {
        // El estado nuevo llega por 'matchUpdate'; esperamos un instante para mostrarlo
        setTimeout(() => console.log(`${accion.padEnd(7)} → ${describe(state)}`), 30);
      } else if (res.code === 'STALE_VERSION') {
        console.log('↻  El marcador cambió desde otro dispositivo (iPhone): se reintenta');
      } else {
        console.log(`⚠  ${accion} rechazado: ${res.message}`);
      }
    } catch (err) {
      console.log(`⚠  Sin respuesta del servidor (${err.message})`);
    } finally {
      busy = false;
    }
  }

  process.on('SIGINT', () => {
    console.log('\n⏹  Simulación detenida. El partido queda tal cual en el servidor.\n');
    socket.disconnect();
    process.exit(0);
  });
}

main();
