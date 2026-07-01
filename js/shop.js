import { getOrCreatePlayerId, getParam, showToast } from './main.js';
import { subscribeToRoom, buyPowerUp } from './firebase.js';
import { POWERUPS, POWERUP_ICONS } from './powerups.js';
import { haptics } from './haptics.js';

const roomCode = getParam('room');
const myId     = getOrCreatePlayerId();

if (!roomCode) window.location.href = '../index.html';

let unsubRoom = null;
let room      = null;
let buying    = false;

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
  const list  = document.getElementById('powerup-list');
  const owned = me?.powerUps?.filter(Boolean) ?? [];
  const flux  = me?.flux ?? 0;

  let lastCategory = null;
  list.innerHTML = Object.entries(POWERUPS).map(([key, pu]) => {
    const isOwned = owned.includes(key);
    const canBuy  = !isOwned && !buying && flux >= pu.cost;
    const icon    = POWERUP_ICONS[key] ?? '?';

    const divider = pu.category !== lastCategory
      ? `<div class="cat-divider"><span class="cat-divider-line"></span><span class="cat-divider-text">[ ${pu.category} ]</span><span class="cat-divider-line"></span></div>`
      : '';
    lastCategory = pu.category;

    return `
      ${divider}
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

async function onBuy(key) {
  if (buying) return;
  haptics.tap();
  const me = room?.players?.[myId];
  if (!me) return;

  const pu = POWERUPS[key];
  buying = true;
  renderPowerups(me);

  try {
    await buyPowerUp(roomCode, myId, key, pu.cost);
    showToast(`[ ${pu.label} PURCHASED ]`);
  } catch (e) {
    showToast(`[ ${e.message || 'PURCHASE FAILED'} ]`);
  } finally {
    buying = false;
  }
}

init();
