import { getOrCreatePlayerId, getParam, showToast } from './main.js';
import { subscribeToRoom } from './firebase.js';
import { POWERUPS } from './powerups.js';
import { haptics } from './haptics.js';

const roomCode = getParam('room');
const myId     = getOrCreatePlayerId();

const ICONS = { FLIP: '~', SURGE: '$', GHOST: 'O', ANCHOR: '#' };

if (!roomCode) window.location.href = '../index.html';

let unsubRoom = null;
let room      = null;

function init() {
  document.getElementById('back-btn').addEventListener('click', () => {
    haptics.tap();
    window.location.href = `game.html?room=${roomCode}`;
  });

  renderPowerups(null);
  unsubRoom = subscribeToRoom(roomCode, onRoomUpdate);
}

function onRoomUpdate(r) {
  if (!r) { window.location.href = '../index.html'; return; }
  room = r;
  const me = r.players?.[myId];
  if (!me) { window.location.href = '../index.html'; return; }
  document.getElementById('flux-balance').textContent = me.flux ?? 0;
  renderPowerups(me);
}

function renderPowerups(me) {
  const list    = document.getElementById('powerup-list');
  const owned   = me?.powerUps?.filter(Boolean) ?? [];
  const flux    = me?.flux ?? 0;
  const maxSlot = 3;

  list.innerHTML = Object.entries(POWERUPS).map(([key, pu]) => {
    const isOwned   = owned.includes(key);
    const canBuy    = !isOwned && flux >= pu.cost && owned.length < maxSlot;
    const icon      = ICONS[key] ?? '?';

    return `
      <div class="powerup-card${isOwned ? ' owned' : ''}">
        <div class="powerup-icon">${icon}</div>
        <div class="powerup-info">
          <div class="powerup-name">${pu.label}</div>
          <div class="powerup-desc">${pu.desc}</div>
        </div>
        ${isOwned
          ? `<span class="powerup-owned-badge">OWNED</span>`
          : `<button class="powerup-buy" data-key="${key}" ${canBuy ? '' : 'disabled'}>${pu.cost}</button>`
        }
      </div>`;
  }).join('');

  list.querySelectorAll('.powerup-buy:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => onBuy(btn.dataset.key));
  });
}

function onBuy(key) {
  haptics.tap();
  showToast('[ SHOP COMING SOON ]');
}

init();
