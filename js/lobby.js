import {
  getOrCreatePlayerId,
  getPlayerName,
  getPlayerAvatar,
  setPlayerAvatar,
  getParam,
  showToast,
  AVATARS,
  avatarSrc,
  PLAYER_COLORS,
} from './main.js';
import {
  subscribeToRoom,
  setReady,
  setAvatar,
  startGame,
  removePlayer,
  addBotToRoom,
} from './firebase.js';
import { createBot } from './bot.js';
import { haptics } from './haptics.js';

// ── State ────────────────────────────────────────────────────────────────────

const roomCode = getParam('room');
const myId     = getOrCreatePlayerId();
let   unsubscribe = null;
let   currentRoom = null;
let   isHost      = false;

// ── Bootstrap ────────────────────────────────────────────────────────────────

if (!roomCode) {
  window.location.href = '../index.html';
} else {
  init();
}

function init() {
  renderCodeTiles();
  setupAvatarPicker();
  setupActions();

  unsubscribe = subscribeToRoom(roomCode, onRoomUpdate);
}

// ── Room updates ─────────────────────────────────────────────────────────────

function onRoomUpdate(room) {
  if (!room) {
    showToast('[ ROOM CLOSED ]');
    setTimeout(() => window.location.href = '../index.html', 1500);
    return;
  }

  currentRoom = room;
  const players = room.players || {};
  const me      = players[myId];

  if (!me) {
    // Kicked or room expired
    showToast('[ YOU WERE REMOVED ]');
    setTimeout(() => window.location.href = '../index.html', 1500);
    return;
  }

  // Redirect when game starts
  if (room.status === 'playing') {
    window.location.href = `game.html?room=${roomCode}`;
    return;
  }

  isHost = room.host === myId;
  renderPlayers(players, me);
  updateActions(players, me);
}

// ── Render code tiles ─────────────────────────────────────────────────────────

function renderCodeTiles() {
  const container = document.getElementById('code-tiles');
  container.innerHTML = '';
  for (const ch of roomCode) {
    const tile = document.createElement('div');
    tile.className = 'code-tile';
    tile.textContent = ch;
    container.appendChild(tile);
  }
}

// ── Render player list ────────────────────────────────────────────────────────

function renderPlayers(players, me) {
  const entries  = Object.entries(players).sort((a, b) => {
    // Host first, then by join order
    if (a[1].isHost) return -1;
    if (b[1].isHost) return  1;
    return (a[1].joinedAt || 0) - (b[1].joinedAt || 0);
  });

  const list     = document.getElementById('player-list');
  list.innerHTML = '';

  const maxVisible = 20;
  const filled     = entries.length;

  entries.forEach(([id, player]) => {
    const isMine = id === myId;
    list.appendChild(buildPlayerSlot(id, player, isMine));
  });

  // Show up to 3 waiting slots (cap total at 4 for visible area)
  const waitingCount = Math.min(3, Math.max(0, 4 - filled));
  for (let i = 0; i < waitingCount; i++) {
    list.appendChild(buildWaitingSlot());
  }

  // Player count
  document.getElementById('player-count').textContent =
    `[ PLAYERS: ${filled} / 20 ]`;

  // Scroll hint
  const hint = document.getElementById('scroll-hint');
  hint.style.visibility = filled > 4 ? 'visible' : 'hidden';
}

function buildPlayerSlot(id, player, isMine) {
  const slot = document.createElement('div');
  slot.className = 'player-slot' + (isMine ? ' is-me' : '');
  if (isMine) slot.title = 'Tap to change avatar';

  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'avatar-circle';
  avatarDiv.style.borderColor = player.color || '#1A1A1A';
  avatarDiv.style.background  = player.color || '#CCCCCC';

  const img = document.createElement('img');
  img.src = avatarSrc(player.avatar, true);
  img.alt = player.name;
  img.onerror = () => { img.style.display = 'none'; };
  avatarDiv.appendChild(img);

  const nameEl = document.createElement('span');
  nameEl.className = 'player-name';
  nameEl.textContent = player.name || 'PLAYER';

  const badge = document.createElement('span');
  badge.className = 'badge ' + (player.isHost ? 'badge-host' : 'badge-ready');
  badge.textContent = player.isHost ? 'HOST' : (player.isReady ? 'READY' : 'NOT READY');
  if (!player.isHost && !player.isReady) {
    badge.className = 'badge badge-waiting';
  }

  slot.appendChild(avatarDiv);
  slot.appendChild(nameEl);
  slot.appendChild(badge);

  if (isMine) {
    slot.addEventListener('click', openAvatarPicker);
  }

  return slot;
}

function buildWaitingSlot() {
  const slot = document.createElement('div');
  slot.className = 'player-slot waiting';

  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'avatar-circle';
  avatarDiv.style.borderColor = '#CCCCCC';
  avatarDiv.style.borderStyle = 'dashed';
  const q = document.createElement('span');
  q.className = 'avatar-placeholder';
  q.textContent = '?';
  avatarDiv.appendChild(q);

  const name = document.createElement('span');
  name.className = 'player-name waiting';
  name.textContent = 'WAITING...';

  slot.appendChild(avatarDiv);
  slot.appendChild(name);
  return slot;
}

