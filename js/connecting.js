import {
  getOrCreatePlayerId,
  getPlayerAvatar,
  generateRoomCode,
  pickColor,
  getParam,
} from './main.js';
import { createRoom, joinRoom, roomExists, getUsedColors } from './firebase.js';

const STATUS_TEXT = {
  creating: '[ CREATING ROOM... ]',
  joining:  '[ JOINING ROOM... ]',
};

const mode = getParam('mode');
const name = getParam('name') || '';
const room = getParam('room') || '';

document.getElementById('status-text').textContent =
  STATUS_TEXT[mode] || '[ CONNECTING... ]';

async function run() {
  const playerId = getOrCreatePlayerId();

  try {
    if (mode === 'creating') {
      const color = pickColor([]);
      let code;
      let attempts = 0;
      do {
        code = generateRoomCode();
        attempts++;
      } while (await roomExists(code) && attempts < 10);

      await createRoom(code, { id: playerId, name, avatar: getPlayerAvatar(), color });
      window.location.href = `lobby.html?room=${code}`;
      return;
    }

    if (mode === 'joining') {
      const usedColors = await getUsedColors(room);
      const color       = pickColor(usedColors);

      await joinRoom(room, { id: playerId, name, avatar: getPlayerAvatar(), color });
      window.location.href = `lobby.html?room=${room}`;
      return;
    }

    window.location.href = '../index.html';
  } catch (err) {
    window.location.href = `../index.html?error=${encodeURIComponent(err.message || 'CONNECTION FAILED')}`;
  }
}

run();
