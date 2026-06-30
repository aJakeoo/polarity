import { getOrCreatePlayerId, getParam, avatarSrc, showToast } from './main.js';
import {
  subscribeToRoom,
  placeStone, subscribeToStones,
  recordSnap, subscribeToSnaps,
  advanceRound, finishGame, getSnapScores,
} from './firebase.js';
import {
  initPhysics, destroyPhysics,
  addStone, removeStone, clearAllStones,
  getStonePositions, setStormRadius, updateBoardBounds,
} from './physics.js';
import { getBotPlacement } from './bot.js';
import { haptics } from './haptics.js';

const roomCode = getParam('room');
const myId     = getOrCreatePlayerId();

if (!roomCode) window.location.href = '../index.html';

// ── DOM ───────────────────────────────────────────────────────────────────────
const canvas      = document.getElementById('board-canvas');
const ctx         = canvas.getContext('2d');
const hudRound    = document.getElementById('hud-round');
const snapCount   = document.getElementById('snap-count');
const playerStrip = document.getElementById('player-strip');
const countPlus   = document.getElementById('count-plus');
const countMinus  = document.getElementById('count-minus');
const btnPlus     = document.getElementById('btn-plus');
const btnMinus    = document.getElementById('btn-minus');

// ── State ─────────────────────────────────────────────────────────────────────
let room          = null;
let me            = null;
let selectedPol   = '+';
let boardCX       = 0;
let boardCY       = 0;
let boardHalf     = 0;   // half the side length of the square board
let physicsReady  = false;
let roundActive   = false;
let stormR        = 1.0;
let timerInterval = null;
let lastRound     = 0;
let mySnapCount   = 0;
let localStones   = new Map();
let snapLog       = new Map();
let unsubRoom, unsubStones, unsubSnaps;

// ── Canvas ────────────────────────────────────────────────────────────────────
function resizeCanvas() {
  const wrap = canvas.parentElement;
  canvas.width  = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  boardCX   = canvas.width  / 2;
  boardCY   = canvas.height / 2;
  // Square board: side = full canvas width with small inset
  boardHalf = canvas.width / 2 * 0.96;
  if (physicsReady) updateBoardBounds({ boardCX, boardCY, boardHalf });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
function init() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  initPhysics({ boardCX, boardCY, boardHalf, onSnap: handleLocalSnap });
  physicsReady = true;

  requestAnimationFrame(drawLoop);

  canvas.addEventListener('pointerdown', onBoardTap);
  btnPlus.addEventListener('click',  () => selectPol('+'));
  btnMinus.addEventListener('click', () => selectPol('-'));

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

  if (r.status === 'finished') {
    window.location.href = `win.html?room=${roomCode}`;
    return;
  }

  hudRound.textContent = `ROUND ${r.round ?? 1}`;
  stormR = r.stormRadius ?? 1.0;
  setStormRadius(stormR);

  countPlus.textContent  = me.plusStones  ?? 0;
  countMinus.textContent = me.minusStones ?? 0;
  btnPlus.disabled  = (me.plusStones  ?? 0) <= 0;
  btnMinus.disabled = (me.minusStones ?? 0) <= 0;

  if (btnPlus.disabled  && selectedPol === '+' && (me.minusStones ?? 0) > 0) selectPol('-');
  if (btnMinus.disabled && selectedPol === '-' && (me.plusStones  ?? 0) > 0) selectPol('+');

  renderPlayerStrip(r.players);

  if (r.status === 'playing' && r.round !== lastRound) {
    lastRound = r.round;
    startNewRound(r.round, r.timerDuration ?? 60);
  }
}

// ── Round lifecycle ───────────────────────────────────────────────────────────
function startNewRound(round, duration) {
  roundActive = true;
  mySnapCount = 0;
  clearInterval(timerInterval);
  snapCount.textContent = 'SNAP 0';

  clearAllStones();
  localStones.clear();
  snapLog.clear();

  unsubStones?.();
  unsubSnaps?.();
  unsubStones = subscribeToStones(roomCode, round, onStoneReceived);
  unsubSnaps  = subscribeToSnaps(roomCode, round, onSnapReceived);

  if (room?.host === myId) {
    startHostTimer(duration);
    scheduleBotMoves(round, duration);
  }
}

// Host-only silent timer — advances storm when round expires
function startHostTimer(seconds) {
  const endAt = Date.now() + seconds * 1000;
  timerInterval = setInterval(() => {
    if (Date.now() >= endAt) {
      clearInterval(timerInterval);
      roundActive = false;
      doEndRound();
    }
  }, 500);
}

async function doEndRound() {
  const newStorm = parseFloat(Math.max(0.3, stormR - 0.12).toFixed(2));
  if (stormR <= 0.3) {
    try { await _finishGame(); } catch (_) {}
    return;
  }
  const nextRound = (room?.round ?? 1) + 1;
  try {
    await advanceRound(roomCode, nextRound, newStorm);
  } catch (e) {
    setTimeout(() => advanceRound(roomCode, nextRound, newStorm).catch(() => {}), 1000);
  }
}

async function _finishGame() {
  const scores  = await getSnapScores(roomCode, room?.round ?? 1);
  const players = room?.players ?? {};
  let winnerId = null;
  let maxSnaps = -1;
  for (const [pid, count] of Object.entries(scores)) {
    if (!players[pid]) continue;
    if (count > maxSnaps) { maxSnaps = count; winnerId = pid; }
  }
  if (!winnerId) {
    for (const [pid, p] of Object.entries(players)) {
      if ((p.plusStones ?? 0) > (players[winnerId]?.plusStones ?? -1)) winnerId = pid;
    }
  }
  await finishGame(roomCode, winnerId);
}

