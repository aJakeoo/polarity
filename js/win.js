import { getOrCreatePlayerId, getParam, avatarSrc, showToast } from './main.js';
import { subscribeToRoom, getSnapScores, resetToLobby } from './firebase.js';
import { haptics } from './haptics.js';

const roomCode = getParam('room');
const myId     = getOrCreatePlayerId();

if (!roomCode) window.location.href = '../index.html';

const PODIUM_SIZE = 3;
const DOT_MAX      = 5;

let room     = null;
let rendered = false;

// ── Boot ──────────────────────────────────────────────────────────────────────
function init() {
  document.getElementById('back-lobby-btn').addEventListener('click', onBackToLobby);
  document.getElementById('play-again-btn').addEventListener('click', onPlayAgain);

  subscribeToRoom(roomCode, onRoomUpdate);
}

function onRoomUpdate(r) {
  if (!r) { window.location.href = '../index.html'; return; }
  room = r;

  // If rematch started, follow to lobby
  if (r.status === 'lobby') {
    window.location.href = `lobby.html?room=${roomCode}`;
    return;
  }

  if (!rendered && r.status === 'finished') {
    rendered = true;
    renderResults(r);
  }

  // Show rematch button for host
  const isHost = r.host === myId;
  document.getElementById('play-again-btn').style.display = isHost ? 'block' : 'none';
}

async function renderResults(r) {
  const players  = r.players || {};
  const maxRound = r.round   || 1;

  document.getElementById('round-label').textContent = `AFTER ${maxRound} ROUND${maxRound !== 1 ? 'S' : ''}`;

  // Snap count is a PENALTY tally, not a score — used only for the stats section.
  let penalties = {};
  try { penalties = await getSnapScores(roomCode, maxRound); } catch (_) {}

  // Rank: the declared winner first, then everyone else by fewest stones remaining.
  const sorted = Object.entries(players).sort(([idA, a], [idB, b]) => {
    if (idA === r.winner) return -1;
    if (idB === r.winner) return  1;
    const totalA = (a.plusStones ?? 0) + (a.minusStones ?? 0);
    const totalB = (b.plusStones ?? 0) + (b.minusStones ?? 0);
    return totalA - totalB;
  });

  const totalPenalties = Object.values(penalties).reduce((s, n) => s + n, 0);

  const content = document.getElementById('win-content');
  content.className = '';
  content.innerHTML = `
    <div class="podium gap-20">
      ${sorted.slice(0, PODIUM_SIZE).map(([id, p], i) => buildPodiumCard(i + 1, id, p)).join('')}
    </div>
    <div class="leaderboard gap-6" style="margin-bottom:16px">
      ${sorted.map(([id, p], i) => buildLbRow(i + 1, id, p, penalties[id] ?? 0)).join('')}
    </div>
    ${buildStats(r, totalPenalties, penalties)}
  `;
}

function buildDots(stonesRemaining) {
  const filled = Math.min(stonesRemaining, DOT_MAX);
  const dots = Array.from({ length: DOT_MAX }, (_, i) =>
    `<span class="stone-dot${i < filled ? ' filled' : ''}"></span>`
  ).join('');
  const badge = stonesRemaining > DOT_MAX ? `<span class="dot-overflow">${DOT_MAX}+</span>` : '';
  return `<div class="stone-dots">${dots}${badge}</div>`;
}

const PODIUM_ROOF_SVG = `<svg class="podium-roof" width="38" height="20" viewBox="0 0 38 20">
  <polygon points="0,20 0,7 9,0 19,9 29,0 38,7 38,20" fill="#1C1208"></polygon>
  <rect x="3" y="12" width="4" height="4" fill="#F5F0E5"></rect>
  <rect x="17" y="13" width="4" height="4" fill="#F5F0E5"></rect>
  <rect x="31" y="12" width="4" height="4" fill="#F5F0E5"></rect>
</svg>`;

function buildPodiumCard(rank, id, p) {
  const src    = avatarSrc(p.avatar, true);
  const stones = (p.plusStones ?? 0) + (p.minusStones ?? 0);
  const label  = rank === 1 ? '1ST' : rank === 2 ? '2ND' : '3RD';
  const footer = rank === 1
    ? `<span class="podium-winner-badge">[ WINNER ]</span>`
    : buildDots(stones);
  return `
    <div class="podium-card podium-${rank}">
      ${rank === 1 ? PODIUM_ROOF_SVG : ''}
      <span class="podium-rank-badge">[ ${label} ]</span>
      <div class="podium-avatar" style="background:${p.color || '#CCCCCC'}">
        <img src="${src}" alt="${p.name}">
      </div>
      <div class="podium-name">${p.name || 'PLAYER'}</div>
      ${footer}
    </div>`;
}

function buildLbRow(rank, id, p, penaltyCount) {
  const src    = avatarSrc(p.avatar, true);
  const isMe   = id === myId;
  const stones = (p.plusStones ?? 0) + (p.minusStones ?? 0);
  return `
    <div class="lb-row" style="${isMe ? 'border-color:var(--ink)' : ''}">
      <span class="lb-rank">#${rank}</span>
      <div class="lb-avatar" style="background:${p.color || '#CCCCCC'}">
        <img src="${src}" alt="${p.name}">
      </div>
      <span class="lb-name">${p.name || 'PLAYER'}${isMe ? ' (YOU)' : ''}</span>
      <span class="lb-snaps">${penaltyCount} PENALT${penaltyCount !== 1 ? 'IES' : 'Y'}</span>
      <span class="lb-stones">+${p.plusStones ?? 0} −${p.minusStones ?? 0}</span>
    </div>`;
}

function buildStats(r, totalPenalties, penalties) {
  const penaltyValues = Object.values(penalties);
  const maxChain = penaltyValues.length > 0 ? Math.max(...penaltyValues) : 0;
  const myPenalties = penalties[myId] ?? 0;

  return `
    <div class="stats-section gap-20" style="margin-bottom:4px">
      <p class="section-label" style="margin-bottom:8px">[ GAME STATS ]</p>
      <div class="stats-row">
        <span class="stats-label">TOTAL SNAP PENALTIES</span>
        <span class="stats-value">${totalPenalties}</span>
      </div>
      <div class="stats-row">
        <span class="stats-label">YOUR SNAP PENALTIES</span>
        <span class="stats-value">${myPenalties}</span>
      </div>
      <div class="stats-row">
        <span class="stats-label">ROUNDS PLAYED</span>
        <span class="stats-value">${r.round ?? 1}</span>
      </div>
      <div class="stats-row">
        <span class="stats-label">MOST PENALIZED</span>
        <span class="stats-value">${maxChain}</span>
      </div>
    </div>`;
}

// ── Actions ───────────────────────────────────────────────────────────────────
async function onPlayAgain() {
  if (room?.host !== myId) return;
  haptics.tap();
  const btn = document.getElementById('play-again-btn');
  btn.disabled = true;
  try {
    const playerIds = Object.keys(room?.players || {});
    await resetToLobby(roomCode, playerIds);
  } catch (e) {
    showToast('[ ERROR ]');
    btn.disabled = false;
  }
}

function onBackToLobby() {
  haptics.tap();
  window.location.href = `lobby.html?room=${roomCode}`;
}

init();
