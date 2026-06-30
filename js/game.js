import { getOrCreatePlayerId, getParam, avatarSrc, showToast } from './main.js';
import {
  subscribeToRoom,
  placeStone, subscribeToStones,
  recordSnap, subscribeToSnaps,
  advanceRound, finishGame,
} from './firebase.js';
import {
  initPhysics, destroyPhysics,
  addStone, removeStone,
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
let room             = null;
let me               = null;
let selectedPol      = '+';
let boardCX          = 0;
let boardCY          = 0;
let boardHalf        = 0;   // half the side length of the square board
let physicsReady     = false;
let roundActive      = false;
let stormR           = 1.0;
let timerInterval    = null;
let lastRound        = 0;
let mySnapCount      = 0;
let localStones      = new Map();
let snapLog          = new Map();
let _finishTriggered = false;
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

  // Win detection: first player to reach 0 total stones wins (host triggers)
  if (r.status === 'playing' && r.host === myId && !_finishTriggered) {
    const players = r.players || {};
    for (const [pid, p] of Object.entries(players)) {
      const total = (p.plusStones ?? 1) + (p.minusStones ?? 1);
      if (total === 0) {
        _finishTriggered = true;
        clearInterval(timerInterval);
        roundActive = false;
        setTimeout(() => finishGame(roomCode, pid), 100);
        return;
      }
    }
  }

  if (r.status === 'playing' && r.round !== lastRound) {
    lastRound = r.round;
    startNewRound(r.round, r.timerDuration ?? 60);
  }
}

// ── Round lifecycle ───────────────────────────────────────────────────────────
function startNewRound(round, duration) {
  roundActive = true;
  clearInterval(timerInterval);

  // Stones persist across rounds (storm board — never wipe the board)
  // snapLog persists too (prevents duplicate snap processing)
  // Just add new subscriptions for this round without destroying old ones
  subscribeToStones(roomCode, round, onStoneReceived);
  subscribeToSnaps(roomCode, round, onSnapReceived);

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
  // Win condition: fewest total stones remaining
  const players = room?.players ?? {};
  let winnerId  = null;
  let minStones = Infinity;
  for (const [pid, p] of Object.entries(players)) {
    const total = (p.plusStones ?? 0) + (p.minusStones ?? 0);
    if (total < minStones) { minStones = total; winnerId = pid; }
  }
  if (winnerId) await finishGame(roomCode, winnerId);
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
  if (localStones.has(id) || snapLog.has(`snapped_${id}`)) return;
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
  // Mark both stones as snapped so they're never re-added
  snapLog.set(`snapped_${snap.placerStoneId}`, true);
  snapLog.set(`snapped_${snap.victimStoneId}`, true);
  for (const stoneId of [snap.placerStoneId, snap.victimStoneId]) {
    if (localStones.has(stoneId)) {
      removeStone(stoneId);
      localStones.delete(stoneId);
    }
  }
}

function handleLocalSnap({ placerStoneId, victimStoneId, placerPlayerId }) {
  const isMe        = placerPlayerId === myId;
  const isBotOnHost = room?.players?.[placerPlayerId]?.isBot && room?.host === myId;
  if (!isMe && !isBotOnHost) return;

  const snapId = `${placerStoneId}_vs_${victimStoneId}`;
  if (snapLog.has(snapId)) return;

  if (isMe) {
    haptics.snap();
    mySnapCount++;
    snapCount.textContent = `SNAP ${mySnapCount}`;
    showToast('SNAPPED — +2 RETURNED');
  }

  recordSnap(roomCode, room?.round ?? 1, {
    id: snapId, placerStoneId, victimStoneId, placerPlayerId, at: Date.now(),
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

  // Full-bleed cream board — no dark surround
  ctx.fillStyle = '#F5F0E5';
  ctx.fillRect(0, 0, W, H);

  // Dot grid across full canvas
  drawDotGrid();

  // Storm boundary — dashed rect moves inward each round
  // Never erases board; stones outside boundary just fade (handled in drawStone)
  const sh = boardHalf * stormR;
  ctx.save();
  ctx.strokeStyle = '#E63946';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(boardCX - sh, boardCY - sh, sh * 2, sh * 2);
  ctx.restore();

  // Stones (outside-storm stones drawn at 30% opacity)
  for (const stone of getStonePositions()) {
    drawStone(stone);
  }
}

function drawDotGrid() {
  const spacing = 28;
  const dotR    = 1.5;
  ctx.fillStyle = 'rgba(28,18,8,0.12)';

  // Cover full canvas
  for (let gx = spacing / 2; gx < canvas.width; gx += spacing) {
    for (let gy = spacing / 2; gy < canvas.height; gy += spacing) {
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

  // Stones outside the storm boundary fade to 30% opacity, non-interactive
  const dx           = x - boardCX;
  const dy           = y - boardCY;
  const sh           = boardHalf * stormR;
  const outsideStorm = Math.abs(dx) > sh || Math.abs(dy) > sh;

  ctx.save();
  if (outsideStorm) ctx.globalAlpha = 0.3;
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
    ctx.font         = 'bold 13px Space Mono, monospace';
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
    ctx.font         = 'bold 13px Space Mono, monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('−', x, y + 0.5);
  }
  ctx.restore();
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
