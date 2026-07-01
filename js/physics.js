// Physics engine — Matter.js with manual force application.
// Matter.js is loaded as a global script in game.html; accessed via window.Matter.
//
// + stones are STATIC anchors: placed once, never move again.
// - stones are the only dynamic bodies: they repel every nearby stone, and the
//   reaction force (their own recoil) is what makes them slide.

const STONE_RADIUS = 12;
const FORCE_K      = 0.015;    // repulsion force constant (inverse-square)
const MIN_DIST     = 14;       // clamp to prevent runaway forces at contact
export const SNAP_RADIUS = 50; // px — placement-time + stone proximity threshold

let _engine, _runner;
let _stones = new Map();  // id → { body, polarity, playerId, placedAt }

export function initPhysics() {
  const { Engine, Runner, Events } = window.Matter;

  _engine = Engine.create({ gravity: { x: 0, y: 0 } });
  _runner = Runner.create();

  Events.on(_engine, 'beforeUpdate', _applyForces);

  Runner.run(_runner, _engine);
}

export function destroyPhysics() {
  if (_runner) window.Matter.Runner.stop(_runner);
  if (_engine) window.Matter.Engine.clear(_engine);
  _stones.clear();
  _engine = null;
  _runner = null;
}

export function addStone({ id, x, y, polarity, playerId, placedAt }) {
  if (!_engine || _stones.has(id)) return;
  const { Bodies, World } = window.Matter;
  const body = Bodies.circle(x, y, STONE_RADIUS, {
    isStatic:    polarity === '+',   // + stones are fixed anchors, never move
    frictionAir: 0.015,
    restitution: 0.15,
    friction:    0,
    label:       id,
  });
  World.add(_engine.world, body);
  _stones.set(id, { body, polarity, playerId, placedAt: placedAt || Date.now() });
}

export function removeStone(id) {
  const entry = _stones.get(id);
  if (!entry) return;
  window.Matter.World.remove(_engine.world, entry.body);
  _stones.delete(id);
}

export function getStonePositions() {
  const out = [];
  for (const [id, { body, polarity, playerId }] of _stones) {
    out.push({ id, x: body.position.x, y: body.position.y, polarity, playerId });
  }
  return out;
}

// Find + stones within SNAP_RADIUS of (x, y) — used at placement time to resolve a snap.
export function findPlusStonesNear(x, y) {
  const out = [];
  for (const [id, s] of _stones) {
    if (s.polarity !== '+') continue;
    if (Math.hypot(s.body.position.x - x, s.body.position.y - y) <= SNAP_RADIUS) out.push(id);
  }
  return out;
}

// ── Force application ─────────────────────────────────────────────────────────
// Only pairs involving at least one − stone interact (repulsion). + / + pairs
// never exert force on each other — they are static anchors resolved by the
// placement-time snap check instead.
function _applyForces() {
  if (!_engine) return;
  const { Body } = window.Matter;
  const arr = [..._stones.values()];

  for (let i = 0; i < arr.length; i++) {
    const a = arr[i];
    for (let j = i + 1; j < arr.length; j++) {
      const b = arr[j];
      if (a.polarity === '+' && b.polarity === '+') continue;

      const dx   = b.body.position.x - a.body.position.x;
      const dy   = b.body.position.y - a.body.position.y;
      const dist = Math.max(Math.hypot(dx, dy), MIN_DIST);
      const ux   = dx / dist;
      const uy   = dy / dist;

      const mag = -(FORCE_K / (dist * dist)); // always repulsive
      Body.applyForce(a.body, a.body.position, { x:  ux * mag, y:  uy * mag });
      Body.applyForce(b.body, b.body.position, { x: -ux * mag, y: -uy * mag });
    }
  }
}
