# Polarity — Output Log

---

## Session 1 — 2026-06-29

### What was done

**Project scaffolded** from scratch. Full directory structure created matching the user-specified layout.

**Avatar assets copied** — 9 PNGs moved from `avatars/pngs/` → `assets/avatars/`:
`default`, `astronautm`, `astronautf`, `cowboy`, `knight`, `wizard`, `pilot`, `queen`, `scientist`

**Files created:**

| File | Purpose |
|------|---------|
| `index.html` | Landing / join screen (the home screen, handles `?room=XXXX` deep links) |
| `css/style.css` | Complete design system — retro / Apple Lisa / early Mac aesthetic |
| `js/firebase.js` | Firebase Realtime Database — createRoom, joinRoom, setReady, startGame, subscribeToRoom, onDisconnect cleanup |
| `js/main.js` | Shared utilities — player identity (localStorage), room code generation, color picker, toast, avatarSrc path helper |
| `js/lobby.js` | Full lobby controller — real-time Firebase listener, player list render, ready toggle, start game, share, avatar picker modal |
| `js/haptics.js` | Web Vibration API wrapper (tap, snap, storm, win patterns) |
| `js/game.js` | Stub — wires up subscribeToRoom, redirects if room closes |
| `js/physics.js` | Stub — Matter.js + matter-attractors placeholders, snap radius constants |
| `js/powerups.js` | Stub — POWERUPS catalog with costs and descriptions |
| `js/bot.js` | Stub — bot factory with 10 name roster |
| `screens/lobby.html` | Lobby screen — code tiles, player list, avatar picker sheet, share + start/ready buttons |
| `screens/landing.html` | Redirect to `../index.html` (preserves ?room= param) |
| `screens/game.html` | Stub placeholder |
| `screens/shop.html` | Stub placeholder |
| `screens/win.html` | Stub placeholder |

### Firebase lobby system — what's implemented

- **Create room**: generates unique 4-letter code (no I/O to avoid confusion), checks for collision, writes full room structure to `/rooms/[CODE]`
- **Join room**: validates room exists + is in `lobby` status, picks an unused player color from the 20-color palette, writes player node, arms `onDisconnect().remove()` so players auto-clean on tab close
- **Lobby real-time sync**: `onValue` listener updates player list, count, and action buttons instantly for all connected players
- **Ready toggle**: non-host players toggle `isReady`; badge updates live for all
- **Start game**: host-only, always enabled (spec: bots fill empty slots), sets `status: 'playing'` — all clients catch this and redirect to `game.html`
- **Share**: uses `navigator.share()` on mobile (native share sheet), falls back to `clipboard.writeText` with toast confirmation
- **Avatar picker**: bottom-sheet modal, 4-column grid of all 9 current avatars, `mix-blend-mode: multiply` tinting by player color, persists to Firebase + localStorage
- **Leave**: removes player node, disarms onDisconnect, redirects to landing
- **Deep link**: `?room=XXXX` on `index.html` auto-fills the 4 join-code input boxes

### Design system implemented

Exact match to spec §11 and UI sheet:
- Background `#F5F0E8` (cream paper), ink `#1A1A1A`, border `#CCCCCC`
- All text: Courier New monospace, all-caps
- Buttons: black fill + cream text, 2px border-radius, 1.5px border
- Room code tiles: 58×58px black squares with white letters
- Player slots: white card, 1.5px black border, colored avatar circle with `mix-blend-mode: multiply`
- Waiting slots: dashed border, muted
- HOST / READY badges: small black filled chips
- 4-input code entry with auto-advance, backspace, paste support, invert-on-focus effect

### What's NOT built yet

- Game board (Matter.js physics, stone placement, snap mechanic)
- Storm / board shrink
- Flux economy
- Power-up shop screen
- Win / results screen
- Bot AI
- Sound design
- Round timer

### Next task

Build the **game board screen** (`screens/game.html`):
1. Canvas dot-grid board (cream background, `#F5F0E8`)
2. Matter.js + matter-attractors setup in `js/physics.js`
3. Stone placement on tap, + stone (attractive) / − stone (repulsive) physics bodies
4. Snap mechanic: when two + stones overlap beyond snap radius, placer absorbs all
5. HUD overlay (minimap, player list stone counts, stone selector, round timer)
6. Firebase round resolution sync (positions written at round end, not per frame)

---

## Session 2 — 2026-06-30

### What was done

**Game board built** — full implementation of the game screen, physics engine, and game controller.

**Files created/replaced:**

