import { getOrCreatePlayerId, getParam, avatarSrc, showToast } from './main.js';
import {
  subscribeToRoom,
  placeStone, subscribeToStones, subscribeToStoneRemovals,
  removeStonesFromRound, recordSnapEvent, subscribeToSnaps,
  advanceRound, finishGame,
} from './firebase.js';
import {
  initPhysics, destroyPhysics,
  addStone, removeStone,
  getStonePositions, findPlusStonesNear,
} from './physics.js';
import { getBotPlacement } from './bot.js';
import { haptics } from './haptics.js';
import { POWERUP_ICONS } from './powerups.js';

const roomCode = getParam('room');
const myId     = getOrCreatePlayerId();

if (!roomCode) window.location.href = '../index.html';

const SNAP_INDICATOR_MS  = 600;
const STORM_SHRINK_STEP  = 0.12; // fraction removed from the storm radius each round
const STORM_FLOOR        = 0.3;  // minimum playable storm radius — never reaches zero
const MAX_HUD_PLAYERS    = 4;    // visible player cards in the floating HUD stack

// ── DOM ───────────────────────────────────────────────────────────────────────
const canvas         = document.getElementById('board-canvas');
const ctx             = canvas.getContext('2d');
const minimapCanvas   = document.getElementById('minimap-canvas');
const minimapCtx      = minimapCanvas.getContext('2d');
const hudRound        = document.getElementById('hud-round');
const playerStack     = document.getElementById('player-stack');
const powerupSlotsEl  = document.getElementById('powerup-slots');
const handTally       = document.getElementById('hand-tally');
const btnPlus         = document.getElementById('btn-plus');
const btnMinus        = document.getElementById('btn-minus');
const btnShop         = document.getElementById('btn-shop');

// ── State ─────────────────────────────────────────────────────────────────────
let room             = null;
let me               = null;
let selectedPol      = '+';
let boardCX          = 0;
let boardCY          = 0;
let boardHalf        = 0;   // half the side length of the square board
let roundActive      = false;
let stormR           = 1.0;
let timerInterval    = null;
let lastRound        = 0;
let localStones      = new Map();  // id -> { nx, ny, polarity, owner, placedAt, round }
let snapLog          = new Map();  // dedupes incoming snap events
let subscribedRounds = new Set();
let snapIndicators   = [];         // { x, y, until }
let _finishTriggered = false;

// ── Canvas ────────────────────────────────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  boardCX   = canvas.width  / 2;
  boardCY   = canvas.height / 2;
  // Square board: side = the smaller viewport dimension, with a small inset
  boardHalf = Math.min(canvas.width, canvas.height) / 2 * 0.96;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
function init() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('beforeunload', destroyPhysics);

  initPhysics();
  requestAnimationFrame(drawLoop);

  canvas.addEventListener('pointerdown', onBoardTap);
  btnPlus.addEventListener('click',  () => selectPol('+'));
  btnMinus.addEventListener('click', () => selectPol('-'));
  btnShop.addEventListener('click',  () => { window.location.href = `shop.html?room=${roomCode}`; });

  subscribeToRoom(roomCode, onRoomUpdate);
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

  hudRound.textContent = `RND ${r.round ?? 1}`;
  stormR = r.stormRadius ?? 1.0;

  const plus  = me.plusStones  ?? 0;
  const minus = me.minusStones ?? 0;
  handTally.textContent = `[+] ${plus}  [-] ${minus}`;
  btnPlus.disabled  = plus  <= 0;
  btnMinus.disabled = minus <= 0;

  if (btnPlus.disabled  && selectedPol === '+' && minus > 0) selectPol('-');
  if (btnMinus.disabled && selectedPol === '-' && plus  > 0) selectPol('+');

  renderPlayerStack(r.players);
  renderPowerupSlots(me);

  // Win condition: first player whose plusStones AND minusStones are both 0
  if (r.status === 'playing' && r.host === myId && !_finishTriggered) {
    const players = r.players || {};
    for (const [pid, p] of Object.entries(players)) {
      if ((p.plusStones ?? 1) === 0 && (p.minusStones ?? 1) === 0) {
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
    startNewRound(r.round, r.timerDuration ?? 20);
  }
}

// ── Round lifecycle ───────────────────────────────────────────────────────────
function startNewRound(round, duration) {
  roundActive = true;
  clearInterval(timerInterval);

  // Stones persist across rounds — the board is never wiped. Subscriptions for
  // earlier rounds are intentionally left running so their stones keep syncing.
  if (!subscribedRounds.has(round)) {
    subscribedRounds.add(round);
    subscribeToStones(roomCode, round, (id, stone) => onStoneReceived(id, stone, round));
    subscribeToStoneRemovals(roomCode, round, onStoneRemoved);
    subscribeToSnaps(roomCode, round, onSnapReceived);
  }

  if (room?.host === myId) {
    startHostTimer(duration);
    scheduleBotMoves(round, duration);
  }
}

// Host-only silent timer — advances the storm when the round expires. No UI is shown.
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

// Storm keeps shrinking every round and parks at the floor once reached — it
// never ends the game on its own. The only win trigger is the 0/0 inventory
// check in onRoomUpdate.
async function doEndRound() {
  const newStorm = parseFloat(Math.max(STORM_FLOOR, stormR - STORM_SHRINK_STEP).toFixed(2));

  // Storm boundary moves inward — anything now outside it is permanently removed.
  const byRound = new Map();
  for (const [id, s] of localStones) {
    if (Math.abs(s.nx) > newStorm || Math.abs(s.ny) > newStorm) {
      if (!byRound.has(s.round)) byRound.set(s.round, []);
      byRound.get(s.round).push(id);
    }
  }
  for (const [round, ids] of byRound) {
    try { await removeStonesFromRound(roomCode, round, ids, null, 0); } catch (_) {}
  }

  const nextRound = (room?.round ?? 1) + 1;
  try {
    await advanceRound(roomCode, nextRound, newStorm);
  } catch (e) {
    setTimeout(() => advanceRound(roomCode, nextRound, newStorm).catch(() => {}), 1000);
  }
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
    await tryPlaceStone(bot.id, round, pol, nx, ny);
  } catch (_) {}
}

