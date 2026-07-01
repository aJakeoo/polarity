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
  SNAP_RADIUS,
} from './physics.js';
import { getBotPlacement } from './bot.js';
import { haptics } from './haptics.js';
import { POWERUP_ICONS } from './powerups.js';

const roomCode = getParam('room');
const myId     = getOrCreatePlayerId();

if (!roomCode) window.location.href = '../index.html';

const RIPPLE_MS          = 400;  // white ripple burst duration on snap
const STORM_SHRINK_STEP  = 0.12; // fraction removed from the storm radius each round
const STORM_FLOOR        = 0.3;  // minimum playable storm radius — never reaches zero
const MAX_HUD_PLAYERS    = 4;    // visible player cards in the floating HUD stack

const HUD_TOP_CLEARANCE    = 64;  // px reserved for the top bar so the board doesn't sit under it
const HUD_BOTTOM_CLEARANCE = 110; // px reserved for the bottom tray

const MIN_ZOOM         = 0.5;
const MAX_ZOOM         = 3;
const DRAG_THRESHOLD   = 6;   // px of movement before a single-pointer touch counts as a pan
const DOUBLE_TAP_MS    = 280; // window to detect a second tap
const DOUBLE_TAP_DIST  = 30;  // px — how close the second tap must land

const PLACEMENT_ANIM_MS = 150; // stone pop-in: scale 0 -> 1.1 -> 1.0
const SNAP_VANISH_MS    = 80;  // snapped stone: scale to 1.4x then vanish
const STORM_BURST_MS    = 250; // storm-culled stone: burst-fade out
const FLOAT_TEXT_MS     = 700; // "+N" rising text duration
const FLOAT_RISE_PX     = 40;
const SHAKE_MS          = 150;
const SHAKE_AMPLITUDE   = 3;   // px
const STORM_FLASH_MS    = 300; // boundary flashes red on storm advance
const BREATH_PERIOD_MS  = 3000; // storm boundary breathing cycle

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
let prevStormR       = null;
let timerInterval    = null;
let lastRound        = 0;
let localStones      = new Map();  // id -> { nx, ny, polarity, owner, placedAt, round }
let snapLog          = new Map();  // dedupes incoming snap events
let snapKindIds      = new Set();  // stone ids known to be dying via snap (vs. storm cull)
let subscribedRounds = new Set();
let ripples          = [];         // { x, y, until } — white snap ripple bursts
let floatingTexts    = [];         // { x, y, text, startTime }
let dyingStones      = [];         // { x, y, polarity, playerId, startTime, kind: 'snap'|'storm' }
let shakeUntil       = 0;
let stormFlashUntil  = 0;
let _finishTriggered = false;

// ── Zoom / pan ────────────────────────────────────────────────────────────────
let zoom = 1;
let panX = 0;
let panY = 0;
const activePointers = new Map(); // pointerId -> {x, y} in canvas-pixel space
let pinchStartDist = 0;
let pinchStartZoom = 1;
let hadPinch       = false;
let dragStart      = null; // { x, y, panX, panY }
let dragging       = false;
let tapState       = null; // { pos, timer }

function lerp(a, b, t) { return a + (b - a) * t; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function toCanvasCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (canvas.width  / rect.width),
    y: (clientY - rect.top)  * (canvas.height / rect.height),
  };
}

// Converts a screen tap into board/"world" space, inverting the current zoom+pan.
function toWorldCoords(clientX, clientY) {
  const p  = toCanvasCoords(clientX, clientY);
  const cx = canvas.width  / 2;
  const cy = canvas.height / 2;
  return {
    x: cx + (p.x - cx - panX) / zoom,
    y: cy + (p.y - cy - panY) / zoom,
  };
}

// ── Canvas ────────────────────────────────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  // Board fills the full available space between the top bar and bottom tray,
  // not the whole viewport — otherwise the HUD would sit on top of it.
  const availHeight = Math.max(100, canvas.height - HUD_TOP_CLEARANCE - HUD_BOTTOM_CLEARANCE);
  boardCX   = canvas.width / 2;
  boardCY   = HUD_TOP_CLEARANCE + availHeight / 2;
  boardHalf = Math.min(canvas.width, availHeight) / 2 * 0.98;

  zoom = 1;
  panX = 0;
  panY = 0;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
