'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#9aa0a6', // N - tuerca (gris metálico)
  '#37474f', // B - bomba (gris carbón)
  '#283593', // R - rayo (índigo oscuro)
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N - tuerca (centro hueco)
  [[9]],                                       // B - bomba (power-up, 1×1)
  [[10]],                                      // R - rayo (power-up, 1×1)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const COMBO_MAX_MULT = 5;   // tope del multiplicador de combo
const POPUP_MS = 900;       // duración del texto flotante de combo
const COMBO_COLORS = { 2: '#ffd54f', 3: '#ffb74d', 4: '#e57373', 5: '#ba68c8' };

const NUT_TYPE = 8;        // tuerca
const NUT_CHANCE = 1 / 15; // reto: ~1 de cada 15 piezas

const BOMB_TYPE = 9;             // power-up: bomba
const RAYO_TYPE = 10;            // power-up: rayo
const POWER_LINES = 10;          // aparece un power-up cada 10 líneas (bomba y rayo alternan)
const BOMB_SCORE_PER_BLOCK = 50; // puntos por bloque destruido por la bomba (× level)
const RAYO_SCORE_PER_BLOCK = 50; // puntos por bloque destruido por el rayo (× level)
const BLAST_MS = 300;            // duración del destello de la explosión

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const soundToggle = document.getElementById('sound-toggle');
const comboEl = document.getElementById('combo');

const THEME_KEY = 'tetris-theme';
const SOUND_KEY = 'tetris-sound';

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let powerPending, nextPowerLines, nextPowerType, blasts;
let combo, comboMax, popups, hudMult;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  let type;
  if (powerPending) {
    type = powerPending;
    powerPending = null;
  } else if (Math.random() < NUT_CHANCE) {
    type = NUT_TYPE;
  } else {
    type = Math.floor(Math.random() * 7) + 1;
  }
  const shape = PIECES[type].map(row => [...row]);
  const dir = type === RAYO_TYPE ? (Math.random() < 0.5 ? 'h' : 'v') : null;
  return { type, shape, dir, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  if (current.type === RAYO_TYPE) {
    current.dir = current.dir === 'h' ? 'v' : 'h';
    sfxRotate();
    return;
  }
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      sfxRotate();
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function comboMult() {
  return Math.max(1, Math.min(combo, COMBO_MAX_MULT));
}

function clearLines(isPowerUp) {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    combo++;
    comboMax = Math.max(comboMax, combo);
    const mult = comboMult();
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level * mult;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    if (lines >= nextPowerLines) {
      powerPending = nextPowerType;
      nextPowerType = nextPowerType === BOMB_TYPE ? RAYO_TYPE : BOMB_TYPE;
      nextPowerLines = (Math.floor(lines / POWER_LINES) + 1) * POWER_LINES;
    }
    if (mult >= 2) {
      popups.push({ text: 'COMBO x' + mult, color: COMBO_COLORS[mult] || '#ba68c8', t: performance.now() });
      sfxCombo(mult);
    } else {
      sfxLine(cleared);
    }
  } else if (!isPowerUp) {
    // una pieza normal que no limpia líneas rompe la cadena; los power-ups la congelan
    combo = 0;
  }
  updateHUD();
}

function collapseColumn(c) {
  let write = ROWS - 1;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (!board[r][c]) continue;
    board[write][c] = board[r][c];
    if (write !== r) board[r][c] = 0;
    write--;
  }
}

function explode(cx, cy) {
  let destroyed = 0;
  for (let r = cy - 1; r <= cy + 1; r++) {
    for (let c = cx - 1; c <= cx + 1; c++) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      if (board[r][c]) { board[r][c] = 0; destroyed++; }
    }
  }
  for (let c = Math.max(0, cx - 1); c <= Math.min(COLS - 1, cx + 1); c++)
    collapseColumn(c);
  score += destroyed * BOMB_SCORE_PER_BLOCK * level;
  blasts.push({ x: cx - 1, y: cy - 1, w: 3, h: 3, color: '#ffb74d', t: performance.now() });
  sfxBlast('bomb');
}

