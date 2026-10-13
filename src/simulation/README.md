# Simulation engine (TSB-10 movement, TSB-20 sensors and stealth)

`src/simulation/index.ts` is the engine/application entry point. It imports private contracts, so only the application controller may use it; UI, rendering and the AI planner must not. All functions are pure: inputs are never mutated and every result is recursively frozen.

| Export | Signature | Notes |
| --- | --- | --- |
| `initialiseSession` | `InitialiseSession` (`contracts/private.ts`) | Revalidates scenario/rules, derives independent uint32 streams (`random.simulation`, `random.planners.{player,patrol}`), no initial contacts. |
| `resolveTurn` | `ResolveTurn` | Exactly `rules.timing.turnTicks` ticks. Throws on a structurally invalid locked envelope, a turn/tick mismatch, or orders for a destroyed ship. |
| `observeSide` | `(state, side, rules, scenario) => SideObservation` | Planning-entry observation; `events` and `ownShip.interruptions` are empty for the coming turn. |
| `validateOrders` | `ValidateOrders` (`contracts/public.ts`) | Own observation, public map and rules only. Forecasts replay the engine's grant order exactly (see Sensors). |
| `previewRoute` | `PreviewRoute` | Same route logic as the engine; waypoints start at the current position. |
| `ENGINE_CAPABILITIES` | `{ activePulse: true, laser: false, missile: false }` | Controls should offer only implemented capabilities. |

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

- Interval `(t, t+1]` is evaluated at `now = t+1`. Stages: clock expiry and regeneration (capped) → grants in the fixed order cloak sustain → first-tick pulse → propulsion (→ weapon, TSB-30) → simultaneous movement → sensing → knowledge update/events/frames. Each stage reads one snapshot for both ships. Output order is canonical (`player`, `patrol`), never initiative.
- Presentations have `turnTicks + 1` frames: `frames[0]` at `startTick` shows the committed route before any tick runs, then one frame per tick. `assessment.revealTick` is `endTick`.
- Movement uses octile A* with tie order `(f, h, row, column)`, N/E/S/W/NE/SE/SW/NW enumeration and no corner cutting. Segment lengths are rounded integer distances (1000/1414). Integer progress is retained across turns. A swept 250-unit circle stops at the last safe point. Ships may overlap and never block each other.
- Hold clears the destination and route immediately. Repeating the same destination keeps progress. A new destination first connects to the centre of the current cell. On arrival the route becomes idle but the destination is kept (`destinationReached`).
- Energy is in milli-units and never negative. Failed cloak sustain latches `latched-unfunded` for the rest of the turn; failed propulsion pauses movement for that tick. Each interruption is recorded once per transition in `ownShip.interruptions`, `own-interruption` events and `assessment.interruptions`. `own-cloak` events fire when cloak state changes.
- Detection (inclusive, cells × `unitsPerCell`): passive 7 uncloaked / 3 cloaked; while the observer is tracking 10 / 7; plus 1 if the target moved that tick; a flat 12 in either mode while the target is exposed (no movement bonus, cloak irrelevant). Line of sight is always required, and a sightline touching an asteroid rectangle is blocked. Dead ships neither detect nor are detected. Aliases (`contact-N`) persist until memory expiry. Velocity is taken from the previous distinct-tick measurement. Stale uncertainty is `age × maxShipSpeedUnitsPerTick`, capped at the distance to the farthest map corner. Contact events are `contact-acquired`, `contact-lost` and `contact-expired`. Per-tick `contact-updated` events and energy events are not emitted; frames carry those values.
- Visible event IDs are `t<tick>-<nnn>`, numbered per side and per tick, so they never reveal hidden activity.

## Sensors and stealth (TSB-20)

- **One pulse attempt.** `sensor: 'activePulse'` requests one pulse on the turn's first tick (`now = startTick + 1`). It is paid after regeneration and the cloak sustain, and before propulsion. The attempt is spent (`turnActions.pulseAttemptSpent`) whether it succeeds or fails, and it is never retried in that turn. Turn flags reset when the next turn is committed, so they describe the turn just resolved until then.
- **Success.** The pulse costs `pulseCostMilli` (12,000). It sets `trackingUntilTick = max(current, now + trackingTicks)` and `exposureUntilTick = max(current, now + exposureTicks)`, so with the defaults the ship tracks during ticks 1–20 and is exposed during ticks 1–30. Clocks are absolute ticks and are active while `until > tick`, so they carry across any configured turn length. A successful pulse sets cloak to `latched-activity` (actual off) for the rest of the turn. A sustain already paid that tick is not refunded.
- **Failure.** If the remaining energy is short, the pulse costs nothing and adds no tracking or exposure. The ship stays passive and a funded cloak stays on. The failure is reported once as a `pulse-unfunded` interruption.
- **Cloak.** Exposure suppresses the cloak at no cost (`suppressed-exposure`). A later turn's explicit cloak order activates the cloak on the first tick at or after `exposureUntilTick`, if the sustain is funded; it does not resume within the scanning turn.
- **Observer-safe results.**
  - Own frames: `ownShip.sensor` (`passive`/`tracking`), `ownShip.clocks.{trackingUntilTick, exposureUntilTick}`, `ownShip.cloak.state`, `ownShip.turnActions.pulseAttemptSpent` and `ownShip.interruptions`.
  - Own events: `own-energy` (`reason: 'pulse'`, `deltaMilli: -12000`) on success; `own-interruption` (`pulse-unfunded`) on failure; `own-cloak` on every cloak state change.
  - Assessment: `assessment.sensorAttempt` (`not-requested` / `succeeded` / `failed: insufficient-energy`).
  - The opponent learns only what its own detection permits (contact events/frames). There is no observed-pulse event, and regeneration, sustain and propulsion stay frame values, not events.
- **Validation (UI wording already exists in `validationText.ts`):**
  - `sensor` error `equipment-unavailable` without an active sensor.
  - `cloak` warning `activity-breaks-cloak` when cloak and pulse are both ordered.
  - `cloak` conditional `cloak-exposure` with `details.readyTick` while exposure outlasts the first tick.
  - `sensor` conditional `awaiting-energy` with `details.{requiredEnergyMilli, availableEnergyMilli}` when the exact first-tick forecast cannot fund the pulse; the pulse will then fail once, not wait.
  - The `propulsion-funding` forecast includes the pulse cost and the activity latch.

## Limitations (next work packages)

- Laser and missile intents are rejected by `validateOrders` (`equipment-unavailable`) and by `resolveTurn`. Their grants, weapon exposure/cloak latch and readiness conditionals arrive in TSB-30, and `weaponAttempt` is always `not-requested`. Hostile-missile sensing (`passive/activeMissileRangeUnits`) arrives with missiles.
- No damage, destruction, missiles, outcomes or automatic aftermath yet, so `sensorAttempt` never reports `own-destroyed`. `resolveTurn` throws if the state contains missiles. Planner memory and random streams pass through unchanged; patrol ordering belongs to the TSB-40 planner.
- `propulsion-funding` is a forecast from the own observation. It only states that movement may pause.
