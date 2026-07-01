// Power-up catalog — purchase is fully wired (js/shop.js, js/firebase.js buyPowerUp).
// In-game activation effects (SURGE freeze, FLIP reverse, GHOST invisible stone,
// ANCHOR gravity well) are not yet implemented; owned power-ups currently only
// display in the game HUD.

export const POWERUPS = {
  SURGE:  { label: 'SURGE',  category: 'OFFENSIVE',   cost: 120, desc: 'Freeze a player one round.' },
  FLIP:   { label: 'FLIP',   category: 'OFFENSIVE',   cost: 80,  desc: "Reverse a player's polarity one round." },
  ANCHOR: { label: 'ANCHOR', category: 'DEFENSIVE',   cost: 200, desc: 'Create a gravity well on the board.' },
  GHOST:  { label: 'GHOST',  category: 'BOARD/CHAOS', cost: 150, desc: 'Place one invisible stone.' },
};

export const POWERUP_ICONS = { SURGE: '⚡', FLIP: '↻', ANCHOR: '⚓', GHOST: '○' };