function init() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('beforeunload', destroyPhysics);

  initPhysics();
  requestAnimationFrame(drawLoop);

  canvas.addEventListener('pointerdown',   onPointerDown);
  canvas.addEventListener('pointermove',   onPointerMove);
  canvas.addEventListener('pointerup',     onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

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

// ── Pointer / gesture handling (pinch zoom, drag pan, tap, double-tap) ────────
function onPointerDown(e) {
  canvas.setPointerCapture?.(e.pointerId);
  activePointers.set(e.pointerId, toCanvasCoords(e.clientX, e.clientY));

  if (activePointers.size === 2) {
    hadPinch = true;
    const pts = [...activePointers.values()];
    pinchStartDist = dist(pts[0], pts[1]);
    pinchStartZoom = zoom;
    dragging = false;
  } else if (activePointers.size === 1) {
    dragStart = { x: e.clientX, y: e.clientY, panX, panY };
    dragging  = false;
  }
}

function onPointerMove(e) {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, toCanvasCoords(e.clientX, e.clientY));

  if (activePointers.size === 2) {
    hadPinch = true;
    const pts = [...activePointers.values()];
    const d = dist(pts[0], pts[1]);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchStartZoom * (d / pinchStartDist)));
    zoomAround(mid, newZoom);
  } else if (activePointers.size === 1 && dragStart) {
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) dragging = true;
    if (dragging && zoom > 1.02) {
      panX = dragStart.panX + dx;
      panY = dragStart.panY + dy;
    }
  }
}

function onPointerUp(e) {
  const wasSinglePointer = activePointers.size === 1 && !hadPinch;
  activePointers.delete(e.pointerId);

  if (activePointers.size === 0) {
    if (wasSinglePointer && !dragging) {
      handleSingleTap(toWorldCoords(e.clientX, e.clientY));
    }
    dragStart = null;
    dragging  = false;
    hadPinch  = false;
  }
}

// Keeps the board point under the pinch midpoint visually fixed as zoom changes.
function zoomAround(screenPt, newZoom) {
  const cx = canvas.width  / 2;
  const cy = canvas.height / 2;
  const wx = cx + (screenPt.x - cx - panX) / zoom;
  const wy = cy + (screenPt.y - cy - panY) / zoom;
  panX = (screenPt.x - cx) - newZoom * (wx - cx);
  panY = (screenPt.y - cy) - newZoom * (wy - cy);
  zoom = newZoom;
}

