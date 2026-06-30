import { getOrCreatePlayerId, getParam, avatarSrc, showToast } from './main.js';
import {
  subscribeToRoom,
  placeStone, subscribeToStones,
  recordSnap, subscribeToSnaps,
  endRound, startRound,
} from './firebase.js';
import {
  initPhysics, destroyPhysics,
  addStone, removeStone, clearAllStones,
  getStonePositions, setStormRadius,
} from './physics.js';
import { haptics } from './haptics.js';

const roomCode = getParam('room');
const myId     = getOrCreatePlayerId();

if (!roomCode) window.location.href = '../index.html';

// ── DOM ───────────────────────────────────────────────────────────────────────
const canvas       = document.getElementById('board-canvas');
const ctx          = canvas.getContext('2d');
const hudRound     = document.getElementById('hud-round');
const hudTimer     = document.getElementById('hud-timer');
const playerStrip  = document.getElementById('player-strip');
const countPlus    = document.getElementById('count-plus');
const countMinus   = document.getElementById('count-minus');
const btnPlus      = document.getElementById('btn-plus');
const btnMinus     = document.getElementById('btn-minus');
const roundOverlay = document.getElementById('round-overlay');
const roundResults = document.getElementById('round-results');
const overlayBtn   = document.getElementById('overlay-btn');
const overlaySub   = document.getElementById('overlay-sub');

// ── State ─────────────────────────────────────────────────────────────────────
let room           = null;
let me             = null;
let selectedPol    = '+';
let boardCX        = 0;
let boardCY        = 0;
let boardR         = 0;
let physicsReady   = false;
let roundActive    = false;
let stormR         = 1.0;
let timerInterval  = null;
let lastRound      = 0;
let localStones    = new Map();   // stoneId → stone data
let snapLog        = new Map();   // snapId  → snap data
let unsubRoom, unsubStones, unsubSnaps;

