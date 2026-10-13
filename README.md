# Simple Tactical Battle

A fast, tap-first turn-based space skirmish for your phone. Fork of
[tactical-space-battle](https://github.com/jdwd40/tactical-space-battle), rebuilt from the
ground up to be simpler, punchier and more fun.

Command the battlecruiser Shadow-Dancer against endless waves of the Federation fleet on an
8×10 asteroid field. Every turn you get **three actions** across four weapons, movement and
shields. Then the enemy moves. Survive as many waves as you can, chain kills for combo points,
and beat your best score.

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
| Laser | 1 action, 15 energy | 20 damage, range 4, needs line of sight. 20 % chance to crit for 30. |
| Railgun | 1 action, 25 energy | 35 damage to **every** ship along one of eight straight lines, stopped only by asteroids. Then 2 turns to cool down. |
| Flak | 1 action, 15 energy | 12 damage to every enemy within 2 cells. Built for fighter swarms. |
| Missile | 1 action, 1 missile | 30 damage on the target cell, 15 splash to all 8 neighbours. Arcs over asteroids. Hits you too. |
| Move | 1 action | Up to 2 cells, around asteroids. Red cells are inside enemy reach. |
| Shield | 1 action, 20 energy | Restores 25 shield. |
| End turn | — | Enemies move and fire. You regain 25 energy. |

The tactics come from lining things up: slide sideways so two ships share a rail line, let
fighters close in and flak them all at once, keep an asteroid between you and the enemy
battlecruiser's laser while your missiles arc over it.

Shields absorb damage before hull. Hull does not regenerate except by repair pickups and a small
bonus between waves.

**Nebula clouds** (purple) hide whoever sits inside them: lasers and the railgun can only hit a
hidden ship from an adjacent cell. Missiles and flak still land, so a nebula buys time, not
safety. Enemies use them too, and wounded ships will run for one.

**Loot**: two or three pickups per wave, and destroyed ships have a chance to drop one. Energy
cell, shield charge, missile crate, repair kit, rail capacitor (resets the railgun cooldown),
overdrive (an extra action right now) and salvage (score).

Enemies: **Fighters** (fast, fragile, hit and run: they swoop in, fire and pull back out of
your laser range or into a cloud), **Corvettes** (quick raiders, same tactics),
**Cruisers** (balanced), **Destroyers** (slow, armoured, fire missiles), enemy
**Battlecruisers** (a match for your own ship) and the **Warlord** boss every fifth wave.
Enemies scale up after wave 5.

Scoring: kills are worth more on later waves and when chained in the same turn. Clearing a wave
awards a bonus that scales with your remaining hull. Best score is saved on the device.

## Mobile first

Designed for a portrait phone first (tested layouts at 412×915 Pixel 8, 360×640, landscape and
1366×768 desktop). Large touch targets, safe-area insets, no zoom, haptic buzz on hits, and
respects `prefers-reduced-motion`. Keyboard shortcuts on desktop: `1`–`6` select actions,
`Enter`/`Space` ends the turn, `Esc` cancels.

## Bling

- Six distinct ship classes drawn as detailed neon vector hulls with armour plates, bridges, running lights and engine flames
- Shield bubbles, hit flashes, railgun slugs and flak bursts
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
