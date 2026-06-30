// Power-up system — stub
// Handles FLIP, SURGE, GHOST, ANCHOR purchase and activation.
// Implemented in a future task.

export const POWERUPS = {
  FLIP:   { label: 'FLIP',   category: 'OFFENSIVE', cost: 80,  desc: "Reverse a player's polarity" },
  SURGE:  { label: 'SURGE',  category: 'OFFENSIVE', cost: 120, desc: 'Freeze a player one round'   },
  GHOST:  { label: 'GHOST',  category: 'DEFENSIVE', cost: 150, desc: 'Place one invisible stone'   },
  ANCHOR: { label: 'ANCHOR', category: 'CHAOS',     cost: 200, desc: 'Create a gravity well'       },
};

export const MAX_ACTIVE_POWERUPS = 3;
