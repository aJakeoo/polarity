import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  push,
  onValue,
  onChildAdded,
  off,
  remove,
  onDisconnect,
  serverTimestamp,
  increment,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ── Firebase config ──────────────────────────────────────────────────────────
// Fill in your project values from the Firebase console.
// Project settings → General → Your apps → Firebase SDK snippet → Config
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBGJCnCePLUgBl0Ox_rlL_uvQHfMYcrTHk",
  authDomain:        "polarity-7f643.firebaseapp.com",
  databaseURL:       "https://polarity-7f643-default-rtdb.firebaseio.com",
  projectId:         "polarity-7f643",
  storageBucket:     "polarity-7f643.firebasestorage.app",
  messagingSenderId: "788191889853",
  appId:             "1:788191889853:web:dbc4e0b8a2565994e5ead4",
};

const app = initializeApp(FIREBASE_CONFIG);
const db  = getDatabase(app);

// ── Room operations ──────────────────────────────────────────────────────────

export async function roomExists(code) {
  const snap = await get(ref(db, `rooms/${code}`));
  return snap.exists();
}

export async function createRoom(code, hostPlayer) {
  const roomRef = ref(db, `rooms/${code}`);
  await set(roomRef, {
    host:          hostPlayer.id,
    status:        'lobby',
    round:         0,
    stormRadius:   1.0,
    timerDuration: 10,
    createdAt:     serverTimestamp(),
    players: {
      [hostPlayer.id]: {
        name:        hostPlayer.name,
        avatar:      hostPlayer.avatar,
        color:       hostPlayer.color,
        plusStones:  50,
        minusStones: 5,
        flux:        0,
        powerUps:    [null, null, null],
        isBot:       false,
        isHost:      true,
        isReady:     true,
        joinedAt:    serverTimestamp(),
      },
    },
  });
}

export async function joinRoom(code, player) {
  const exists = await roomExists(code);
  if (!exists) throw new Error('ROOM NOT FOUND');

  const statusSnap = await get(ref(db, `rooms/${code}/status`));
  if (statusSnap.val() !== 'lobby') throw new Error('GAME ALREADY IN PROGRESS');

  const playerRef = ref(db, `rooms/${code}/players/${player.id}`);
  await set(playerRef, {
    name:        player.name,
    avatar:      player.avatar,
    color:       player.color,
    plusStones:  50,
    minusStones: 5,
    flux:        0,
    powerUps:    [null, null, null],
    isBot:       false,
    isHost:      false,
    isReady:     false,
    joinedAt:    serverTimestamp(),
  });

  // Remove player if they disconnect
  onDisconnect(playerRef).remove();
}

export async function rejoinRoom(code, player) {
  const playerRef = ref(db, `rooms/${code}/players/${player.id}`);
  const snap = await get(playerRef);
  if (!snap.exists()) throw new Error('PLAYER NOT IN ROOM');
  // Re-arm disconnect cleanup
  onDisconnect(playerRef).remove();
}

export async function setReady(code, playerId, isReady) {
  await update(ref(db, `rooms/${code}/players/${playerId}`), { isReady });
}

export async function setAvatar(code, playerId, avatar) {
  await update(ref(db, `rooms/${code}/players/${playerId}`), { avatar });
}

export async function startGame(code) {
  await update(ref(db, `rooms/${code}`), { status: 'playing', round: 1 });
}

export async function getUsedColors(code) {
  const snap = await get(ref(db, `rooms/${code}/players`));
  if (!snap.exists()) return [];
  return Object.values(snap.val()).map(p => p.color);
}

export function subscribeToRoom(code, callback) {
  const roomRef = ref(db, `rooms/${code}`);
  onValue(roomRef, snap => callback(snap.exists() ? snap.val() : null));
  return () => off(roomRef);
}

export async function removePlayer(code, playerId) {
  await remove(ref(db, `rooms/${code}/players/${playerId}`));
}

// ── Round / stone operations ──────────────────────────────────────────────────

export async function placeStone(code, round, stone) {
  const stoneRef = push(ref(db, `rooms/${code}/rounds/${round}/stones`));
  const countField = stone.polarity === '+' ? 'plusStones' : 'minusStones';
  await update(ref(db), {
    [`rooms/${code}/rounds/${round}/stones/${stoneRef.key}`]: {
      owner:    stone.owner,
      polarity: stone.polarity,
      nx:       stone.nx,
      ny:       stone.ny,
      placedAt: stone.placedAt,
    },
    [`rooms/${code}/players/${stone.owner}/${countField}`]: increment(-1),
  });
  return stoneRef.key;
}

export function subscribeToStones(code, round, cb) {
  const r = ref(db, `rooms/${code}/rounds/${round}/stones`);
  onChildAdded(r, snap => cb(snap.key, snap.val()));
  return () => off(r);
}

export async function recordSnap(code, round, snap) {
  await update(ref(db), {
    [`rooms/${code}/rounds/${round}/snaps/${snap.id}`]: {
      winnerId:       snap.winnerId,
      loserId:        snap.loserId,
      winnerPlayerId: snap.winnerPlayerId,
      at:             snap.at,
    },
    [`rooms/${code}/players/${snap.winnerPlayerId}/plusStones`]: increment(1),
  });
}

export function subscribeToSnaps(code, round, cb) {
  const r = ref(db, `rooms/${code}/rounds/${round}/snaps`);
  onChildAdded(r, snap => cb(snap.key, snap.val()));
  return () => off(r);
}

export async function endRound(code, newStormRadius) {
  await update(ref(db, `rooms/${code}`), {
    status:      'round_end',
    stormRadius: newStormRadius,
    endedAt:     serverTimestamp(),
  });
}

export async function startRound(code, round) {
  await update(ref(db, `rooms/${code}`), {
    status: 'playing',
    round,
  });
}

export async function addBotToRoom(code, bot) {
  await set(ref(db, `rooms/${code}/players/${bot.id}`), {
    name:        bot.name,
    avatar:      bot.avatar,
    color:       bot.color,
    plusStones:  50,
    minusStones: 5,
    flux:        0,
    powerUps:    [null, null, null],
    isBot:       true,
    isHost:      false,
    isReady:     true,
    joinedAt:    serverTimestamp(),
  });
}

export async function finishGame(code, winnerId) {
  await update(ref(db, `rooms/${code}`), {
    status:     'finished',
    winner:     winnerId,
    finishedAt: serverTimestamp(),
  });
}

export async function resetToLobby(code, playerIds) {
  const updates = {
    [`rooms/${code}/status`]:      'lobby',
    [`rooms/${code}/round`]:       0,
    [`rooms/${code}/stormRadius`]: 1.0,
    [`rooms/${code}/winner`]:      null,
    [`rooms/${code}/finishedAt`]:  null,
  };
  for (const id of playerIds) {
    updates[`rooms/${code}/players/${id}/plusStones`]  = 50;
    updates[`rooms/${code}/players/${id}/minusStones`] = 5;
    updates[`rooms/${code}/players/${id}/isReady`]     = false;
  }
  await update(ref(db), updates);
}

export async function getSnapScores(code, maxRound) {
  const scores = {};
  const promises = [];
  for (let r = 1; r <= maxRound; r++) {
    promises.push(get(ref(db, `rooms/${code}/rounds/${r}/snaps`)));
  }
  const results = await Promise.all(promises);
  for (const snap of results) {
    if (!snap.exists()) continue;
    for (const s of Object.values(snap.val())) {
      scores[s.winnerPlayerId] = (scores[s.winnerPlayerId] || 0) + 1;
    }
  }
  return scores;
}
