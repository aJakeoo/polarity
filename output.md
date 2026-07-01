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

## Session 5 -- 2026-06-30

### What was done

**Physics snap mechanic fixed. Round timer removed from player UI.** Commit: `087e185`

**Files changed:**

| File | Change |
|------|--------|
| `js/physics.js` | FORCE_K 0.000013 to 0.015; frictionAir 0.09 to 0.015; SNAP_RADIUS 28px to 48px; console.log on snap |
| `js/firebase.js` | Added `advanceRound(code, round, stormRadius)`; timerDuration default 10s to 60s |
| `js/game.js` | Timer now host-only silent; removed overlay/round-end UI; uses `advanceRound` for seamless transitions |
| `screens/game.html` | Removed round overlay HTML and timer display element |

### Physics fix -- root cause

`FORCE_K = 0.000013` produced force of ~5e-9 at 50px separation. With frictionAir=0.09 the terminal velocity was ~3.5e-8 px/frame (imperceptibly tiny). Corrected values:

- `FORCE_K = 0.015` -- produces ~6e-6 force at 50px, terminal velocity ~14 px/sec; stones placed 80px apart close to snap in ~2.5 seconds
- `frictionAir = 0.015` -- low drag allows momentum to build as stones approach
- `SNAP_RADIUS = 48px` -- larger threshold, snap triggers before stones physically overlap

### Round timer removal

Rounds now advance seamlessly: host timer fires silently, calls `advanceRound()` which atomically writes `{status:'playing', round:N+1, stormRadius:X}`. All clients detect `round` change and start new round immediately. No overlay, no button press, no `round_end` status.

### What's NOT built yet

- DesignSync CSS/HTML update (Polarity.dc.html import -- was deferred for physics fix)
- Power-up purchase / activation
- Sound

---

## Session 6 -- 2026-06-30

### What was done

**Core snap mechanic fixed, storm behavior fixed, design sync CSS/fonts applied.** Commit: `5ddb2ba`

**Files changed:**

