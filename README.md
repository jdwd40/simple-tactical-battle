# Simple Tactical Battle

A fast, tap-first turn-based space skirmish for your phone. Fork of
[tactical-space-battle](https://github.com/jdwd40/tactical-space-battle), rebuilt from the
ground up to be simpler, punchier and more fun.

Fly Shadow-Dancer against endless waves of Federation patrols on an 8×10 asteroid field.
Every turn you get **two actions**: move, fire the laser, lob a missile, or recharge shields.
Then the enemy moves. Survive as many waves as you can, chain kills for combo points, and beat
your best score.

## Play

```sh
npm install
npm run dev
```

Open the printed URL on your phone (the dev server listens on your LAN) or in a desktop browser.
Add `?seed=123` to replay a specific battle. The game runs entirely in the browser.

## How it plays

| Action | Cost | Effect |
| --- | --- | --- |
| Move | 1 action | Up to 2 cells, around asteroids. Red cells are inside enemy reach. |
| Laser | 1 action, 15 energy | 20 damage, range 4, needs line of sight. 20 % chance to crit for 30. |
| Missile | 1 action, 1 missile | 30 damage on the target cell, 15 splash to all 8 neighbours. Arcs over asteroids. Hits you too. |
| Shield | 1 action, 20 energy | Restores 25 shield. |
| End turn | — | Enemies move and fire. You regain 20 energy. |

Shields absorb damage before hull. Hull does not regenerate except by repair pickups and a small
bonus between waves. Pickups on the field give energy, shield, missiles or hull repair.

Enemies: **Scout** (fast, fragile), **Frigate** (balanced), **Dreadnought** (slow, armoured,
fires missiles) and the **Warlord** boss every fifth wave. Enemies scale up after wave 5.

Scoring: kills are worth more on later waves and when chained in the same turn. Clearing a wave
awards a bonus that scales with your remaining hull. Best score is saved on the device.

## Mobile first

Designed for a portrait phone first (tested layouts at 412×915 Pixel 8, 360×640, landscape and
1366×768 desktop). Large touch targets, safe-area insets, no zoom, haptic buzz on hits, and
respects `prefers-reduced-motion`. Keyboard shortcuts on desktop: `1`–`4` select actions,
`Enter`/`Space` ends the turn, `Esc` cancels.

## Bling

- Neon vector ships with engine glow, shield bubbles and hit flashes
- Laser beams, arcing missiles, particle explosions, shockwave rings, screen shake
- Floating damage numbers, crit callouts, combo and wave banners
- All sound effects are synthesised live with the Web Audio API, no audio files. Tap the speaker to mute.

## Development

```sh
npm run typecheck   # TypeScript
npm test            # Vitest unit tests for grid, rules and the turn engine
npm run build       # production build in dist/
```

The game is split into pure logic (`src/game`, fully unit tested and seed-deterministic),
canvas rendering and effects (`src/render`), synthesised audio (`src/audio`) and a small DOM HUD
(`src/ui`). `src/app.ts` sequences game events into animations and sounds.

No frameworks: Vite + TypeScript + Canvas 2D.
# simple-tactical-battle
