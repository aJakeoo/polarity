import { getOrCreatePlayerId, getParam, avatarSrc, showToast } from './main.js';
import { subscribeToRoom, getSnapScores, resetToLobby } from './firebase.js';
import { haptics } from './haptics.js';

const roomCode = getParam('room');
const myId     = getOrCreatePlayerId();

if (!roomCode) window.location.href = '../index.html';

let unsubRoom = null;
let room      = null;
let rendered  = false;

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  document.getElementById('back-lobby-btn').addEventListener('click', onBackToLobby);
  document.getElementById('play-again-btn').addEventListener('click', onPlayAgain);

  unsubRoom = subscribeToRoom(roomCode, onRoomUpdate);
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

  // Fetch snap scores across all rounds
  let scores = {};
  try { scores = await getSnapScores(roomCode, maxRound); } catch (_) {}

  // Sort players: winner first, then by snaps desc, then by plusStones desc
  const sorted = Object.entries(players)
    .filter(([, p]) => !p.isBot)   // show humans first
    .concat(Object.entries(players).filter(([, p]) => p.isBot))
    .sort(([idA, a], [idB, b]) => {
      if (idA === r.winner) return -1;
      if (idB === r.winner) return  1;
      const sa = scores[idA] ?? 0;
      const sb = scores[idB] ?? 0;
      if (sb !== sa) return sb - sa;
      return (b.plusStones ?? 0) - (a.plusStones ?? 0);
    });

  // Total snaps for stats
  const totalSnaps = Object.values(scores).reduce((s, n) => s + n, 0);

  const winnerEntry = sorted[0];
  const winnerId    = winnerEntry?.[0];
  const winnerData  = winnerEntry?.[1] ?? {};
  const winnerSnaps = scores[winnerId] ?? 0;

  const content = document.getElementById('win-content');
  content.className = '';
  content.innerHTML = `
    ${buildWinnerCard(winnerId, winnerData, winnerSnaps)}
    <div class="leaderboard gap-6" style="margin-bottom:16px">
      ${sorted.map(([id, p], i) => buildLbRow(i + 1, id, p, scores[id] ?? 0)).join('')}
    </div>
    ${buildStats(r, totalSnaps, scores)}
  `;
}

function buildWinnerCard(id, p, snaps) {
  const src = avatarSrc(p.avatar, true);
  return `
    <div class="winner-card gap-20" style="margin-bottom:16px">
      <div class="winner-avatar" style="background:${p.color || '#CCCCCC'}">
        <img src="${src}" alt="${p.name}">
      </div>
      <div class="winner-name">${p.name || 'PLAYER'}</div>
      <span class="winner-badge">WINNER</span>
      <span class="winner-snaps">${snaps} SNAP${snaps !== 1 ? 'S' : ''}</span>
    </div>`;
}

function buildLbRow(rank, id, p, snaps) {
  const src   = avatarSrc(p.avatar, true);
  const isMe  = id === myId;
  const stones = (p.plusStones ?? 0) + (p.minusStones ?? 0);
  return `
    <div class="lb-row" style="${isMe ? 'border-color:var(--ink)' : ''}">
      <span class="lb-rank">#${rank}</span>
      <div class="lb-avatar" style="background:${p.color || '#CCCCCC'}">
        <img src="${src}" alt="${p.name}">
      </div>
      <span class="lb-name">${p.name || 'PLAYER'}${isMe ? ' (YOU)' : ''}</span>
      <span class="lb-snaps">${snaps} SNAP${snaps !== 1 ? 'S' : ''}</span>
      <span class="lb-stones">+${p.plusStones ?? 0} −${p.minusStones ?? 0}</span>
    </div>`;
}

function buildStats(r, totalSnaps, scores) {
  const players = r.players || {};
  const snapValues = Object.values(scores);
  const maxChain = snapValues.length > 0 ? Math.max(...snapValues) : 0;
  const mySnaps  = scores[myId] ?? 0;

  return `
    <div class="stats-section gap-20" style="margin-bottom:4px">
      <p class="section-label" style="margin-bottom:8px">[ GAME STATS ]</p>
      <div class="stats-row">
        <span class="stats-label">TOTAL SNAPS</span>
        <span class="stats-value">${totalSnaps}</span>
      </div>
      <div class="stats-row">
        <span class="stats-label">YOUR SNAPS</span>
        <span class="stats-value">${mySnaps}</span>
      </div>
      <div class="stats-row">
        <span class="stats-label">ROUNDS PLAYED</span>
        <span class="stats-value">${r.round ?? 1}</span>
      </div>
      <div class="stats-row">
        <span class="stats-label">HIGHEST CHAIN</span>
        <span class="stats-value">${maxChain} SNAP${maxChain !== 1 ? 'S' : ''}</span>
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