// ── Canvas ────────────────────────────────────────────────────────────────────
function resizeCanvas() {
  const wrap = canvas.parentElement;
  canvas.width  = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  boardCX = canvas.width  / 2;
  boardCY = canvas.height / 2;
  boardR  = Math.min(canvas.width, canvas.height) / 2 * 0.88;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
function init() {
  resizeCanvas();
  window.addEventListener('resize', () => {
    resizeCanvas();
  });

  initPhysics({ boardCX, boardCY, boardRadius: boardR, onSnap: handleLocalSnap });
  physicsReady = true;

  requestAnimationFrame(drawLoop);

  canvas.addEventListener('pointerdown', onBoardTap);
  btnPlus.addEventListener('click',  () => selectPol('+'));
  btnMinus.addEventListener('click', () => selectPol('-'));
  overlayBtn.addEventListener('click', onNextRound);

  unsubRoom = subscribeToRoom(roomCode, onRoomUpdate);
}

function selectPol(p) {
  selectedPol = p;
  btnPlus.classList.toggle('active',  p === '+');
  btnMinus.classList.toggle('active', p === '-');
}

// ── Room updates ──────────────────────────────────────────────────────────────
function onRoomUpdate(r) {
  if (!r) { window.location.href = '../index.html'; return; }

  room = r;
  me   = r.players?.[myId];
  if (!me) { window.location.href = '../index.html'; return; }

  hudRound.textContent = `ROUND ${r.round ?? 1}`;
  stormR = r.stormRadius ?? 1.0;
  setStormRadius(stormR);

  countPlus.textContent  = me.plusStones  ?? 0;
  countMinus.textContent = me.minusStones ?? 0;
  btnPlus.disabled  = (me.plusStones  ?? 0) <= 0;
  btnMinus.disabled = (me.minusStones ?? 0) <= 0;

  if (btnPlus.disabled && selectedPol === '+' && (me.minusStones ?? 0) > 0) selectPol('-');
  if (btnMinus.disabled && selectedPol === '-' && (me.plusStones ?? 0) > 0) selectPol('+');

  renderPlayerStrip(r.players);

  if (r.status === 'playing' && r.round !== lastRound) {
    lastRound = r.round;
    startNewRound(r.round, r.timerDuration ?? 10);
  } else if (r.status === 'round_end') {
    onRoundEnd();
  }
}

// ── Round lifecycle ───────────────────────────────────────────────────────────
function startNewRound(round, duration) {
  roundActive = true;
  clearInterval(timerInterval);
  roundOverlay.classList.remove('visible');

  clearAllStones();
  localStones.clear();
  snapLog.clear();

  unsubStones?.();
  unsubSnaps?.();
  unsubStones = subscribeToStones(roomCode, round, onStoneReceived);
  unsubSnaps  = subscribeToSnaps(roomCode, round, onSnapReceived);

  startTimer(duration);
}

function startTimer(seconds) {
  const endAt = Date.now() + seconds * 1000;

  timerInterval = setInterval(() => {
    const rem = Math.ceil((endAt - Date.now()) / 1000);
    hudTimer.textContent = rem > 0 ? rem : '0';
    hudTimer.classList.toggle('urgent', rem <= 3);

    if (rem <= 0) {
      clearInterval(timerInterval);
      roundActive = false;
      hudTimer.textContent = '0';
      // Host is responsible for calling endRound
      if (room?.host === myId) doEndRound();
    }
  }, 200);
}

async function doEndRound() {
  const newStorm = parseFloat(Math.max(0.3, stormR - 0.12).toFixed(2));
  try {
    await endRound(roomCode, newStorm);
  } catch (e) {
    // silently retry once
    setTimeout(() => endRound(roomCode, newStorm).catch(() => {}), 1000);
  }
}

function onRoundEnd() {
  clearInterval(timerInterval);
  roundActive = false;
  hudTimer.textContent = '—';
  hudTimer.classList.remove('urgent');

  const myAbsorbed = [...snapLog.values()].filter(s => s.winnerPlayerId === myId).length;
  roundResults.innerHTML =
    `YOU ABSORBED: <strong>${myAbsorbed}</strong> STONE${myAbsorbed !== 1 ? 'S' : ''}<br>` +
    `STORM: ${Math.round(stormR * 100)}% → ${Math.round(Math.max(0.3, stormR - 0.12) * 100)}%`;

  const isHost = room?.host === myId;
  overlayBtn.style.display  = isHost ? 'block' : 'none';
  overlaySub.style.display  = isHost ? 'none'  : 'block';
  roundOverlay.classList.add('visible');
}

async function onNextRound() {
  if (room?.host !== myId) return;
  overlayBtn.disabled = true;
  try {
    await startRound(roomCode, (room.round ?? 1) + 1);
  } finally {
    overlayBtn.disabled = false;
  }
}

// ── Stone placement ───────────────────────────────────────────────────────────
async function onBoardTap(e) {
  if (!roundActive || !me || !room) return;

  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (canvas.width  / rect.width);
  const py = (e.clientY - rect.top)  * (canvas.height / rect.height);

  const dx = px - boardCX;
  const dy = py - boardCY;
  if (Math.hypot(dx, dy) > boardR * stormR - 16) return;

  const pol = selectedPol;
  const countKey = pol === '+' ? 'plusStones' : 'minusStones';
  if ((me[countKey] ?? 0) <= 0) return;

  // Normalize to board-relative (-1..1)
  const nx = dx / boardR;
  const ny = dy / boardR;

  haptics.tap();

  try {
    await placeStone(roomCode, room.round, {
      owner:    myId,
      polarity: pol,
      nx, ny,
      placedAt: Date.now(),
    });
  } catch {
    showToast('PLACEMENT FAILED');
  }
}

function onStoneReceived(id, stone) {
  if (localStones.has(id) || snapLog.has(`absorbed_${id}`)) return;
  localStones.set(id, stone);

  const x = boardCX + stone.nx * boardR;
  const y = boardCY + stone.ny * boardR;

  addStone({
    id,
    x, y,
    polarity: stone.polarity,
    playerId: stone.owner,
    placedAt: stone.placedAt,
  });
}

function onSnapReceived(id, snap) {
  if (snapLog.has(id)) return;
  snapLog.set(id, snap);
  snapLog.set(`absorbed_${snap.loserId}`, true);

  if (localStones.has(snap.loserId)) {
    removeStone(snap.loserId);
    localStones.delete(snap.loserId);
  }
}

function handleLocalSnap({ winnerId, loserId, winnerPlayerId }) {
  if (winnerPlayerId !== myId) return;

  const snapId = `${winnerId}_vs_${loserId}`;
  if (snapLog.has(snapId)) return;

  haptics.snap();
  showToast('SNAP!');

  recordSnap(roomCode, room?.round ?? 1, {
    id:              snapId,
    winnerId,
    loserId,
    winnerPlayerId,
    at:              Date.now(),
  });
}

// ── Player strip ──────────────────────────────────────────────────────────────
function renderPlayerStrip(players) {
  if (!players) return;

  const sorted = Object.entries(players).sort(([, a], [, b]) => {
    if (a.isHost && !b.isHost) return -1;
    if (!a.isHost && b.isHost) return 1;
    return (a.joinedAt ?? 0) - (b.joinedAt ?? 0);
  });

  playerStrip.innerHTML = sorted.map(([id, p]) => {
    const isMe = id === myId;
    const src  = avatarSrc(p.avatar, true);
    return `
      <div class="strip-player">
        <div class="strip-avatar${isMe ? ' is-me' : ''}" style="border-color:${p.color}">
          <img src="${src}" alt="${p.name}">
        </div>
        <div class="strip-counts" style="color:${p.color}">+${p.plusStones ?? 0}&nbsp;−${p.minusStones ?? 0}</div>
        <div class="strip-name">${p.name}</div>
      </div>`;
  }).join('');
}

// ── Draw loop ─────────────────────────────────────────────────────────────────
function drawLoop() {
  draw();
  requestAnimationFrame(drawLoop);
}

function draw() {
  const W = canvas.width;
  const H = canvas.height;

  // Dark surround
  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(0, 0, W, H);

  // Board circle (cream)
  ctx.save();
  ctx.beginPath();
  ctx.arc(boardCX, boardCY, boardR, 0, Math.PI * 2);
  ctx.fillStyle = '#F5F0E8';
  ctx.fill();
  ctx.restore();

  // Dot grid
  drawDotGrid();

  // Storm overlay (darkened ring + red dashed border)
  if (stormR < 1.0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(boardCX, boardCY, boardR, 0, Math.PI * 2);
    ctx.arc(boardCX, boardCY, boardR * stormR, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(26,26,26,0.38)';
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(boardCX, boardCY, boardR * stormR, 0, Math.PI * 2);
    ctx.strokeStyle = '#E63946';
    ctx.lineWidth   = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.restore();
  }

  // Board border
  ctx.save();
  ctx.beginPath();
  ctx.arc(boardCX, boardCY, boardR, 0, Math.PI * 2);
  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth   = 2.5;
  ctx.stroke();
  ctx.restore();

  // Stones
  for (const stone of getStonePositions()) {
    drawStone(stone);
  }
}

function drawDotGrid() {
  const spacing   = 28;
  const dotR      = 1.5;
  const innerEdge = boardR * stormR - 10;

  ctx.fillStyle = '#CCCCCC';

  const startX = boardCX - boardR;
  const startY = boardCY - boardR;

  for (let gx = startX; gx <= boardCX + boardR; gx += spacing) {
    for (let gy = startY; gy <= boardCY + boardR; gy += spacing) {
      const d = Math.hypot(gx - boardCX, gy - boardCY);
      if (d > innerEdge) continue;
      ctx.beginPath();
      ctx.arc(gx, gy, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawStone({ x, y, polarity, playerId }) {
  const p     = room?.players?.[playerId];
  const color = p?.color ?? '#1A1A1A';
  const r     = 12;

  ctx.save();

  if (polarity === '+') {
    // Black fill, player-colored ring
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#1A1A1A';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.stroke();

    ctx.fillStyle    = '#F5F0E8';
    ctx.font         = 'bold 13px Courier New';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+', x, y + 0.5);
  } else {
    // White fill, black border, player-colored inner ring
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#F5F0E8';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, r - 4, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.fillStyle    = '#1A1A1A';
    ctx.font         = 'bold 13px Courier New';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('−', x, y + 0.5);
  }

  ctx.restore();
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
