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
  onChildRemoved,
  off,
  remove,
  onDisconnect,
  serverTimestamp,
  increment,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const STARTING_PLUS_STONES  = 50;
const STARTING_MINUS_STONES = 5;
const STARTING_FLUX         = 500;
const DEFAULT_TIMER_SECONDS = 20;
const STARTING_STORM_RADIUS = 0.95; // board fills the full screen; storm starts just inside the edge

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
    stormRadius:   STARTING_STORM_RADIUS,
    timerDuration: DEFAULT_TIMER_SECONDS,
    createdAt:     serverTimestamp(),
    players: {
      [hostPlayer.id]: {
        name:        hostPlayer.name,
        avatar:      hostPlayer.avatar,
        color:       hostPlayer.color,
        plusStones:  STARTING_PLUS_STONES,
        minusStones: STARTING_MINUS_STONES,
        flux:        STARTING_FLUX,
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
    plusStones:  STARTING_PLUS_STONES,
    minusStones: STARTING_MINUS_STONES,
    flux:        STARTING_FLUX,
    powerUps:    [null, null, null],
    isBot:       false,
    isHost:      false,
    isReady:     false,
    joinedAt:    serverTimestamp(),
  });

  // NOTE: disconnect cleanup is intentionally NOT armed here. This function
  // runs on the transient connecting.html page, which navigates away to the
  // lobby immediately after — that page-unload tears down this connection
  // and would fire the cleanup instantly, deleting the player we just wrote.
  // Cleanup is armed once the player settles on a stable page instead — see
  // armDisconnectCleanup(), called from lobby.js.
}

// Arms "remove this player if they disconnect." Call this from a page the
// player is expected to stay on for a while (the lobby), not from a
// transient page that navigates away immediately (connecting.html) — see
// the note in joinRoom() above for why that ordering matters.
export function armDisconnectCleanup(code, playerId) {
  const playerRef = ref(db, `rooms/${code}/players/${playerId}`);
  onDisconnect(playerRef).remove();
}

// Cancels a previously-armed disconnect cleanup. This messages the Firebase
// server and must be awaited — callers navigating away right after this
// (e.g. lobby -> game when the match starts) need the cancel to actually
// reach the server before the page-unload tears down the connection,
// otherwise the stale disconnect action still fires and deletes the player.
export async function cancelDisconnectCleanup(code, playerId) {
  const playerRef = ref(db, `rooms/${code}/players/${playerId}`);
  await onDisconnect(playerRef).cancel();
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

// Fires whenever a stone is deleted from this round (snap penalty or storm cull)
// so every client can remove it from their local board.
export function subscribeToStoneRemovals(code, round, cb) {
  const r = ref(db, `rooms/${code}/rounds/${round}/stones`);
  onChildRemoved(r, snap => cb(snap.key));
  return () => off(r);
}

// Deletes stones from a round's board. When placerId is given, that many
// stones are credited back to the placer's plusStones (snap penalty).
// Called with placerId=null for storm-boundary culling (no credit).
export async function removeStonesFromRound(code, round, ids, placerId, count) {
  if (ids.length === 0) return;
  const updates = {};
  for (const id of ids) updates[`rooms/${code}/rounds/${round}/stones/${id}`] = null;
  if (placerId) updates[`rooms/${code}/players/${placerId}/plusStones`] = increment(count);
  await update(ref(db), updates);
}

// Broadcasts a snap event so every client can render a board indicator at the
// snap location. Does not itself move stones or inventory (see removeStonesFromRound).
export async function recordSnapEvent(code, round, snap) {
  const snapRef = push(ref(db, `rooms/${code}/rounds/${round}/snaps`));
  await set(snapRef, {
    placerId: snap.placerId,
    count:    snap.count,
    stoneIds: snap.stoneIds ?? [],
    nx:       snap.nx,
    ny:       snap.ny,
    at:       snap.at,
  });
}

export function subscribeToSnaps(code, round, cb) {
  const r = ref(db, `rooms/${code}/rounds/${round}/snaps`);
  onChildAdded(r, snap => cb(snap.key, snap.val()));
  return () => off(r);
}

// Seamlessly advance to the next round with updated storm radius (no round_end pause)
export async function advanceRound(code, round, newStormRadius) {
  await update(ref(db, `rooms/${code}`), {
    status:      'playing',
    round,
    stormRadius: newStormRadius,
  });
}

export async function addBotToRoom(code, bot) {
  await set(ref(db, `rooms/${code}/players/${bot.id}`), {
    name:        bot.name,
    avatar:      bot.avatar,
    color:       bot.color,
    plusStones:  STARTING_PLUS_STONES,
    minusStones: STARTING_MINUS_STONES,
    flux:        STARTING_FLUX,
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
    [`rooms/${code}/stormRadius`]: STARTING_STORM_RADIUS,
    [`rooms/${code}/winner`]:      null,
    [`rooms/${code}/finishedAt`]:  null,
  };
  for (const id of playerIds) {
    updates[`rooms/${code}/players/${id}/plusStones`]  = STARTING_PLUS_STONES;
    updates[`rooms/${code}/players/${id}/minusStones`] = STARTING_MINUS_STONES;
    updates[`rooms/${code}/players/${id}/flux`]        = STARTING_FLUX;
    updates[`rooms/${code}/players/${id}/powerUps`]    = [null, null, null];
    updates[`rooms/${code}/players/${id}/isReady`]     = false;
  }
  await update(ref(db), updates);
}

// Returns { playerId: snapPenaltyCount } — how many times each player triggered
// a snap (a penalty, not an achievement) across all rounds.
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
      scores[s.placerId] = (scores[s.placerId] || 0) + 1;
    }
  }
  return scores;
}

// Deducts flux and adds a power-up to the player's queue (max 3, FIFO replacement).
export async function buyPowerUp(code, playerId, key, cost) {
  const playerRef = ref(db, `rooms/${code}/players/${playerId}`);
  const snap = await get(playerRef);
  if (!snap.exists()) throw new Error('PLAYER NOT FOUND');

  const player = snap.val();
  const flux   = player.flux ?? 0;
  if (flux < cost) throw new Error('INSUFFICIENT FLUX');

  const powerUps = player.powerUps ? [...player.powerUps] : [null, null, null];
  if (powerUps.includes(key)) throw new Error('ALREADY OWNED');

  const emptyIdx = powerUps.findIndex(p => p === null);
  if (emptyIdx !== -1) {
    powerUps[emptyIdx] = key;
  } else {
    powerUps.shift();
    powerUps.push(key);
  }

  await update(playerRef, { flux: flux - cost, powerUps });
}