// ── Stone placement ───────────────────────────────────────────────────────────
async function onBoardTap(e) {
  if (!roundActive || !me || !room) return;

  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (canvas.width  / rect.width);
  const py = (e.clientY - rect.top)  * (canvas.height / rect.height);
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
    await tryPlaceStone(myId, room.round, pol, nx, ny);
  } catch {
    showToast('PLACEMENT FAILED');
  }
}

// Places a stone, or — for a + stone landing within snap radius of an existing
// + stone — resolves a snap penalty instead of placing anything.
async function tryPlaceStone(ownerId, round, pol, nx, ny) {
  if (pol === '+') {
    const px = boardCX + nx * boardHalf;
    const py = boardCY + ny * boardHalf;
    const touched = findPlusStonesNear(px, py);
    if (touched.length > 0) {
      await resolveSnapPenalty(ownerId, round, touched, nx, ny);
      return;
    }
  }
  await placeStone(roomCode, round, { owner: ownerId, polarity: pol, nx, ny, placedAt: Date.now() });
}

async function resolveSnapPenalty(placerId, currentRound, touchedIds, nx, ny) {
  const byRound = new Map();
  for (const id of touchedIds) {
    const s = localStones.get(id);
    if (!s) continue;
    if (!byRound.has(s.round)) byRound.set(s.round, []);
    byRound.get(s.round).push(id);
  }

  if (placerId === myId) {
    haptics.snap();
    showToast(`SNAPPED! +${touchedIds.length} RETURNED`);
  }

  await recordSnapEvent(roomCode, currentRound, {
    placerId, count: touchedIds.length, nx, ny, at: Date.now(),
  });

  for (const [round, ids] of byRound) {
    await removeStonesFromRound(roomCode, round, ids, placerId, ids.length);
  }
}

function onStoneReceived(id, stone, round) {
  if (localStones.has(id)) return;
  localStones.set(id, { ...stone, round });
  addStone({
    id,
    x: boardCX + stone.nx * boardHalf,
    y: boardCY + stone.ny * boardHalf,
    polarity: stone.polarity,
    playerId: stone.owner,
    placedAt: stone.placedAt,
  });
}

function onStoneRemoved(id) {
  if (!localStones.has(id)) return;
  removeStone(id);
  localStones.delete(id);
}

function onSnapReceived(id, snap) {
  if (snapLog.has(id)) return;
  snapLog.set(id, snap);
  snapIndicators.push({
    x: boardCX + snap.nx * boardHalf,
    y: boardCY + snap.ny * boardHalf,
    until: Date.now() + SNAP_INDICATOR_MS,
  });
}