// Delays a tap briefly so a following second tap can cancel it and reset
// zoom/pan instead — this is the only way to disambiguate a normal tap from
// the first half of a double-tap.
function handleSingleTap(pos) {
  if (tapState && dist(pos, tapState.pos) < DOUBLE_TAP_DIST) {
    clearTimeout(tapState.timer);
    tapState = null;
    zoom = 1;
    panX = 0;
    panY = 0;
    return;
  }
  const timer = setTimeout(() => {
    tapState = null;
    onBoardTap(pos);
  }, DOUBLE_TAP_MS);
  tapState = { pos, timer };
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

  const newStormR = r.stormRadius ?? 1.0;
  if (prevStormR !== null && newStormR !== prevStormR) {
    stormFlashUntil = Date.now() + STORM_FLASH_MS;
  }
  prevStormR = newStormR;
  stormR = newStormR;

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

// Host-only silent timer — advances the storm when the round expires. No UI is shown;
// the breathing/flash on the storm boundary itself is the only hint.
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
async function onBoardTap(pos) {
  if (!roundActive || !me || !room) return;

  const dx = pos.x - boardCX;
  const dy = pos.y - boardCY;

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
    placerId, count: touchedIds.length, stoneIds: touchedIds, nx, ny, at: Date.now(),
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

// Fires for every stone removal (snap penalty or storm cull). Whichever of
// this or onSnapReceived observes the stone first captures its snapshot and
// starts the dying-animation; the other becomes a no-op via the localStones
// guard, so the kind (snap vs. storm burst-fade) is correct either way.
function onStoneRemoved(id) {
  if (!localStones.has(id)) return;

  const positions = getStonePositions();
  const snapshot  = positions.find(p => p.id === id);
  if (snapshot) {
    dyingStones.push({
      x: snapshot.x, y: snapshot.y, polarity: snapshot.polarity, playerId: snapshot.playerId,
      startTime: Date.now(),
      kind: snapKindIds.has(id) ? 'snap' : 'storm',
    });
  }
  snapKindIds.delete(id);

  removeStone(id);
  localStones.delete(id);
}

function onSnapReceived(id, snap) {
  if (snapLog.has(id)) return;
  snapLog.set(id, snap);

  for (const stoneId of snap.stoneIds ?? []) snapKindIds.add(stoneId);

  const px = boardCX + snap.nx * boardHalf;
  const py = boardCY + snap.ny * boardHalf;

  ripples.push({ x: px, y: py, until: Date.now() + RIPPLE_MS });
  floatingTexts.push({ x: px, y: py, text: `+${snap.count}`, startTime: Date.now() });
  shakeUntil = Date.now() + SHAKE_MS;
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
  const now = Date.now();

  // Full-bleed cream background behind everything, including outside the board band.
  ctx.fillStyle = '#F5F0E8';
  ctx.fillRect(0, 0, W, H);

  ctx.save();

  // Screen shake — a few px of jitter on top of the zoom/pan transform.
  if (now < shakeUntil) {
    ctx.translate((Math.random() * 2 - 1) * SHAKE_AMPLITUDE, (Math.random() * 2 - 1) * SHAKE_AMPLITUDE);
  }

  // Zoom/pan view transform — board content only; HUD chips are separate DOM
  // elements and are unaffected.
  ctx.translate(W / 2 + panX, H / 2 + panY);
  ctx.scale(zoom, zoom);
  ctx.translate(-W / 2, -H / 2);

  drawDotGrid();
  drawStormBoundary(now);

  const stones = getStonePositions();
  for (const stone of stones) {
    if (stone.polarity === '+') drawDangerRadius(stone);
  }
  for (const stone of stones) {
    drawStone(stone);
  }

  drawDyingStones(now);
  drawRipples(now);
  drawFloatingTexts(now);

  ctx.restore();
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

// Storm boundary breathes (opacity 0.3 <-> 0.8, 3s loop) as the only ambient
// hint that the storm is live. On advance it flashes bright red for 300ms —
// still no numeric countdown anywhere.
function drawStormBoundary(now) {
  const sh = boardHalf * stormR;
  ctx.save();
  if (now < stormFlashUntil) {
    ctx.strokeStyle = '#E63946';
    ctx.globalAlpha = 1;
  } else {
    ctx.strokeStyle = '#1C1208';
    ctx.globalAlpha = 0.55 + 0.25 * Math.sin((now / BREATH_PERIOD_MS) * Math.PI * 2);
  }
  ctx.lineWidth = 2;
  ctx.setLineDash([9, 5]);
  ctx.strokeRect(boardCX - sh, boardCY - sh, sh * 2, sh * 2);
  ctx.restore();
}

// Faint dashed ring showing a live + stone's snap radius — 1980s selection-ring
// styling, not a glow. Naturally disappears once the stone snaps, since it's
// only drawn for stones currently returned by getStonePositions().
function drawDangerRadius({ x, y }) {
  ctx.save();
  ctx.strokeStyle = 'rgba(28,18,8,0.1)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(x, y, SNAP_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function placementScale(placedAt) {
  const elapsed = Date.now() - (placedAt || 0);
  if (elapsed < 0 || elapsed >= PLACEMENT_ANIM_MS) return 1;
  const t = elapsed / PLACEMENT_ANIM_MS;
  return t < 0.66 ? lerp(0, 1.1, t / 0.66) : lerp(1.1, 1.0, (t - 0.66) / 0.34);
}

function drawStone({ x, y, polarity, playerId, placedAt }) {
  const p     = room?.players?.[playerId];
  const color = p?.color ?? '#1C1208';
  const r     = 12;

  // Stones outside the storm boundary fade to 30% opacity, non-interactive
  const dx           = x - boardCX;
  const dy           = y - boardCY;
  const sh           = boardHalf * stormR;
  const outsideStorm = Math.abs(dx) > sh || Math.abs(dy) > sh;
  const scale         = placementScale(placedAt);

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  if (outsideStorm) ctx.globalAlpha = 0.3;
  if (polarity === '+') {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#1C1208';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.stroke();

    ctx.fillStyle    = '#F5F0E8';
    ctx.font         = 'bold 13px "Space Mono", monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+', 0, 0.5);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#F5F0E8';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#1C1208';
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, r - 4, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.fillStyle    = '#1C1208';
    ctx.font         = 'bold 13px "Space Mono", monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('−', 0, 0.5);
  }
  ctx.restore();
}

// Snapped stones scale to 1.4x and vanish over 80ms; storm-culled stones
// burst slightly and fade over 250ms.
function drawDyingStones(now) {
  dyingStones = dyingStones.filter(d => now - d.startTime < (d.kind === 'snap' ? SNAP_VANISH_MS : STORM_BURST_MS));
  for (const d of dyingStones) {
    const dur   = d.kind === 'snap' ? SNAP_VANISH_MS : STORM_BURST_MS;
    const t     = (now - d.startTime) / dur;
    const scale = d.kind === 'snap' ? lerp(1, 1.4, t) : lerp(1, 1.3, t);
    const color = room?.players?.[d.playerId]?.color ?? '#1C1208';

    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.translate(d.x, d.y);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fillStyle = d.polarity === '+' ? '#1C1208' : '#F5F0E8';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.stroke();
    ctx.restore();
  }
}

// White ripple burst at the snap coordinates.
function drawRipples(now) {
  ripples = ripples.filter(rp => rp.until > now);
  for (const rp of ripples) {
    const remaining = (rp.until - now) / RIPPLE_MS; // 1 -> 0
    ctx.save();
    ctx.globalAlpha = remaining * 0.9;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.arc(rp.x, rp.y, 10 + (1 - remaining) * 60, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// Floating "+N" text rising from the snap point.
function drawFloatingTexts(now) {
  floatingTexts = floatingTexts.filter(f => now - f.startTime < FLOAT_TEXT_MS);
  for (const f of floatingTexts) {
    const t     = (now - f.startTime) / FLOAT_TEXT_MS;
    const y     = f.y - t * FLOAT_RISE_PX;
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle   = '#1C1208';
    ctx.font        = 'bold 16px "Space Mono", monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.text, f.x, y);
    ctx.restore();
  }
}

// ── Minimap (unaffected by board zoom/pan — always shows the full overview) ──
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