function strike(x, y, dir) {
  let destroyed = 0;
  if (dir === 'h') {
    for (let c = 0; c < COLS; c++) if (board[y][c]) destroyed++;
    board.splice(y, 1);
    board.unshift(new Array(COLS).fill(0));
    blasts.push({ x: 0, y, w: COLS, h: 1, color: '#ffee58', t: performance.now() });
  } else {
    for (let r = 0; r < ROWS; r++) {
      if (board[r][x]) { board[r][x] = 0; destroyed++; }
    }
    blasts.push({ x, y: 0, w: 1, h: ROWS, color: '#ffee58', t: performance.now() });
  }
  score += destroyed * RAYO_SCORE_PER_BLOCK * level;
  sfxBlast('rayo');
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  const type = current.type;
  const isPowerUp = type === BOMB_TYPE || type === RAYO_TYPE;
  const bx = current.x, by = current.y, bdir = current.dir;
  merge();
  sfxLock();
  if (type === BOMB_TYPE) explode(bx, by);
  else if (type === RAYO_TYPE) strike(bx, by, bdir);
  clearLines(isPowerUp);
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
    return;
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  const mult = comboMult();
  comboEl.textContent = 'x' + mult;
  comboEl.style.color = mult >= 2 ? (COMBO_COLORS[mult] || '#ba68c8') : '';
  if (mult > hudMult) {
    comboEl.classList.remove('combo-pulse');
    void comboEl.offsetWidth;
    comboEl.classList.add('combo-pulse');
  }
  hudMult = mult;
}

function isLightTheme() {
  return document.body.classList.contains('light-theme');
}

/* ---- Audio (WebAudio sintetizado, sin ficheros) ---- */
let audioCtx = null, soundOn = true;

function audio() {
  if (!soundOn) return null;
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch (e) {
    return null;
  }
}

function tone(freq, dur, type, vol, delay) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + (delay || 0);
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type || 'square';
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol ?? 0.15, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur, vol) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime;
  const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1200, t0);
  filter.frequency.exponentialRampToValueAtTime(200, t0 + dur);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(vol ?? 0.25, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(gain).connect(ac.destination);
  src.start(t0);
  src.stop(t0 + dur);
}

function sweep(fromFreq, toFreq, dur, vol) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(fromFreq, t0);
  osc.frequency.exponentialRampToValueAtTime(toFreq, t0 + dur);
  gain.gain.setValueAtTime(vol ?? 0.18, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function sfxRotate() { tone(440, 0.05, 'square', 0.08); }
function sfxLock() { tone(120, 0.09, 'triangle', 0.14); }

function sfxLine(cleared) {
  const base = [392, 494, 587, 784]; // sol, si, re, sol
  for (let i = 0; i <= cleared && i < base.length; i++)
    tone(base[i], 0.12, 'triangle', 0.12, i * 0.05);
}

function sfxCombo(mult) {
  const base = [523, 659, 784]; // do, mi, sol
  base.forEach((f, i) => tone(f, 0.1, 'triangle', 0.1, i * 0.04));
  tone(440 * Math.pow(2, (mult - 1) / 4), 0.22, 'square', 0.13, base.length * 0.04);
}

function sfxBlast(kind) {
  if (kind === 'rayo') sweep(1400, 200, 0.25, 0.16);
  else noise(0.35, 0.28);
}

function sfxGameOver() {
  [523, 440, 349, 262].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.14, i * 0.16));
}