| File | Change |
|------|--------|
| `screens/game.html` | Full game screen — top HUD, canvas board, round overlay, bottom HUD (player strip + stone selector) |
| `js/physics.js` | Full Matter.js physics engine — stone bodies, + attraction / +− repulsion forces, storm push, snap detection |
| `js/game.js` | Full game controller — Firebase sync, stone placement, round timer, round lifecycle, canvas draw loop |
| `js/firebase.js` | Added: `placeStone`, `subscribeToStones`, `recordSnap`, `subscribeToSnaps`, `endRound`, `startRound` |

### Game board — what's implemented

**Canvas rendering:**
- Circular board on dark (#1A1A1A) surround, cream (#F5F0E8) interior
- Dot grid (28px spacing, clipped to storm boundary)
- Storm zone: darkened ring with red dashed border when `stormRadius < 1.0`
- Stones: + stone = black fill + player-color ring; − stone = white fill + player-color inner ring

**Physics (Matter.js, no plugin):**
- Gravity disabled; forces applied manually in `beforeUpdate` event
- + ↔ +: attract (force ∝ 1/d²); + ↔ −: repel; − ↔ −: no interaction
- Storm boundary: quadratic push force when body exits safe zone
- Air friction (`frictionAir: 0.09`) prevents runaway bodies

**Snap mechanic:**
- Every tick: check all cross-player + stone pairs within 28px
- Newer stone (by `placedAt`) absorbs older; winner gets +1 `plusStones` via `increment(+1)`
- Absorbed stone removed from physics; snap written by winner's client only

**Round lifecycle:**
- Host calls `endRound()` at timer expiry → `status: 'round_end'`
- Round overlay shows absorbed count + storm shrink
- Host taps `[NEXT ROUND]` → increments round, storm shrinks by 0.12 per round (min 0.3)

**Firebase schema additions:**
```
rooms/[CODE]/
  rounds/[N]/
    stones/[id]: { owner, polarity, nx, ny, placedAt }
    snaps/[id]:  { winnerId, loserId, winnerPlayerId, at }
```

### What's NOT built yet

- Win / results screen
- Power-up shop
- Bot AI
- Sound
- Game-end condition

### Next task

Build **win / results screen** (`screens/win.html`) and wire up game-end detection:
1. Detect when only one player has stones remaining (or last round completed)
2. Host sets `status: 'finished'` + `winner: playerId`
3. All clients redirect to `screens/win.html?room=XXXX`
4. Win screen: leaderboard (stones absorbed, stones remaining), winner highlight, rematch button

---

## Standing rules

- After completing every task: `git commit` + `git push` to GitHub with a descriptive message (no em dashes, no emojis), then append the session summary to this file including the commit hash.

---

## Session 3 — 2026-06-30

### What was done

**Bot AI built** and **avatar tinting fixed**. Commit: `7986e13`

**Files changed:**

| File | Change |
|------|--------|
| `js/bot.js` | Full bot AI implementation |
| `js/firebase.js` | Added `addBotToRoom`, `finishGame`, `resetToLobby`, `getSnapScores` |
| `js/lobby.js` | Bot fill on start game; avatar tinting fix |
| `js/game.js` | Bot round simulation (host-driven); bot snap recording; finished-game redirect; avatar tinting fix |

### Bot AI -- what's implemented

**`js/bot.js`:**
- `createBot(index, usedColors, usedAvatarIds)`: generates a bot with random unused avatar from all 9 characters, random unused player color from the 20-color palette, name from the BOT_NAMES roster
- `getBotPlacement(stormR, boardR, existingNxNy)`: picks a normalized (nx, ny) position within the storm-safe zone; avoids existing stone clusters within 56px (2x snap radius); falls back to center-ish position after 40 failed attempts

**Lobby bot fill (`js/lobby.js`):**
- On host clicking Start Game: if < 2 human players, adds bots to reach 2
- Each bot is written to Firebase before game starts, so all clients see them as real players
- Host disables Start button during fill to prevent double-tap

**Game bot simulation (`js/game.js`, host only):**
- `scheduleBotMoves(round, duration)`: at the start of each round, host schedules 1-3 stone placements per bot with random delays (10-80% of round duration)
- `_placeBotStone(bot, round)`: checks stone counts, picks polarity (80% plus / 20% minus), calls `getBotPlacement`, writes via `placeStone` to Firebase
- `handleLocalSnap` updated: host also records snaps won by bots (so bot stones can absorb human stones)
- `_finishGame`: host tallies snap scores across all rounds via `getSnapScores`, picks winner (tiebreak: most plusStones), writes `status: finished` to Firebase
- Game ends after the round where `stormRadius` is already at its minimum (0.3)

### Avatar tinting -- what's fixed

`mix-blend-mode: multiply` was already on all avatar images in CSS. The fix was ensuring container backgrounds use the full player color (not 20% transparent):
- `lobby.js` `buildPlayerSlot`: background changed from `color + '33'` to `color`
- `game.js` `renderPlayerStrip`: added `background:${p.color}` to `.strip-avatar` inline style

All 9 character avatars now tint correctly using player color in both lobby and game HUD, assuming their PNG backgrounds are white or transparent.

### Firebase additions

- `addBotToRoom(code, bot)`: writes bot player node
- `finishGame(code, winnerId)`: sets `status: finished`, `winner`, `finishedAt`
- `resetToLobby(code, playerIds)`: resets status, round, stormRadius, winner; resets all player stone counts to 50/5
- `getSnapScores(code, maxRound)`: reads all rounds' snaps in parallel, returns `{ playerId: snapCount }` map

### What's NOT built yet

- Win / results screen (`screens/win.html`) -- `status: finished` redirect is wired in game.js but the screen is still the stub
- Power-up activation for bots (stubbed -- power-up system not yet built)
- Bot stone count read from live Firebase state (currently reads from `room` which may lag a frame behind; good enough for now)

### Next task

Build **win / results screen** (`screens/win.html` + `js/win.js`):
1. Subscribe to room on load, read snap scores via `getSnapScores`
2. Render winner card (avatar, name, snap count)
3. Render full leaderboard sorted by snaps then stones
4. Host sees [REMATCH] button -- calls `resetToLobby`, all clients redirect to lobby on `status: lobby`
5. All players see [HOME] button

---

## Session 4 -- 2026-06-30

### What was done

**Full layout rebuild from PDF spec.** All 4 screens rebuilt to match `Polarity UI Sheet.pdf`. Commit: `20447a6`

**Files changed:**

| File | Change |
|------|--------|
| `js/physics.js` | Square boundary instead of circular; `boardHalf` replaces `boardR`; storm push per-axis |
| `js/game.js` | Square board drawing; player strip moved to top HUD; snap counter added; square tap detection; `boardHalf` throughout |
| `js/win.js` | New -- full results controller: winner card, leaderboard, stats, rematch/home buttons |
| `js/shop.js` | New -- shop controller: renders power-up cards, flux balance from Firebase |
| `screens/game.html` | Top HUD restructured: brand + round + player strip; bottom HUD: stone buttons left, timer/snap right |
| `screens/win.html` | Full results screen: winner card, leaderboard, stats section, play again + back to lobby buttons |
| `screens/shop.html` | Full shop screen: balance display, power-up card list, back button |
| `screens/lobby.html` | Text case fixes to match all-caps design system |
| `css/style.css` | Added gap-6 utility |

### What was structurally wrong (before)

| Screen | Issue |
|--------|-------|
| Game board | Board was a CIRCLE -- PDF specifies a SQUARE with dashed border |
| Game board | Storm zone was a concentric circle -- must be an inner dashed SQUARE |
| Game board | Player strip was in the bottom HUD -- PDF puts it in the top bar |
| Game board | Bottom HUD had two wide stone buttons side by side -- PDF has compact square buttons left, timer+snap right |
| Physics | Storm boundary used circular distance check and radial push -- now per-axis square push |
| Stone placement | Used circular distance check for tap detection -- now square |
| Win screen | Was a stub placeholder |
| Shop screen | Was a stub placeholder |

### What was rebuilt

**Game board (square):**
- `boardHalf` = half the side of the square board (canvas width / 2 * 0.96)
- Board drawn as a filled rectangle + dashed outer border
- Storm zone drawn as an inner dashed red rectangle
- Dot grid fills the full board area (not clipped to storm)
- Physics storm boundary: per-axis push (if |ox| > stormEdge or |oy| > stormEdge)
- Tap detection: `|dx| < stormHalf && |dy| < stormHalf`

**Results screen (complete):**
- Loads snap scores across all rounds via `getSnapScores`
- Winner card: large avatar (64px), name, WINNER badge, snap count
- Leaderboard: ranked rows with avatar, name, snaps, stone counts
- Stats: total snaps, your snaps, rounds played, highest chain
- Host: [PLAY AGAIN] button triggers `resetToLobby` -- all clients follow to lobby
- All: [BACK TO LOBBY] button

**Shop screen (functional shell):**
- Reads player flux balance from Firebase in real time
- Renders all 4 power-up cards (FLIP, SURGE, GHOST, ANCHOR) with icon, description, cost
- Buy button disabled when insufficient flux or already owned (purchase flow stubbed)

### What's NOT built yet

- Power-up purchase / activation logic (buy button shows toast "COMING SOON")
- Bot power-up usage (stubbed)
- Sound

### Next task

- Implement power-up purchase flow in `js/shop.js` and `js/firebase.js`
- Bot AI power-up activation

---
