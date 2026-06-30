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
