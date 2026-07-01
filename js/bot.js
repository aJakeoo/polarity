import { AVATARS, PLAYER_COLORS } from './main.js';

const BOT_NAMES = ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'ECHO',
                   'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET'];
const CLUSTER_AVOID_R = 50;  // matches physics.js SNAP_RADIUS — bots avoid triggering snaps

// Build a bot identity { id, name, avatar, color }. Starting stones/flux/powerUps
// are assigned by firebase.js addBotToRoom, matching every other player's starting state.
export function createBot(index, usedColors = [], usedAvatarIds = []) {
  const color = PLAYER_COLORS.find(c => !usedColors.includes(c))
             ?? PLAYER_COLORS[index % PLAYER_COLORS.length];

  const available = AVATARS.filter(a => !usedAvatarIds.includes(a.id));
  const pool   = available.length > 0 ? available : AVATARS;
  const avatar = pool[Math.floor(Math.random() * pool.length)].id;

  return {
    id:     `bot_${index}_${Math.random().toString(36).slice(2, 6)}`,
    name:   BOT_NAMES[index % BOT_NAMES.length],
    avatar,
    color,
  };
}

// Returns {nx, ny} normalized coords within the storm-safe zone,
// avoiding positions near existing stone clusters.
// existingNxNy: array of { nx, ny } for all stones currently on the board.
export function getBotPlacement(stormR, boardR, existingNxNy = []) {
  const safeNormR = stormR - (24 / boardR);

  for (let i = 0; i < 40; i++) {
    const angle = Math.random() * Math.PI * 2;
    // sqrt gives uniform distribution over circle area
    const dist  = Math.sqrt(Math.random()) * safeNormR;
    const nx    = Math.cos(angle) * dist;
    const ny    = Math.sin(angle) * dist;

    const blocked = existingNxNy.some(e => {
      const dx = (e.nx - nx) * boardR;
      const dy = (e.ny - ny) * boardR;
      return Math.hypot(dx, dy) < CLUSTER_AVOID_R;
    });

    if (!blocked) return { nx, ny };
  }

  // Fallback: centre-ish random position
  const angle = Math.random() * Math.PI * 2;
  const dist  = Math.random() * safeNormR * 0.5;
  return { nx: Math.cos(angle) * dist, ny: Math.sin(angle) * dist };
}
