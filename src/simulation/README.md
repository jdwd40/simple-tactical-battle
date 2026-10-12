# Simulation engine (TSB-10 movement foundation)

`src/simulation/index.ts` is the engine/application entry point. It imports private contracts, so only the application controller may use it; UI, rendering and the AI planner must not. All functions are pure: inputs are never mutated and every result is recursively frozen.

| Export | Signature | Notes |
| --- | --- | --- |
| `initialiseSession` | `InitialiseSession` (`contracts/private.ts`) | Revalidates scenario/rules, derives independent uint32 streams (`random.simulation`, `random.planners.{player,patrol}`), no initial contacts. |
| `resolveTurn` | `ResolveTurn` | Exactly `rules.timing.turnTicks` ticks. Throws on a structurally invalid locked envelope, a turn/tick mismatch, or orders for a destroyed ship. |
| `observeSide` | `(state, side, rules, scenario) => SideObservation` | Planning-entry observation; `events` and `ownShip.interruptions` are empty for the coming turn. |
| `validateOrders` | `ValidateOrders` (`contracts/public.ts`) | Own observation, public map and rules only. |
| `previewRoute` | `PreviewRoute` | Same route logic as the engine; waypoints start at the current position. |
| `ENGINE_CAPABILITIES` | `{ activePulse, laser, missile }`, all `false` | Controls should offer only implemented capabilities. |

```ts
import { initialiseSession, observeSide, previewRoute, resolveTurn, validateOrders } from '../simulation'
import { DUEL_SCENARIO } from '../scenarios/private'
import { DUEL_RULES } from '../scenarios/public'

let state = initialiseSession(DUEL_SCENARIO, DUEL_RULES, seed)
const view = observeSide(state, 'player', DUEL_RULES, DUEL_SCENARIO)
const draft = { turnIndex: view.turnIndex, movement: { kind: 'destination', cell: { column: 16, row: 10 } }, sensor: 'passive', cloak: true, weapon: { kind: 'hold' } } as const
const validation = validateOrders(draft, view, DUEL_RULES)
const preview = previewRoute(draft.movement, view.ownShip, view.map, DUEL_RULES)
if (validation.structurallyValid) {
  const resolution = resolveTurn(state, { turnIndex: state.turnIndex, startTick: state.tick, automatic: false, orders: { player: draft, patrol: patrolOrders } }, DUEL_RULES, DUEL_SCENARIO)
  // Store privately; publish frames through the replay cursor only.
  const playerTurn = resolution.presentations.player
  state = resolution.nextState
}
```

## Turn semantics implemented

- Interval `(t, t+1]` is evaluated at `now = t+1`. Stages: regeneration (capped) → cloak sustain → propulsion grants → simultaneous movement → passive sensing → knowledge update/events/frames. Each stage reads one snapshot for both ships. Output order is canonical (`player`, `patrol`), never initiative.
- Presentations have `turnTicks + 1` frames: `frames[0]` at `startTick` shows the committed route before any tick runs, then one frame per tick. `assessment.revealTick` is `endTick`.
- Movement uses octile A* with tie order `(f, h, row, column)`, N/E/S/W/NE/SE/SW/NW enumeration and no corner cutting. Segment lengths are rounded integer distances (1000/1414). Integer progress is retained across turns. A swept 250-unit circle stops at the last safe point. Ships may overlap and never block each other.
- Hold clears the destination and route immediately. Repeating the same destination keeps progress. A new destination first connects to the centre of the current cell. On arrival the route becomes idle but the destination is kept (`destinationReached`).
- Energy is in milli-units. Failed cloak sustain latches `latched-unfunded` for the rest of the turn; failed propulsion pauses movement for that tick. Each interruption is recorded once per transition in `ownShip.interruptions`, `own-interruption` events and `assessment.interruptions`. `own-cloak` events fire when cloak state changes.
- Passive detection: 7 cells uncloaked, 3 cloaked, plus 1 if the target moved that tick, 12 if exposed. Line of sight is required, and a sightline touching an asteroid rectangle is blocked. Aliases (`contact-N`) persist until memory expiry. Velocity is taken from the previous distinct-tick measurement. Stale uncertainty is `age × maxShipSpeedUnitsPerTick`, capped at the distance to the farthest map corner. Contact events are `contact-acquired`, `contact-lost` and `contact-expired`. Per-tick `contact-updated` events and energy events are not emitted; frames carry those values.
- Visible event IDs are `t<tick>-<nnn>`, numbered per side and per tick, so they never reveal hidden activity.

## Limitations (next work packages)

- Active pulse, laser and missile intents are rejected by `validateOrders` (`equipment-unavailable`) and by `resolveTurn`. Their resource grants, exposure, the activity cloak latch, the `activity-breaks-cloak`/`cloak-exposure` notices and the weapon-readiness conditionals arrive in TSB-20/TSB-30. The assessment therefore always reports `not-requested` for sensor and weapon attempts.
- No damage, destruction, missiles, outcomes or automatic aftermath yet. `resolveTurn` throws if the state contains missiles. Planner memory and random streams pass through unchanged; patrol ordering belongs to the TSB-40 planner.
- `propulsion-funding` is a forecast from the own observation. It only states that movement may pause.
