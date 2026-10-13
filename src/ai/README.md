# Opponent planner (TSB-40)

`src/ai/index.ts` exports a local, deterministic `PlanOpponent` for the patrol frigate:

| Export | Notes |
| --- | --- |
| `planOpponent` | `createOpponentPlanner(DUEL_RULES)`, ready for the duel. |
| `createOpponentPlanner(rules, tuning?)` | Binds a public `Ruleset`. It returns `(observation, memory, plannerRandomState) => { orders, memory, plannerRandomState }`. |
| `PLANNER_TUNING` | Behaviour thresholds: hypotheses inside the approved rules. TSB-51 kept every value (see below). |

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
  - A stale contact whose measurement changed since the last plan (seen briefly in between) restarts `INVESTIGATE` from the newer measurement (TSB-51 D2).
  - On reaching the target without reacquiring, `SEARCH` picks seeded reachable points inside the uncertainty disc.
  - When the engine expires the contact memory, the ship returns to `PATROL`: eight public waypoints, in an order seeded once on first use.
  - A contact seen again returns to `ENGAGE` under the same alias.
- **Movement** uses only open, reachable cells. A breadth-first search applies the engine's movement rule: eight neighbours, no diagonal corner cutting.
  - `ENGAGE` closes to a 5-cell standoff with a clear sightline.
  - At hull ≤ 35 it disengages up to 8 cells away, preferring cells out of the contact's sightline. It holds fire only when that lets it cloak away; the uncloakable frigate keeps its laser while withdrawing (TSB-51 D1).
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
  - Every planner order was engine-valid, with no script fallbacks. All nine encounters ended in `defeat` for the scripted player within 5–10 turns, with 0 automatic windows and no cutoffs. These are baseline diagnostics, not balance evidence. TSB-51 re-pinned stalker seed 1 (10 turns instead of 12, from D2).
  - Re-running seed 2 (`hunter`) reproduces the final state exactly.

## Limitations

- These are modest heuristics, not search or lookahead. Destinations ignore travel-time energy budgets beyond the reserve, and evasion assumes a missile is aimed near the ship's current cell, because hostile aims are never public.
- In the bounded encounters the frigate closes to laser range quickly, so it never plotted missiles there. Missile choices are verified by the unit tests and the engine-validated sweep.
- Balance and enjoyment need human playtests; see the TSB-51 evidence below.

## TSB-51 evidence and corrections

Inputs: the reviewed 52A batch (`npm run batch -- --seeds 1,2,3,4,5`, four observation-only diagnostic players, base 4ffd1a2, `/tmp/tsb-52a-a1/twenty`) and the same command after the corrections (`/tmp/tsb-51-a1/after`, revision c21ef2c). Focused reproductions live in `src/tests/balance/`.

- **D1, corrected.** A weak frigate dropped its laser at a current contact in range while withdrawing, although an uncloakable ship gains no concealment by holding fire. In pursuit-laser seed 1, turn 5 (hull 20, contact 1 cell, laser ready), the player's t501 shot won. Now it fires while withdrawing: mutual destruction.
- **D2, corrected.** `INVESTIGATE`/`SEARCH` kept an outdated destination after a newer sighting of the same stale contact. This happened in 6 of 20 runs: (10,19), driven by a southbound velocity, while the newer measurement was the player's actual position (8.5,10.5). A changed measurement tick for the remembered alias now restarts the investigation.
- **Conditional lasers versus shots** (concealed-search seed 5, unchanged, same final hash as recorded): 8 intents, 4 shots.
  - Shots on a current lock at t201, t301 and t901.
  - Turns 4–7 waited on a stale alias (`no-current-lock`; the player was behind the (12–13, 13–14) rocks or cloaked). An unfired intent costs nothing.
  - The turn-8 pulse reacquired the player and the waiting laser fired at t814.
- **No frigate missiles, by design rather than defect.**
  - Every current contact at planning was within the laser window (≤ 7 cells; passive detection of a moving uncloaked ship reaches only 8): 53 before and 53 after the corrections. The remaining contacts were stale: 42 before, 37 after.
  - Counterfactually, 16 missiles plotted as the planner would at fresh-stale contacts (3–10 cells, ready and funded) all missed. In 12 of those turns the conditional laser hit.
  - The missile branch still fires in its niche: a current contact 7–10 cells away (`mechanics.test.ts`, seed 1 turn 3).
- **Mechanics demonstrations against the real AI** (seed 1, legal observation-only player orders, `mechanics.test.ts`):
  - A cloaked ambush lets a velocity-led missile hit (45) a frigate holding its patrol course, with no reply that turn. The same shot at the measured cell misses, and a laser cannot reach the target at 7.3 cells.
  - A pulse tracks the frigate 14 ticks earlier and beyond passive range, but breaks cloak and alerts the frigate. The frigate then changes course, the identical led missile misses, and lasers trade hits in range.
  - The frigate's own led missile hits a player who stays on the predicted cell; turning at the turn boundary evades it.
- **Tuning values were kept.**
  - Missiles are viable against course-holding targets.
  - 5 of the 9 PATROL pulses in the after batch found nothing but gave the player a new sighting of the frigate, so scanning has a cost for the AI too.
  - An even laser race still favours the frigate (160 vs 140 shields + hull, 35 per hit), so the player needs stealth or prediction to win. No numeric rule change is proposed without human playtest feedback.
- **Remaining limits.** Linear `INVESTIGATE` extrapolation overshoots when a target stops at its destination (several runs start by investigating (10,19)). The diagnostic players are not skilled, so 19 defeats and 1 mutual destruction measure them, not human balance.
