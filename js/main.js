// Shared utilities used by both landing and lobby screens

export const PLAYER_COLORS = [
  '#E63946', '#457B9D', '#2A9D8F', '#E9C46A', '#F4A261',
  '#9B5DE5', '#F15BB5', '#00BBF9', '#3A86FF', '#FB5607',
  '#FF006E', '#FFBE0B', '#606C38', '#BC6C25', '#264653',
  '#8338EC', '#DDA15E', '#00F5D4', '#A8DADC', '#FEE440',
];

export const AVATARS = [
  { id: 'default',    label: 'Default',    file: 'default.png'    },
  { id: 'astronautm', label: 'Astronaut',  file: 'astronautm.png' },
  { id: 'astronautf', label: 'Pilot',      file: 'astronautf.png' },
  { id: 'wizard',     label: 'Wizard',     file: 'wizard.png'     },
  { id: 'knight',     label: 'Knight',     file: 'knight.png'     },
  { id: 'cowboy',     label: 'Cowboy',     file: 'cowboy.png'     },
  { id: 'scientist',  label: 'Scientist',  file: 'scientist.png'  },
  { id: 'pilot',      label: 'Captain',    file: 'pilot.png'      },
  { id: 'queen',      label: 'Queen',      file: 'queen.png'      },
];

// ── Player identity (persisted to localStorage) ──────────────────────────────

const LS_ID     = 'polarity_player_id';
const LS_NAME   = 'polarity_player_name';
const LS_AVATAR = 'polarity_player_avatar';

export function getOrCreatePlayerId() {
  let id = localStorage.getItem(LS_ID);
  if (!id) {
    id = 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem(LS_ID, id);
  }
  return id;
}

export function getPlayerName() {
  return localStorage.getItem(LS_NAME) || '';
}

export function setPlayerName(name) {
  localStorage.setItem(LS_NAME, name);
}

export function getPlayerAvatar() {
  return localStorage.getItem(LS_AVATAR) || 'default';
}

export function setPlayerAvatar(avatar) {
  localStorage.setItem(LS_AVATAR, avatar);
}

// ── Room code ────────────────────────────────────────────────────────────────

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export function pickColor(usedColors = []) {
  for (const c of PLAYER_COLORS) {
    if (!usedColors.includes(c)) return c;
  }
  return '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
}

// ── URL helpers ──────────────────────────────────────────────────────────────

export function getParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

// ── Navigation ───────────────────────────────────────────────────────────────

export function goToLobby(roomCode) {
  window.location.href = `screens/lobby.html?room=${roomCode}`;
}

export function goToGame(roomCode) {
  window.location.href = `screens/game.html?room=${roomCode}`;
}

// ── Toast ────────────────────────────────────────────────────────────────────

export function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// ── Avatar image path ─────────────────────────────────────────────────────────

export function avatarSrc(avatarId, fromScreensDir = false) {
  const avatar = AVATARS.find(a => a.id === avatarId) || AVATARS[0];
  const prefix = fromScreensDir ? '../' : '';
  return `${prefix}assets/avatars/${avatar.file}`;
}