// ── Bot simulation (host only) ────────────────────────────────────────────────
function scheduleBotMoves(round, duration) {
  const bots = Object.entries(room?.players || {})
    .filter(([, p]) => p.isBot)
    .map(([id, p]) => ({ id, ...p }));

  for (const bot of bots) {
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const delay = (0.1 + Math.random() * 0.7) * duration * 1000;
      setTimeout(() => _placeBotStone(bot, round), delay);
    }
  }
}

async function _placeBotStone(bot, round) {
  if (!roundActive || room?.round !== round) return;
  const pol      = Math.random() < 0.8 ? '+' : '-';
  const countKey = pol === '+' ? 'plusStones' : 'minusStones';
  const bp       = room?.players?.[bot.id];
  if (!bp || (bp[countKey] ?? 0) <= 0) return;

  const existingNxNy = [...localStones.values()].map(s => ({ nx: s.nx, ny: s.ny }));
  const { nx, ny }   = getBotPlacement(stormR, boardHalf, existingNxNy);

  try {
    await placeStone(roomCode, round, {
      owner: bot.id, polarity: pol, nx, ny, placedAt: Date.now(),
    });
  } catch (_) {}
}

// ── Stone placement ───────────────────────────────────────────────────────────
async function onBoardTap(e) {
  if (!roundActive || !me || !room) return;

  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left)  * (canvas.width  / rect.width);
  const py = (e.clientY - rect.top)   * (canvas.height / rect.height);
  const dx = px - boardCX;
  const dy = py - boardCY;

  // Must be within storm-safe square zone
  const stormHalf = boardHalf * stormR - 16;
  if (Math.abs(dx) > stormHalf || Math.abs(dy) > stormHalf) return;

  const pol      = selectedPol;
  const countKey = pol === '+' ? 'plusStones' : 'minusStones';
  if ((me[countKey] ?? 0) <= 0) return;

  const nx = dx / boardHalf;
  const ny = dy / boardHalf;

  haptics.tap();
  try {
    await placeStone(roomCode, room.round, {
      owner: myId, polarity: pol, nx, ny, placedAt: Date.now(),
    });
  } catch {
    showToast('PLACEMENT FAILED');
  }
}

function onStoneReceived(id, stone) {
  if (localStones.has(id) || snapLog.has(`absorbed_${id}`)) return;
  localStones.set(id, stone);
  addStone({
    id,
    x: boardCX + stone.nx * boardHalf,
    y: boardCY + stone.ny * boardHalf,
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
  const isMe        = winnerPlayerId === myId;
  const isBotOnHost = room?.players?.[winnerPlayerId]?.isBot && room?.host === myId;
  if (!isMe && !isBotOnHost) return;

  const snapId = `${winnerId}_vs_${loserId}`;
  if (snapLog.has(snapId)) return;

  if (isMe) {
    haptics.snap();
    mySnapCount++;
    snapCount.textContent = `SNAP ${mySnapCount}`;
    showToast('SNAP!');
  }

  recordSnap(roomCode, room?.round ?? 1, {
    id: snapId, winnerId, loserId, winnerPlayerId, at: Date.now(),
  });
}

// ── Player strip (top HUD) ────────────────────────────────────────────────────
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
        <div class="strip-avatar${isMe ? ' is-me' : ''}"
             style="border-color:${p.color};background:${p.color}">
          <img src="${src}" alt="${p.name}">
        </div>
        <div class="strip-counts" style="color:${p.color}">
          +${p.plusStones ?? 0} −${p.minusStones ?? 0}
        </div>
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

  const bx = boardCX - boardHalf;
  const by = boardCY - boardHalf;
  const bs = boardHalf * 2;

  // Board fill (cream)
  ctx.fillStyle = '#F5F0E8';
  ctx.fillRect(bx, by, bs, bs);

  // Dot grid (full board)
  drawDotGrid();

  // Storm inner boundary
  if (stormR < 1.0) {
    const sh = boardHalf * stormR;

    // Subtle darkened band outside storm
    ctx.save();
    ctx.fillStyle = 'rgba(26,26,26,0.18)';
    // Top band
    ctx.fillRect(bx, by, bs, boardCY - sh - by);
    // Bottom band
    ctx.fillRect(bx, boardCY + sh, bs, (by + bs) - (boardCY + sh));
    // Left band
    ctx.fillRect(bx, boardCY - sh, boardCX - sh - bx, sh * 2);
    // Right band
    ctx.fillRect(boardCX + sh, boardCY - sh, (bx + bs) - (boardCX + sh), sh * 2);
    ctx.restore();

    // Storm border — red dashed inner square
    ctx.save();
    ctx.strokeStyle = '#E63946';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(boardCX - sh, boardCY - sh, sh * 2, sh * 2);
    ctx.restore();
  }

  // Outer board border — dashed
  ctx.save();
  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(bx, by, bs, bs);
  ctx.restore();

  // Stones
  for (const stone of getStonePositions()) {
    drawStone(stone);
  }
}

function drawDotGrid() {
  const spacing = 28;
  const dotR    = 1.5;
  ctx.fillStyle = '#CCCCCC';

  const x0 = boardCX - boardHalf;
  const y0 = boardCY - boardHalf;
  const x1 = boardCX + boardHalf;
  const y1 = boardCY + boardHalf;

  // Align grid to board edge
  for (let gx = x0 + spacing / 2; gx < x1; gx += spacing) {
    for (let gy = y0 + spacing / 2; gy < y1; gy += spacing) {
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