function drawBlock(context, x, y, colorIndex, size, alpha, dir) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = isLightTheme() ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  if (colorIndex === BOMB_TYPE) {
    const cx = x * size + size / 2;
    const cy = y * size + size / 2 + size * 0.06;
    context.fillStyle = 'rgba(255,255,255,0.85)';
    context.beginPath();
    context.arc(cx, cy, size * 0.28, 0, Math.PI * 2);
    context.fill();
    // mecha
    context.strokeStyle = '#ffb74d';
    context.lineWidth = Math.max(1, size * 0.06);
    context.beginPath();
    context.moveTo(cx + size * 0.12, cy - size * 0.24);
    context.lineTo(cx + size * 0.24, cy - size * 0.4);
    context.stroke();
  }
  if (colorIndex === RAYO_TYPE) {
    const px = x * size, py = y * size;
    // línea que marca la orientación (fila o columna afectada)
    context.fillStyle = 'rgba(255,238,88,0.35)';
    if (dir === 'v') context.fillRect(px + size / 2 - 2, py + 1, 4, size - 2);
    else context.fillRect(px + 1, py + size / 2 - 2, size - 2, 4);
    // icono de rayo centrado
    context.fillStyle = '#ffd54f';
    context.beginPath();
    context.moveTo(px + size * 0.58, py + size * 0.14);
    context.lineTo(px + size * 0.30, py + size * 0.56);
    context.lineTo(px + size * 0.48, py + size * 0.56);
    context.lineTo(px + size * 0.40, py + size * 0.86);
    context.lineTo(px + size * 0.70, py + size * 0.44);
    context.lineTo(px + size * 0.52, py + size * 0.44);
    context.closePath();
    context.fill();
  }
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = isLightTheme() ? '#d8d8e4' : '#22222e';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // destello de explosiones activas
  if (blasts.length) {
    const now = performance.now();
    blasts = blasts.filter(b => now - b.t < BLAST_MS);
    for (const b of blasts) {
      const p = (now - b.t) / BLAST_MS;
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = p < 0.5 ? '#fff3e0' : b.color;
      ctx.fillRect(b.x * BLOCK, b.y * BLOCK, b.w * BLOCK, b.h * BLOCK);
      ctx.globalAlpha = 1;
    }
  }

  // fantasma + pieza actual (no se dibujan con el juego terminado)
  if (!gameOver) {
    const gy = ghostY();
    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        if (current.shape[r][c])
          drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2, current.dir);

    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK, 1, current.dir);
  }

  drawPopups();
}

function drawPopups() {
  if (!popups.length) return;
  const now = performance.now();
  popups = popups.filter(p => now - p.t < POPUP_MS);
  const cx = canvas.width / 2, cy = canvas.height / 2;
  for (const pop of popups) {
    const p = (now - pop.t) / POPUP_MS;
    // destello del borde interior del tablero
    ctx.globalAlpha = (1 - p) * 0.8;
    ctx.strokeStyle = pop.color;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
    // texto flotante
    ctx.globalAlpha = 1 - p;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(30 * (1 + p * 0.4))}px system-ui, sans-serif`;
    const ty = cy - p * 40;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(pop.text, cx, ty);
    ctx.fillStyle = pop.color;
    ctx.fillText(pop.text, cx, ty);
    ctx.globalAlpha = 1;
  }
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB, 1, next.dir);
}

function endGame() {
  if (gameOver) return;
  gameOver = true;
  cancelAnimationFrame(animId);
  animId = null;
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}` +
    (comboMax >= 2 ? ` · Mejor combo: x${Math.min(comboMax, COMBO_MAX_MULT)}` : '');
  overlay.classList.remove('hidden');
  sfxGameOver();
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  powerPending = null;
  nextPowerLines = POWER_LINES;
  nextPowerType = BOMB_TYPE;
  blasts = [];
  combo = 0;
  comboMax = 0;
  popups = [];
  hudMult = 1;
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  audio(); // arranca/reanuda el AudioContext tras el primer gesto del usuario
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch (e) {
    // localStorage no disponible (p. ej. modo privado); se mantiene el tema por defecto
  }
  const isLight = saved === 'light';
  document.body.classList.toggle('light-theme', isLight);
  themeToggle.checked = isLight;
}

themeToggle.addEventListener('change', () => {
  document.body.classList.toggle('light-theme', themeToggle.checked);
  try {
    localStorage.setItem(THEME_KEY, themeToggle.checked ? 'light' : 'dark');
  } catch (e) {
    // localStorage no disponible; la preferencia no persistirá
  }
  draw();
  drawNext();
});

function initSound() {
  let saved = null;
  try {
    saved = localStorage.getItem(SOUND_KEY);
  } catch (e) {
    // localStorage no disponible; se mantiene el sonido activado por defecto
  }
  soundOn = saved !== 'off';
  soundToggle.textContent = soundOn ? '🔊' : '🔇';
  soundToggle.setAttribute('aria-pressed', String(soundOn));
}

soundToggle.addEventListener('click', () => {
  soundOn = !soundOn;
  soundToggle.textContent = soundOn ? '🔊' : '🔇';
  soundToggle.setAttribute('aria-pressed', String(soundOn));
  try {
    localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off');
  } catch (e) {
    // localStorage no disponible; la preferencia no persistirá
  }
  if (soundOn) sfxRotate();
});

initTheme();
initSound();
init();