// ── Actions ───────────────────────────────────────────────────────────────────

function setupActions() {
  document.getElementById('share-btn').addEventListener('click', shareRoom);
  document.getElementById('start-btn').addEventListener('click', onStartGame);
  document.getElementById('ready-btn').addEventListener('click', onToggleReady);
  document.getElementById('leave-btn').addEventListener('click', onLeave);
}

async function onLeave() {
  haptics.tap();
  try {
    await removePlayer(roomCode, myId);
  } catch (_) { /* already gone */ }
  if (unsubscribe) unsubscribe();
  window.location.href = '../index.html';
}

function updateActions(players, me) {
  const startBtn = document.getElementById('start-btn');
  const readyBtn = document.getElementById('ready-btn');

  if (isHost) {
    startBtn.style.display = 'block';
    readyBtn.style.display = 'none';
    // Enable start anytime (bots fill empty slots)
    startBtn.disabled = false;
  } else {
    startBtn.style.display = 'none';
    readyBtn.style.display = 'block';
    readyBtn.textContent = me.isReady ? '[ NOT READY ]' : '[ READY ]';
    readyBtn.className   = me.isReady ? 'btn btn-outline' : 'btn btn-primary';
  }
}

async function onToggleReady() {
  const me = currentRoom?.players?.[myId];
  if (!me) return;
  haptics.tap();
  try {
    await setReady(roomCode, myId, !me.isReady);
  } catch (e) {
    showToast('[ ERROR ]');
  }
}

async function onStartGame() {
  haptics.tap();
  const btn = document.getElementById('start-btn');
  btn.disabled = true;
  try {
    await fillBotsIfNeeded();
    await startGame(roomCode);
  } catch (e) {
    showToast('[ ERROR STARTING GAME ]');
    btn.disabled = false;
  }
}

async function fillBotsIfNeeded() {
  const players = currentRoom?.players || {};
  const humans  = Object.values(players).filter(p => !p.isBot);
  if (humans.length >= 2) return;

  const usedColors  = Object.values(players).map(p => p.color);
  const usedAvatars = Object.values(players).map(p => p.avatar);
  const needed = 2 - humans.length;

  for (let i = 0; i < needed; i++) {
    const bot = createBot(i, usedColors, usedAvatars);
    await addBotToRoom(roomCode, bot);
    usedColors.push(bot.color);
    usedAvatars.push(bot.avatar);
  }
}

async function shareRoom() {
  haptics.tap();
  const url     = `https://ajakeo0.github.io/polarity/?room=${roomCode}`;
  const payload = {
    title: 'Polarity',
    text:  `Join my Polarity game!`,
    url,
  };
  if (navigator.share) {
    try { await navigator.share(payload); } catch (_) { /* user cancelled */ }
  } else {
    try {
      await navigator.clipboard.writeText(url);
      showToast('[ LINK COPIED ]');
    } catch (_) {
      showToast('[ ' + url + ' ]');
    }
  }
}

// ── Avatar picker ─────────────────────────────────────────────────────────────

function setupAvatarPicker() {
  const overlay = document.getElementById('avatar-overlay');
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeAvatarPicker();
  });
  document.getElementById('avatar-close').addEventListener('click', closeAvatarPicker);

  const grid = document.getElementById('avatar-grid');
  grid.innerHTML = '';

  const currentAvatar = getPlayerAvatar();

  AVATARS.forEach(avatar => {
    const option = document.createElement('div');
    option.className = 'avatar-option' + (avatar.id === currentAvatar ? ' selected' : '');
    option.dataset.id = avatar.id;

    const circle = document.createElement('div');
    circle.className = 'avatar-circle';
    const img = document.createElement('img');
    img.src = avatarSrc(avatar.id, true);
    img.alt = avatar.label;
    img.onerror = () => { img.style.display = 'none'; };
    circle.appendChild(img);

    const label = document.createElement('span');
    label.className = 'avatar-label';
    label.textContent = avatar.label;

    option.appendChild(circle);
    option.appendChild(label);
    option.addEventListener('click', () => onSelectAvatar(avatar.id));
    grid.appendChild(option);
  });
}

function openAvatarPicker() {
  document.getElementById('avatar-overlay').classList.add('open');
}

function closeAvatarPicker() {
  document.getElementById('avatar-overlay').classList.remove('open');
}

async function onSelectAvatar(avatarId) {
  haptics.tap();
  setPlayerAvatar(avatarId);

  document.querySelectorAll('.avatar-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === avatarId);
  });

  try {
    await setAvatar(roomCode, myId, avatarId);
  } catch (e) {
    showToast('[ ERROR SAVING AVATAR ]');
  }

  setTimeout(closeAvatarPicker, 300);
}
