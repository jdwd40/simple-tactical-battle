# Opponent planner (TSB-40)

`src/ai/index.ts` exports a local, deterministic `PlanOpponent` for the patrol frigate:

| Export | Notes |
| --- | --- |
| `planOpponent` | `createOpponentPlanner(DUEL_RULES)`, ready for the duel. |
| `createOpponentPlanner(rules, tuning?)` | Binds a public `Ruleset`. It returns `(observation, memory, plannerRandomState) => { orders, memory, plannerRandomState }`. |
| `PLANNER_TUNING` | Behaviour thresholds: hypotheses inside the approved rules, to be balanced later in TSB-51. |

Runtime modules import only `../contracts` (public types, `DUEL_RULES`, `cellCentre`, `isMapCell`, `isAsteroidCell`) and each other. They never touch the simulation, game, scenarios, a clock, `Math.random`, globals or the network; a test enforces this. Each call is a pure function of its inputs. It never sees the player's draft or committed orders, true hidden position, health or energy, or the private `terminalPending`, and it never replans mid-turn.

## Application usage (App-41)

```ts
import { planOpponent } from '../ai'

// At planning entry, plan once per patrol turn and cache the result: editing the player draft
// must not call it again. Skip the call entirely for a destroyed patrol (orders: null).
const view = engine.observeSide(state, 'patrol', rules, scenario)
const planned = planOpponent(view, state.plannerMemory.patrol, state.random.planners.patrol)
// Before resolving, store what it returned:
const next = {
  ...state,
  plannerMemory: { ...state.plannerMemory, patrol: planned.memory },
  random: { ...state.random, planners: { ...state.random.planners, patrol: planned.plannerRandomState } },
}
// Lock planned.orders as orders.patrol, in normal turns and in automatic windows while the patrol lives.
```

`createGameController({ planOpponent })` already follows this flow, including the hold fallback for invalid orders; in bounded play the planner never triggered it. Equivalent inputs give equivalent outputs, so caching one plan per planning entry also means draft edits cannot reroll the enemy.

## Behaviour

- **States** (`memory.policy`), chosen from own contacts and memory only:
  - `ENGAGE` while a ship contact is current.
  - Losing it switches to `INVESTIGATE`: the target is the last measurement advanced by its estimated velocity, clamped to its uncertainty radius and the map, then snapped to the nearest reachable cell.
  - On reaching the target without reacquiring, `SEARCH` picks seeded reachable points inside the uncertainty disc.
  - When the engine expires the contact memory, the ship returns to `PATROL`: eight public waypoints, in an order seeded once on first use.
  - A contact seen again returns to `ENGAGE` under the same alias.
- **Movement** uses only open, reachable cells. A breadth-first search applies the engine's movement rule: eight neighbours, no diagonal corner cutting.
  - `ENGAGE` closes to a 5-cell standoff with a clear sightline.
  - At hull ≤ 35 it disengages up to 8 cells away, preferring cells out of the contact's sightline.
  - Known hostile missile tracks within 6 cells, seen in the last 30 ticks, take priority: it evades up to 4 cells, maximising distance from both the track and its current position.
  - After a confirmed kill (`observedOpponentDestructionTick`, also kept in memory) it holds fire and keeps station unless evading known ordnance.
- **Weapons** (one intent, own knowledge only, energy reserve 20,000 milli kept for propulsion):
  - A current contact within laser range + 1 cell, with the laser ready by mid-turn, gets a laser at its alias.
  - Otherwise, a current contact 3–10 cells away gets a plotted missile. The aim is the measurement plus estimated velocity × the flight time, snapped to an open cell, at least 3 cells from itself, and with a path clear of asteroids grown by the missile radius. This requires ammunition and a ready cooldown.
  - Otherwise, a conditional laser on a current or stale alias, which waits in-turn for reacquisition, range, sightline, cooldown and energy.
  - There is no blind fire at unseen true positions.
- **Sensor:** a first-tick pulse only when it can find something and is affordable together with the chosen weapon.
  - `INVESTIGATE`/`SEARCH`: 50% when the predicted contact is within active range.
  - `PATROL`: 25%.
  - Never while evading or after a confirmed kill.
- **Cloak:** used only by cloak-equipped ships (the frigate has none) when idle and funded for a full turn.
- **Randomness:** the `plannerRandomState` uint32 (mulberry32 step, `random.ts`) seeds patrol order, search points and scan coin flips, and is returned advanced. Tie-breaks follow fixed breadth-first cell order.

## Verification

- `planner.test.ts` covers:
  - State transitions, including honest reacquisition.
  - Seeded reproduction and uint32 checks.
  - Predictive missile aim (cell (8,7) for a target 8 cells west moving north at 80/tick); no missile behind a rock or inside its own blast.
  - Ammunition, cooldown, energy-reserve and equipment limits; only useful pulses; disengage into cover; evasion and hold-fire.
  - An engine-validated legality sweep over 7×7 contact positions × current/stale × 4 policies, covering lasers, missiles and pulses.
  - Identical decisions for engine worlds whose patrol observations match but whose hidden player state differs.
  - No input mutation, the destroyed-ship hold, and the forbidden-import scan.
- `encounters.test.ts` runs bounded headless encounters with the real engine, as the application controller would:
  - Three observation-only player scripts (`stalker`, `hunter`, `kiter`) × seeds 1–3, at most 40 normal turns each.
  - Automatic windows are capped by `aftermathWindowBound`; exceeding it would be an invariant failure, never a draw.
  - Every planner order was engine-valid, with no script fallbacks. All nine encounters ended in `defeat` for the scripted player within 5–12 turns, with 0 automatic windows and no cutoffs. These are baseline diagnostics, not balance evidence.
  - Re-running seed 2 (`hunter`) reproduces the final state exactly.

## Limitations

- These are modest heuristics, not search or lookahead. Destinations ignore travel-time energy budgets beyond the reserve, and evasion assumes a missile is aimed near the ship's current cell, because hostile aims are never public.
- In the bounded encounters the frigate closes to laser range quickly, so it never plotted missiles there. Missile choices are verified by the unit tests and the engine-validated sweep.
- Balance (the scripted player always lost) and tuning values are for TSB-51 and human playtests.