// ── Floating HUD: player stack (top right) ────────────────────────────────────
function renderPlayerStack(players) {
  if (!players) return;
  const sorted = Object.entries(players).sort(([, a], [, b]) => {
    if (a.isHost && !b.isHost) return -1;
    if (!a.isHost && b.isHost) return 1;
    return (a.joinedAt ?? 0) - (b.joinedAt ?? 0);
  });

  playerStack.innerHTML = sorted.slice(0, MAX_HUD_PLAYERS).map(([id, p]) => {
    const isMe = id === myId;
    const src  = avatarSrc(p.avatar, true);
    return `
      <div class="player-card${isMe ? ' is-me' : ''}">
        <div class="player-card-row">
          <div class="player-card-avatar" style="border-color:${p.color};background:${p.color}">
            <img src="${src}" alt="${p.name}">
          </div>
          <span class="player-card-name">${p.name}</span>
        </div>
        <div class="player-card-counts" style="color:${p.color}">+${p.plusStones ?? 0} &minus;${p.minusStones ?? 0}</div>
      </div>`;
  }).join('');
}

// ── Floating HUD: power-up slots (bottom tray) ────────────────────────────────
function renderPowerupSlots(player) {
  const owned = (player?.powerUps ?? []).filter(Boolean);
  powerupSlotsEl.innerHTML = owned.map(key =>
    `<div class="powerup-slot" title="${key}">${POWERUP_ICONS[key] ?? '?'}</div>`
  ).join('');
}

// ── Draw loop ─────────────────────────────────────────────────────────────────
function drawLoop() {
  draw();
  drawMinimap();
  requestAnimationFrame(drawLoop);
}

function draw() {
  const W = canvas.width;
  const H = canvas.height;

  // Full-bleed cream board — the board surface never changes or gets erased.
  ctx.fillStyle = '#F5F0E8';
  ctx.fillRect(0, 0, W, H);

  drawDotGrid();

  // Storm boundary — only this dashed rect moves inward as the storm advances.
  const sh = boardHalf * stormR;
  ctx.save();
  ctx.strokeStyle = '#1C1208';
  ctx.lineWidth   = 2;
  ctx.setLineDash([9, 5]);
  ctx.strokeRect(boardCX - sh, boardCY - sh, sh * 2, sh * 2);
  ctx.restore();

  // Stones (outside-storm stones drawn at 30% opacity, non-interactive)
  for (const stone of getStonePositions()) {
    drawStone(stone);
  }

  drawSnapIndicators();
}

function drawDotGrid() {
  const spacing = 28;
  const dotR    = 1.6;
  ctx.fillStyle = 'rgba(28,18,8,0.28)';

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
  const color = p?.color ?? '#1C1208';
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
    ctx.fillStyle = '#1C1208';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.stroke();

    ctx.fillStyle    = '#F5F0E8';
    ctx.font         = 'bold 13px "Space Mono", monospace';
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
    ctx.strokeStyle = '#1C1208';
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, r - 4, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.fillStyle    = '#1C1208';
    ctx.font         = 'bold 13px "Space Mono", monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('−', x, y + 0.5);
  }
  ctx.restore();
}

function drawSnapIndicators() {
  const now = Date.now();
  snapIndicators = snapIndicators.filter(ind => ind.until > now);
  for (const ind of snapIndicators) {
    const remaining = (ind.until - now) / SNAP_INDICATOR_MS; // 1 -> 0
    ctx.save();
    ctx.globalAlpha = remaining;
    ctx.strokeStyle = '#1C1208';
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.arc(ind.x, ind.y, 14 + (1 - remaining) * 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ── Minimap ────────────────────────────────────────────────────────────────────
function drawMinimap() {
  const W = minimapCanvas.width;
  const H = minimapCanvas.height;
  const cx = W / 2;
  const cy = H / 2;
  const half = Math.min(W, H) / 2 * 0.86;

  minimapCtx.clearRect(0, 0, W, H);
  minimapCtx.fillStyle = '#EEE8D4';
  minimapCtx.fillRect(0, 0, W, H);

  const sh = half * stormR;
  minimapCtx.strokeStyle = '#1C1208';
  minimapCtx.lineWidth = 1;
  minimapCtx.setLineDash([2, 1.5]);
  minimapCtx.strokeRect(cx - sh, cy - sh, sh * 2, sh * 2);
  minimapCtx.setLineDash([]);

  for (const stone of getStonePositions()) {
    const nx = (stone.x - boardCX) / boardHalf;
    const ny = (stone.y - boardCY) / boardHalf;
    const mx = cx + nx * half;
    const my = cy + ny * half;
    minimapCtx.beginPath();
    minimapCtx.arc(mx, my, 1.8, 0, Math.PI * 2);
    if (stone.polarity === '+') {
      minimapCtx.fillStyle = '#1C1208';
      minimapCtx.fill();
    } else {
      minimapCtx.fillStyle = '#EEE8D4';
      minimapCtx.fill();
      minimapCtx.strokeStyle = '#1C1208';
      minimapCtx.lineWidth = 0.8;
      minimapCtx.stroke();
    }
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
