// Bot AI — stub
// Rule-based bot that places stones within the storm zone.
// Avoids snap clusters via basic proximity checks.
// Implemented in a future task.

export function createBot(index) {
  const names = ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'ECHO',
                 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET'];
  return {
    id:     `bot_${index}`,
    name:   names[index % names.length],
    isBot:  true,
    avatar: 'default',
  };
}