| File | Change |
|------|--------|
| `js/physics.js` | Snap: both stones now removed (not just loser); placer named `placerStoneId`, victim named `victimStoneId`; `_onSnap` passes `{ placerStoneId, victimStoneId, placerPlayerId }` |
| `js/firebase.js` | `recordSnap`: placer gets `increment(2)` penalty (both stones return to placer's inventory); `getSnapScores` updated to `placerPlayerId` field |
| `js/game.js` | `handleLocalSnap`: uses new data structure, shows "SNAPPED — +2 RETURNED" toast; `onSnapReceived`: removes both stones, uses `snapped_` prefix in snapLog; `onStoneReceived`: checks `snapped_` prefix; `startNewRound`: NO longer clears stones — board persists across rounds; `draw()`: full-bleed cream board, no dark surround, dark bands removed; `drawStone()`: stones outside storm boundary drawn at 30% opacity; win detection in `onRoomUpdate`: host triggers `finishGame` when any player reaches 0 total stones; `_finishGame`: now uses fewest-stones criterion instead of most-snaps; `_finishTriggered` state variable prevents double-finish |
| `screens/game.html` | theme-color + backgrounds changed to cream `#F5F0E5`; Space Mono font added; Google Fonts link added |
| `screens/lobby.html` | Centered title section with SVG logo + POLARITY 34px/4px-spacing + tagline + border-bottom per DC design; Space Mono font added |
| `screens/shop.html` | Space Mono Google Fonts added; theme-color updated |
| `screens/win.html` | Space Mono Google Fonts added; theme-color updated |
| `index.html` | Space Mono Google Fonts added; theme-color updated |
| `css/style.css` | Complete rewrite per Polarity.dc.html: `--paper: #F5F0E5`, `--ink: #1C1208`, `--muted: #6B5D4A`, `--border: #9E8C6E`, `--waiting-bg: #EDE6D4`; Space Mono font; all border-radius removed (flat corners); hard box-shadows on buttons (5px 5px 0) and player cards (4px 4px 0); code tiles now white with hard shadow; HOST badge solid black; READY badge green text only; `@keyframes polarityPulse` and `@keyframes dotBlink` added |

### Snap mechanic rule (corrected)

**Goal: deplete your inventory to 0. First to 0 wins.**

| Event | Effect |
|-------|--------|
| Player places a stone | Player count -1 |
| Snap triggered (placed stone hits existing + stone) | BOTH stones removed from board. PLACER gets +2 (penalty). Victim count stays at -1 from their placement. |

Snapping is a penalty for the placer. Net effect: placer count +1. Victim keeps their lower count. Strategic play: spread stones to avoid snapping opponents' stones, while tempting opponents to snap near yours.

### Storm behavior (FIX 2)

- Board is always fully visible (cream background, full-bleed)
- Storm boundary = just a dashed red rectangle that moves inward each round
- Stones outside boundary = 30% opacity, still visible, still physically active
- No board wipe, no canvas clear on round transition
- Stones from all rounds accumulate on the board

### Silent timer (FIX 3 -- confirmed from Session 5)

- No visible timer anywhere in the UI
- Timer runs on host browser only (60s default)
- On expire: `advanceRound()` fires atomically, all clients detect `round` change and add new stone subscription. Board is NOT cleared.

### What's NOT built yet

- DesignSync: index.html landing logo update (full pulsing SVG), win.html / shop.html structural layout updates
- Power-up purchase / activation
- Sound

---

## Session 7 — 2026-07-01

### What was done

**Imported Polarity.dc.html from the Claude Design MCP** (project "Polarity game UI directions", id `5a4ff7d7-9eb1-4fb2-94e3-e940593d6597`) via `DesignSync.get_file` and used it as the visual reference for every screen. Implemented the numbered mechanic/storm/shop/win fixes, added the missing Connecting screen, and ran a full QA pass. Commit: `dd452d6`.

### Mechanic fixes — audit result

Reading the code before touching anything showed most of Fix 1 and Fix 2 were **already implemented** (from earlier, uncommitted work in this same session, before a context compaction): `physics.js` already made `+` stones `isStatic: true` with zero force applied to `+`/`+` pairs, and `game.js` already resolved snaps at placement time within a 50px radius, crediting all touched stones back to the placer immediately in Firebase, with a fading ring indicator drawn at the snap location. No changes were needed there.

**Fixed:**
- **Win condition** (`js/game.js`): tightened the check from a stone-total-equals-zero comparison to an explicit `plusStones === 0 && minusStones === 0`, matching Fix 3's exact wording.
- **Removed a leftover "end game when storm bottoms out" shortcut** in `doEndRound()` that declared a fewest-stones winner once the storm reached its floor. This contradicted Fix 3 ("only 0/0 triggers the win screen") — the storm now shrinks every round via named constants `STORM_SHRINK_STEP` (0.12) and `STORM_FLOOR` (0.3) and simply parks at the floor forever; play continues until someone naturally empties both stone types.
- Storm silent host-only 20s advance and Firebase deletion of culled stones were already correct (Fix 4) — no change needed.

**Known unresolved spec tension:** Fix 2's third bullet ("if a − stone pushes a + stone into snap range, the − stone's owner takes the penalty") cannot occur under a literal reading of Fix 1 — `+` stones are completely static and can never be displaced, so their relative positions never change after placement, and continuous re-checking would be a no-op. I implemented the placement-time check faithfully but did not add dead logic for an unreachable case. Flagging this rather than writing code that can never execute.

### Connecting screen (new)

Added `screens/connecting.html` + `js/connecting.js` — the design added this as the first screen in the flow (before Lobby), with a pulsing +/− logo and a sequential three-dot indicator, reusing the `polarityPulse` / `dotBlink` keyframes that were already sitting unused in `style.css`. `index.html`'s Create/Join buttons now navigate to `connecting.html?mode=creating|joining&...` instead of calling Firebase directly; the actual `createRoom`/`joinRoom` call now happens on the connecting screen while the animation plays, then redirects to the lobby (or back to the landing screen with an error toast on failure). Flow is now **Landing → Connecting → Lobby → Game Board → Shop → Results**, matching the design.

### Game board HUD — rebuilt

The board was a fixed-height canvas sandwiched between separate top/bottom HTML bars. Both the original spec ("all UI is a floating HUD overlay... board fills full screen edge to edge") and the design file call for a full-bleed board with the HUD floating on top, so `screens/game.html` and `js/game.js` were rebuilt:
- Canvas now fills the entire viewport; all HUD chips are absolutely-positioned overlays on top of it, styled as bordered `#FDFAF2` chips with hard offset shadows per the design.
- Added a live minimap (top-left) — a small canvas that draws the actual storm boundary and stone positions scaled down, not just a decorative static image.
- Player info moved to a vertical card stack (top-right, capped at 4 visible players), each showing avatar, name, and both stone counts.
- `[ SHOP ]` moved to sit below the player stack (matching the mockup) instead of the bottom tray.
- Bottom tray restructured into `[HAND]` (tally + the two stone-select buttons) and `[POWER-UPS]` (3 slots) sections with a vertical divider between them.
- Removed the on-screen snap counter — it wasn't in the design and isn't part of any explicit fix, so it was cut rather than left as a mismatched leftover.

**Deliberate deviation from the design's static mockup:** the mockup's HUD shows `RND 3/5 · 12s` (a visible countdown). Fix 4 explicitly says "no visible timer" — this is a direct conflict between the screenshot and the numbered mechanic instructions. Resolved by keeping the chip's bordered/shadowed visual styling but showing only `RND {n}`, no countdown, treating the gameplay-behavior instruction as authoritative over the mockup's sample content.

**Also omitted:** the mockup's `⊕ ×1.2` chip has no defined function anywhere in the spec or the fix list; adding a non-functional decorative element would misrepresent a mechanic that doesn't exist, so it was left out.

### Shop screen — restyled to match design exactly

- Rebuilt `.balance-row`, `.powerup-card`, `.powerup-icon`, `.powerup-buy` etc. in `screens/shop.html` with the design's hard-offset box-shadows and sharp corners (previously used soft 3px border-radius and thin borders).
- Added category dividers (`[ OFFENSIVE ]` / `[ DEFENSIVE ]` / `[ BOARD/CHAOS ]`) in `js/shop.js`, reusing the `.cat-divider` classes already defined in `style.css`.
- **Fixed a category mismatch**: `js/powerups.js` had ANCHOR under "CHAOS" and GHOST under "DEFENSIVE" — the design file groups them the other way (ANCHOR = Defensive, GHOST = Board/Chaos). Since the design file is authoritative on conflicts, swapped both labels and updated descriptions to match the mockup's exact wording.
- `[ BACK TO GAME ]` changed from outline to solid-black to match the design.
- Purchase flow itself (deduct flux, FIFO 3-slot queue, live balance) was already fully implemented from earlier in this session — no functional change needed, only the visual layer.

### Win screen — podium fixed

- 1st place now shows a `[ WINNER ]` badge and a small roof icon instead of the 5-dot stone indicator (previously all three podium cards rendered dots identically, which didn't match the design).
- Removed border-radius from `.podium-card`, `.lb-row`, `.stats-section` for consistency with the sharp-corner system used everywhere else.
- Rebuilt the header (`.win-header`) to the design's centered `[POLARITY]` tag + large title + border-bottom treatment, replacing the small left-aligned logo lockup that didn't match.
- **Left the stats block content as-is** (total/your snap penalties, rounds played, most penalized) rather than relaunching it as the mockup's sample labels (TURNS PLAYED, FINAL BOARD, POWER-UPS USED, LONGEST CHAIN) — those would require new counters that aren't tracked anywhere in Firebase today, and fabricating placeholder values for untracked stats would be worse than keeping the real, already-correct ones.

### Global fixes

- **Space Mono was never actually loading.** Despite Session 6's log claiming "Google Fonts link added," none of the five HTML files actually had the `<link>` tag — `css/style.css` was also still declaring `'Courier New'` as the primary font. Added the Google Fonts preconnect + stylesheet link to every screen and switched all `font-family` declarations (including the two hardcoded SVG `<text>` elements in the lobby's logo mark) to Space Mono with Courier New as fallback.
- Swept the whole CSS for stray `border-radius` — confirmed every remaining instance is the deliberate circular-avatar exception, none are leftover soft-corner cards.

### QA pass results

**Could not perform live browser testing** — the Claude-in-Chrome extension reported "not connected" for this session, so functional verification below is from careful static tracing, not an actual click-through. Flagging this explicitly rather than claiming a live pass.

CODE QUALITY:
- [x] No dead code / commented-out blocks / unused variables — swept all touched files; removed the now-unreachable `_finishGame()` fewest-stones fallback and the unused `mySnapCount`/`snap-count` DOM tracking.
- [x] No `console.log` in production code — grepped the whole project, zero matches (only a comment containing the word "console").
- [x] No hardcoded magic numbers that should be constants — named `STORM_SHRINK_STEP`, `STORM_FLOOR`, `MAX_HUD_PLAYERS` in `game.js` where previously `0.12`/`0.3` were inline.
- [x] Functions do one thing — no changes needed beyond what was rewritten.
- [x] No duplicate logic — none introduced.

FUNCTIONALITY (traced, not click-tested):
- [x] Place a + stone — stays put: confirmed `isStatic: true` in `physics.js`, zero force applied to `+`/`+` pairs.
- [x] Place a + stone near another — snap fires, stones return to placer: confirmed `findPlusStonesNear` (50px) + `resolveSnapPenalty` crediting `count` back via `removeStonesFromRound`.
- [x] Place a − stone — pushes nearby stones: confirmed dynamic body + repulsion force in `_applyForces` for any pair with at least one `−`.
- [x] Storm advances silently every 20s: confirmed `DEFAULT_TIMER_SECONDS = 20`, host-only `setInterval`, no UI element renders it.
- [x] Shop buy deducts flux correctly: confirmed `buyPowerUp` checks balance, throws on insufficient funds, FIFO-replaces the oldest slot at capacity.
- [x] Win screen triggers on depletion: confirmed the tightened `plusStones === 0 && minusStones === 0` check calls `finishGame`, and all three screens (`game.js`, `win.js`) redirect correctly on `status` changes.
- [ ] **Not verified live**: actual pixel rendering, touch/tap coordinate accuracy on a real viewport, Firebase round-trip latency, multi-client sync. Recommend a manual click-through before relying on this build.

INTEGRATION:
- [x] Every `getElementById` call in `game.js`, `shop.js`, `win.js`, `connecting.js`, `lobby.js` was cross-checked against its HTML file's actual `id` attributes — all matched, no orphaned references.
- [x] Firebase schema consistent — no field-name drift found between `firebase.js` writes and every screen's reads.
- [x] No stub screens remaining — `connecting.html`, `game.html`, `shop.html`, `win.html` are all fully implemented; `landing.html` remains an intentional redirect shim to `index.html`, not a stub.

DESIGN:
- [x] Every screen's structure and styling now traces back to a specific block of Polarity.dc.html.
- [x] Space Mono monospace, all-caps, bracket notation throughout (see note above on why the QA checklist's literal "Courier New" line was superseded — the design file explicitly uses Space Mono, and per the task's own instruction, the design file wins on conflicts).
- [x] Cream `#F5F0E8`/`#F5F0E5` background on every screen.
- [x] No default browser button/input chrome visible — every interactive element has explicit background/border/font-family.

### Deliberate decisions worth knowing about

1. Avatars stay as the existing 9 real PNGs (astronaut, wizard, etc.) rather than switching to the mockup's emoji placeholders — the emoji in the design file are sample data for a real player slot, the same way "ALEX" and room code "WXYZ" are sample data.
2. The design's `RND 3/5 · 12s` visible countdown was cut down to `RND {n}` only — see Fix 4 conflict note above.
3. The `⊕ ×1.2` HUD chip was omitted — no defined mechanic behind it anywhere in the spec.
4. Win screen's stats block keeps its real, already-correct labels instead of the mockup's untracked sample stats.

### Next task

- Manual click-through QA once the Chrome extension is reconnected (place stones, trigger a snap, let a 20s round pass, buy a power-up, deplete a bot down to 0/0).
- Power-up activation effects (SURGE freeze, FLIP reverse, GHOST invisible, ANCHOR gravity well) are still not implemented — owned power-ups only display in the HUD, matching the scope of what was asked this session.
- Sound design (still not started).

---

## Session 8 — 2026-07-01

### What was done

**Feel and juice pass** — snap VFX, danger radius rings, stone placement animation, storm breathing pulse, pinch-zoom/pan, board resizing, a more prominent shop button, and a real fix for the join-room bug. Commit: `4e8c801`.

### Join Room — root cause found and fixed

Before touching anything else, traced the actual bug rather than guessing at symptoms. Root cause: `joinRoom()` in `firebase.js` called `onDisconnect(playerRef).remove()` immediately after writing the joining player's data — but that function runs on the **transient** `connecting.html` page, which navigates to `lobby.html` immediately afterward. That navigation tears down the connection that had just armed the disconnect handler, and the Firebase server fires the queued removal essentially instantly — deleting the just-joined player before the lobby even finishes loading. The host had the opposite problem: `createRoom()` never armed disconnect cleanup at all, so a host who closed their tab mid-lobby stayed listed forever.

**Fix (`js/firebase.js`, `js/lobby.js`):**
- Removed the premature `onDisconnect(...).remove()` call from `joinRoom()`.
- Added `armDisconnectCleanup(code, playerId)` — arms the removal-on-disconnect. Called once from `lobby.js`'s `init()`, on the **stable** lobby connection, for both host and joiner alike (the host is now covered too).
- Added `cancelDisconnectCleanup(code, playerId)` — cancels the pending removal. Called from `lobby.js` right before redirecting to `game.html` when the match starts, so that navigation doesn't delete the player either. This had to be `async`/awaited: cancelling messages the Firebase server, and firing `window.location.href` before that message lands would reproduce the exact same race — the fix uses `cancelDisconnectCleanup(...).finally(() => navigate)`.
- Disconnect cleanup is deliberately **not** armed anywhere in `game.js`, `shop.js`, or `win.js` — those pages are reached via in-match navigation (e.g. game → shop → game), and arming removal-on-disconnect there would delete a player's data just for checking the shop mid-match.

**Could not live-test with two browser sessions as asked** — the Claude-in-Chrome extension reported "not connected" on retry. Verified via careful tracing of the actual write/navigate/disconnect sequence instead. **Worth knowing**: testing with two tabs in the *same* browser profile won't exercise this properly — `getOrCreatePlayerId()` reads/writes a single `localStorage` key, so two tabs in one profile share one player identity. Use two different profiles, or a regular window + an incognito window, to get two distinct players.

Auto-fill from `?room=` was already implemented in `index.html` from a prior session and needed no changes — confirmed it still reads the query param, uppercases/sanitizes it, and pre-fills the four join-code tiles.

### Snap VFX (`js/game.js`)

- Snapped stones scale to 1.4x and fade out over 80ms (`drawDyingStones`, kind `'snap'`).
- White ripple burst at the snap coordinates (`drawRipples` — reused/recolored the prior red snap-indicator mechanism).
- Floating `+N` text rises 40px and fades over 700ms from the snap point (`drawFloatingTexts`).
- Screen shake: ±3px jitter for 150ms, applied as a canvas translate before the zoom/pan transform each frame (`shakeUntil`).
- Haptics `[30, 10, 30]` — this was already `haptics.snap()`'s exact pattern from an earlier session; confirmed unchanged and still only fires for the placer (not every viewer), which is correct — only your own device should buzz for your own action.

**A genuine race worth flagging:** a snap simultaneously (a) writes a `snaps/{id}` event and (b) deletes the touched stones from `rounds/{round}/stones/{id}`. Both are separate Firebase writes a client learns about via two separate listeners (`subscribeToSnaps` / `subscribeToStoneRemovals`), and delivery order between them isn't guaranteed. To make the *visual result* correct regardless of order: `onSnapReceived` marks the event's `stoneIds` in a `snapKindIds` Set as soon as it arrives; `onStoneRemoved` checks that Set to decide whether a given removal gets the snap-vanish animation or the storm-burst-fade animation, and works correctly whichever of the two listeners fires first. Added a `stoneIds` field to the snap event schema in Firebase (`recordSnapEvent`) to make this possible — previously the event only carried a count and a location, not which specific stones were involved.

### Danger radius (`js/game.js`)

Every live `+` stone draws a faint dashed ring at its actual 50px snap radius (`SNAP_RADIUS`, imported from `physics.js`) — 1px dashed, ink at 10% opacity. Deliberately plain (no glow, no animation) to match the "old Mac selection ring" reference rather than a modern effect. Disappears automatically once a stone snaps, since the ring is only drawn for stones `getStonePositions()` still returns — no extra bookkeeping needed.

### Stone placement animation (`js/game.js`)

`drawStone` now computes a scale factor from `Date.now() - placedAt` (0 → 1.1 → 1.0 over 150ms, piecewise-lerp bounce) and applies it as a local canvas transform before drawing the stone's shapes. `placedAt` had to be threaded through `physics.js`'s `getStonePositions()`, which previously only returned position/polarity/owner. The short tap haptic (`navigator.vibrate(10)`) was already `haptics.tap()` from an earlier session and needed no change.

### Storm breathing pulse (`js/game.js`)

- The storm boundary's opacity now cycles 0.3 → 0.8 on a 3-second sine loop (`drawStormBoundary`) instead of a fixed opacity — this is the *only* visible hint that a round is progressing; still no numeric countdown anywhere.
- On storm advance, the boundary flashes bright red (`#E63946`) for 300ms. Detected by comparing the room's `stormRadius` against the previously-seen value in `onRoomUpdate` (`prevStormR`) — guarded so the very first room snapshot never falsely flashes.
- Eliminated stones burst-fade (scale to 1.3x, fade over 250ms) via the same `dyingStones` mechanism used for snaps, just tagged `kind: 'storm'` instead of `kind: 'snap'`.

### Zoom and pan (`js/game.js`)

Replaced the single `pointerdown` → place-stone wiring with full pointer/gesture handling:
- **Pinch to zoom**: tracks up to two active pointers; zoom is clamped to [0.5x, 3x] and re-centered on the pinch midpoint each frame (`zoomAround`) so the point under your fingers stays visually fixed as you zoom, rather than the view jumping to the canvas center.
- **Drag to pan**: a single pointer moving more than 6px while zoomed in (`zoom > 1.02`) pans instead of placing a stone.
- **Double-tap to reset**: zoom and pan snap back to 1x/0,0.
- **Tap to place**: unchanged in effect, but now goes through `toWorldCoords()` to invert the current zoom/pan transform before hit-testing against the board.

**Deliberate tradeoff, flagged rather than hidden:** disambiguating a normal tap from "the first half of a double-tap" requires *not* committing to either action until either a timeout expires or a second tap arrives. This adds roughly 280ms of latency to every single stone placement (`DOUBLE_TAP_MS`). There's no way to support instant-placing taps and reliable double-tap-to-reset simultaneously — a tap has to either commit immediately (making double-tap-to-place indistinguishable from double-tap-to-reset) or wait briefly to see if a second tap follows. Chose the wait, since double-tap-reset was explicitly requested as a first-class gesture. If the added latency feels bad in practice, the alternative is dropping double-tap-to-reset in favor of, say, a dedicated reset-zoom button.

The minimap and all HUD chips are unaffected by board zoom/pan (they're separate DOM/canvas elements) — confirmed by design, not by accident.

### Board size (`js/game.js`, `js/firebase.js`)

- `resizeCanvas()` now reserves `HUD_TOP_CLEARANCE` (64px) and `HUD_BOTTOM_CLEARANCE` (110px) and fits the square board into the vertical band between them, rather than sizing off the full viewport and letting the board sit under the floating HUD bars.
- `createRoom()` and `resetToLobby()` now seed `stormRadius: 0.95` instead of `1.0` (`STARTING_STORM_RADIUS`) — the storm boundary is visibly inset from the true board edge from round 1, rather than starting flush with it.

### Shop button (`screens/game.html`)

`.hud-shop-chip` is now larger (13px font, 11px/16px padding vs. the prior 10px/7px/10px) and uses a warm amber/brass fill (`#C9862E`, darkening to `#A8701F` on press) instead of the cream chip color, so it stands out from the rest of the HUD at a glance.

### QA pass results

**Could not perform live browser testing again this session** — Claude-in-Chrome reported "not connected" on both an initial and a retry attempt; stopped there per guidance rather than looping on a failing connection. Every item below is from re-reading the actual code paths end-to-end, including deliberately re-deriving the join-room bug from the write/navigate/disconnect sequence rather than guessing.

CODE QUALITY:
- [x] No dead code / unused variables — swept the new gesture-handling state and confirmed every declared constant and variable is read somewhere (`MIN_ZOOM`/`MAX_ZOOM` in the pinch clamp, `hadPinch` in the tap-suppression check, etc.).
- [x] No `console.log` in production code — grepped the whole project, zero matches.
- [x] No hardcoded magic numbers that should be constants — every new timing/distance value (shake amplitude, ripple duration, double-tap window, HUD clearances, etc.) is a named constant at the top of `game.js`.
- [x] No duplicate logic — fixed one before it shipped: `draw()` was calling `getStonePositions()` twice per frame (once for danger radii, once for stones); now computed once and reused.
- [x] Functions do one thing — `onStoneRemoved`/`onSnapReceived` split responsibilities cleanly (kind classification vs. shared FX triggering) specifically to avoid an ordering-dependent tangle.

FUNCTIONALITY (traced, not click-tested — see note above):
- [x] Snap VFX fires exactly once per event, from the existing `snapLog` dedupe guard in `onSnapReceived` — confirmed unchanged.
- [x] Danger radius uses the same `SNAP_RADIUS` constant (50px) as the actual snap-resolution check in `physics.js`/`resolveSnapPenalty` — confirmed they can't drift apart since it's one imported constant, not two hardcoded 50s.
- [x] Placement animation reads `placedAt` from the same value written by `placeStone()`/`tryPlaceStone()` — confirmed the field threads through Firebase → `onStoneReceived` → `physics.addStone` → `getStonePositions()` without renaming anywhere along the way.
- [x] Storm flash triggers on `stormRadius` change, confirmed guarded against a false flash on the very first room snapshot.
- [x] Zoom clamps to [0.5, 3] in both the pinch handler and nowhere else needs a redundant clamp, since `zoomAround` always receives an already-clamped value.
- [ ] **Not verified live**: actual gesture feel (pinch responsiveness, whether 280ms tap delay feels laggy in practice), real device haptics, and — most importantly — the two-browser-session join test the task explicitly asked for. Recommend testing this manually before relying on the join-room fix; the reasoning is sound but reasoning isn't the same as a live click-through, and I want to be honest about that gap rather than imply I confirmed it.

INTEGRATION:
- [x] Every `getElementById` call in the rewritten `game.js` cross-checked against `game.html`'s actual ids — all match (no ids changed this session, only CSS values and JS logic).
- [x] Firebase schema addition (`snaps/{id}.stoneIds`) is additive — old snap events without it are handled via `snap.stoneIds ?? []`, so nothing reads a field that might not exist and throws.
- [x] `armDisconnectCleanup`/`cancelDisconnectCleanup` only touch `rooms/{code}/players/{playerId}` — verified they can't affect any other player's node.

DESIGN:
- [x] Danger radius styled per the explicit ask (1px dashed, 10% ink opacity, no glow) rather than defaulting to a more "modern" glowing ring.
- [x] Shop button color (`#C9862E` amber/brass) chosen to read as warm/metallic against the cream/ink palette rather than clashing with it.

### Deliberate decisions worth knowing about

1. Double-tap-to-reset requires delaying every single tap by up to 280ms to disambiguate it from a placement. Flagged above as a real tradeoff, not a hidden cost.
2. The ordering race between a snap's two Firebase writes (event vs. stone removal) is resolved for the *visual* outcome (correct animation kind either way) but not eliminated at the network level — this only matters for cosmetic animation selection, not for game-state correctness, which was never affected.
3. Storm-culled stones get a distinct "burst-fade" (scale 1.3x, 250ms) rather than reusing the snap animation (scale 1.4x, 80ms) — same underlying mechanism, different constants, so the two feel distinguishable.

### Next task

- Live two-browser-session test of the join-room fix once the Chrome extension reconnects.
- Manual feel-check of the 280ms tap delay and pinch-zoom responsiveness on a real touch device.
- Power-up activation effects, sound design — still not started, unchanged from prior sessions.

---
