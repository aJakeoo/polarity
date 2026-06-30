// Physics engine — Matter.js with manual force application.
// Matter.js is loaded as a global script in game.html; accessed via window.Matter.

const STONE_RADIUS   = 12;
const FORCE_K        = 0.000013;  // attraction/repulsion constant
const MIN_DIST       = 9;         // minimum clamped distance for force calc
const STORM_PUSH_K   = 0.00007;   // storm boundary push constant
const SNAP_RADIUS    = 28;        // pixels — snap trigger distance

let _engine, _runner;
let _stones = new Map();  // id → { body, polarity, playerId, placedAt }
let _boardCX = 0, _boardCY = 0, _boardR = 0, _stormR = 1.0;
let _onSnap = null;
let _snapPending = new Set();

export function initPhysics({ boardCX, boardCY, boardRadius, onSnap }) {
  const { Engine, Runner, Events } = window.Matter;

  _boardCX = boardCX;
  _boardCY = boardCY;
  _boardR  = boardRadius;
  _onSnap  = onSnap;

  _engine = Engine.create({ gravity: { x: 0, y: 0 } });
  _runner = Runner.create();

  Events.on(_engine, 'beforeUpdate', _applyForces);
  Events.on(_engine, 'afterUpdate',  _checkSnaps);

  Runner.run(_runner, _engine);
}

export function destroyPhysics() {
  if (_runner) window.Matter.Runner.stop(_runner);
  if (_engine) window.Matter.Engine.clear(_engine);
  _stones.clear();
  _snapPending.clear();
  _engine = null;
  _runner = null;
}

export function addStone({ id, x, y, polarity, playerId, placedAt }) {
  if (!_engine) return;
  if (_stones.has(id)) return;

  const { Bodies, World } = window.Matter;
  const body = Bodies.circle(x, y, STONE_RADIUS, {
    frictionAir: 0.09,
    restitution: 0.15,
    friction: 0,
    label: id,
  });
  World.add(_engine.world, body);
  _stones.set(id, { body, polarity, playerId, placedAt: placedAt || Date.now() });
}

export function removeStone(id) {
  const entry = _stones.get(id);
  if (!entry) return;
  window.Matter.World.remove(_engine.world, entry.body);
  _stones.delete(id);
  _snapPending.delete(id);
}

export function clearAllStones() {
  for (const id of [..._stones.keys()]) {
    removeStone(id);
  }
}

export function getStonePositions() {
  const out = [];
  for (const [id, { body, polarity, playerId }] of _stones) {
    out.push({ id, x: body.position.x, y: body.position.y, polarity, playerId });
  }
  return out;
}

export function setStormRadius(r) {
  _stormR = r;
}

// ── Force application ─────────────────────────────────────────────────────────

function _applyForces() {
  if (!_engine) return;
  const { Body } = window.Matter;
  const arr = [..._stones.values()];
  const stormEdge = _boardR * _stormR - STONE_RADIUS * 2.5;

  for (let i = 0; i < arr.length; i++) {
    const a = arr[i];
    const pos = a.body.position;

    // Storm boundary — push bodies inward when outside safe zone
    const ox = pos.x - _boardCX;
    const oy = pos.y - _boardCY;
    const od = Math.hypot(ox, oy);
    if (od > stormEdge && od > 0) {
      const over = od - stormEdge;
      const mag  = STORM_PUSH_K * over * over;
      Body.applyForce(a.body, pos, { x: -(ox / od) * mag, y: -(oy / od) * mag });
    }

    // Stone–stone forces
    for (let j = i + 1; j < arr.length; j++) {
      const b = arr[j];
      const dx = b.body.position.x - pos.x;
      const dy = b.body.position.y - pos.y;
      const dist = Math.max(Math.hypot(dx, dy), MIN_DIST);
      const ux = dx / dist;
      const uy = dy / dist;

      // + attracts +; + repels −; − repels −
      let sign = 0;
      if (a.polarity === '+' && b.polarity === '+') sign =  1;
      else if (a.polarity !== b.polarity)            sign = -1;
      if (sign === 0) continue;

      const mag = (FORCE_K / (dist * dist)) * sign;
      Body.applyForce(a.body, pos,               { x:  ux * mag, y:  uy * mag });
      Body.applyForce(b.body, b.body.position,   { x: -ux * mag, y: -uy * mag });
    }
  }
}

// ── Snap detection ────────────────────────────────────────────────────────────

function _checkSnaps() {
  if (!_engine) return;
  const arr = [..._stones.entries()]; // [id, entry]

  for (let i = 0; i < arr.length; i++) {
    const [idA, a] = arr[i];
    if (a.polarity !== '+') continue;
    if (_snapPending.has(idA)) continue;

    for (let j = i + 1; j < arr.length; j++) {
      const [idB, b] = arr[j];
      if (b.polarity !== '+') continue;
      if (_snapPending.has(idB)) continue;
      if (a.playerId === b.playerId) continue; // no self-snap

      const dx = b.body.position.x - a.body.position.x;
      const dy = b.body.position.y - a.body.position.y;
      if (Math.hypot(dx, dy) > SNAP_RADIUS) continue;

      // Newer placed stone absorbs older
      const [winnerId, winner, loserId] =
        a.placedAt >= b.placedAt
          ? [idA, a, idB]
          : [idB, b, idA];

      _snapPending.add(loserId);

      // Schedule removal after current tick
      setTimeout(() => {
        removeStone(loserId);
        _onSnap?.({ winnerId, loserId, winnerPlayerId: winner.playerId });
      }, 0);
    }
  }
}
