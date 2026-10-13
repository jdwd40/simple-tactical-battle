# Simulation engine (TSB-10 movement, TSB-20 sensors and stealth, TSB-30 lasers and missiles)

`src/simulation/index.ts` is the engine/application entry point. It imports private contracts, so only the application controller may use it; UI, rendering and the AI planner must not. All functions are pure: inputs are never mutated and every result is recursively frozen.

| Export | Signature | Notes |
| --- | --- | --- |
| `initialiseSession` | `InitialiseSession` (`contracts/private.ts`) | Revalidates scenario/rules, derives independent uint32 streams (`random.simulation`, `random.planners.{player,patrol}`), no initial contacts. |
| `resolveTurn` | `ResolveTurn` | One normal or automatic window of exactly `rules.timing.turnTicks` ticks. Throws on a structurally invalid locked envelope, a turn/tick mismatch, orders for a destroyed ship, missing orders for a living one, `automatic` not matching the player's destruction, or a state that already has an outcome. |
| `observeSide` | `(state, side, rules, scenario) => SideObservation` | Planning-entry observation; `events` and `ownShip.interruptions` are empty for the coming turn. |
| `validateOrders` | `ValidateOrders` (`contracts/public.ts`) | Own observation, public map and rules only. Forecasts replay the engine's grant order exactly (see Sensors). |
| `previewRoute` | `PreviewRoute` | Same route logic as the engine; waypoints start at the current position. |
| `ENGINE_CAPABILITIES` | `{ activePulse: true, laser: true, missile: true }` | Every equipped order is implemented. |

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

- Interval `(t, t+1]` is evaluated at `now = t+1`. Stages: clock expiry and regeneration (capped) → grants in the fixed order cloak sustain → first-tick pulse → propulsion → simultaneous movement → pre-fire sensing → weapon proposals (the weapon is paid last, from what remains) → one damage batch → post-fire sensing/knowledge update/events/frames. Each stage reads one snapshot for both ships. Output order is canonical (`player`, `patrol`), never initiative.
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

## Lasers, damage and outcomes (TSB-30A)

- **Intent.** `weapon: { kind: 'laser', contactAlias }` names an own contact alias. It fires at most once per turn, at the first tick when all of these hold:
  - the alias's ship is in this tick's fresh pre-fire sightings (a stale contact waits and never reaches an unseen true position);
  - the range is within `laser.rangeUnits` (6,000, inclusive);
  - there is line of sight;
  - `laserReadyTick <= now`;
  - at least `laser.costMilli` (18,000) remains after the regeneration, sustain, pulse and propulsion grants.

  The engine never fires the intent on more than one tick of a turn.
- **Discharge.** Both sides' proposals read the same pre-damage snapshot and are applied together. Each discharge:
  - costs 18,000 milli-energy;
  - sets `weaponIntentSpent`;
  - sets `laserReadyTick = now + laserCooldownTicks` (50). This is an absolute tick, so the cooldown carries across turns of any length;
  - sets `exposureUntilTick = max(current, now + exposureTicks)`;
  - turns the cloak off and latches `latched-activity` for the rest of the turn. A sustain already paid is not refunded.
- **Damage batch.** Each target takes `laser.damage` (35) per beam aimed at it. Shields absorb damage first and the overflow reaches the hull; neither regenerates. Hull 0 means destroyed (`destructionTick = now`).
  - A ship destroyed in a batch still lands its own shot from that tick.
  - From the next tick a dead ship gets no regeneration, movement, sensing or weapon.
  - Side or array order cannot change survival (`resolveTurnInOrder` is tested reversed).
- **Post-fire sensing.** Emissions are sensed in the same tick against the pre-damage state and are merged with the pre-fire sightings into one measurement per tick. Fire is never evaluated twice in a tick, so a newly revealed shooter can be attacked only from the next tick.
  - An observer that sighted a ship in its destruction tick records `observedDestructionTick` on that contact and `observedOpponentDestructionTick` in its knowledge. Memory is never deleted; a dead observer keeps its contacts, which go stale.
  - An unobserved destruction changes nothing that the observer can see or validate before the boundary.
- **Outcome.** The full turn always runs. At its boundary, a destroyed ship and no live missiles classify the result (see TSB-30B for windows with live ordnance):
  - only the frigate destroyed = `victory`;
  - only Shadow-Dancer destroyed = `defeat`;
  - both = `mutual-destruction`.

  The result is `nextState.outcome = { outcome, revealTick: endTick }`. Only the `endTick` frame carries `observation.outcome` and an `outcome` event; earlier frames never do. `observeSide` reveals it from then on, and further `resolveTurn` calls throw.
- **Events (per side, built explicitly):**
  - Shooter: `own-shot` (own position, `{ kind: 'laser', contactAlias }`), `own-energy` (`reason: 'laser'`, −18,000) and `observed-impact` (target position, alias). It never learns the damage dealt or the enemy's health.
  - Observer of a shot: `observed-shot` (`sourceAlias`, position), only when that observer sighted the shooter this tick.
  - Victim: `own-damage` (`shieldsLost`, `hullLost`).
  - Sighted destruction: `observed-destruction` (alias, position) for the observer, `own-destruction` for the victim.
  - Internal log (private): `shot`, `resource`, `damage`, `destruction` and `outcome` events.
- **Assessment.** `weaponAttempt` is one of:
  - `not-requested`;
  - `fired` (`tick`);
  - `unfired` with `reasons`: the distinct blockers seen on any evaluated tick, in the order `no-current-lock`, `out-of-range`, `line-of-sight-blocked`, `cooldown`, `insufficient-energy`, `own-destroyed`. Range and line of sight are reported only for a fresh lock, so the reasons never describe an unseen ship.
- **Validation (own knowledge only).**
  - Errors:
    - `weapon` `unknown-alias` (with `contactAlias`) when the alias is not in the own contacts;
    - `weapon` `observed-opponent-destroyed` after an observed destruction (hold fire);
    - `equipment-unavailable` without a laser.
  - Conditionals forecast for the first tick (the intent then waits, it does not fail):
    - `awaiting-current-lock` (stale contact);
    - `awaiting-range` (`rangeUnits`) and `awaiting-line-of-sight`, from the measured position;
    - `awaiting-cooldown` (`readyTick`);
    - `awaiting-energy` (`requiredEnergyMilli`/`availableEnergyMilli` after all higher-priority first-tick grants).
  - Warning: cloak with a laser adds `activity-breaks-cloak`.
  - The propulsion forecast does not anticipate when the laser will fire.

## Missiles, persistence and endings (TSB-30B)

- **Launch.** `weapon: { kind: 'missile', aim: Cell }` plots one map cell. There is no contact, homing or aim rewriting.
  - The missile launches at the first tick where `missileReadyTick <= now` and `missile.costMilli` (10,000) remains after the regeneration, sustain, pulse and propulsion grants, and never more than once per turn.
  - Each launch costs 10,000 milli-energy and one round of ammunition, and sets `missileReadyTick = now + missileCooldownTicks` (100, absolute, carried across turns).
  - It triggers the same exposure and cloak activity latch as a laser.
  - The missile starts at the launcher's moved position, travels from the next tick, and expires at `launchTick + missileLifetimeTicks` (150).
  - Missiles persist across turns and after their launcher is destroyed; `nextState.missiles` holds them.
- **Stage-6 sweep.** Each missile present at tick start advances by integer progress along launch → aim, 200 units per tick.
  - The tick's path is swept against asteroid rectangles, treating the missile as a 100-unit circle.
  - Each opposing ship alive at tick start is swept relative to that ship's own start → end motion (contact at 350 units). The launcher's own side is never struck directly.
  - The earliest time fraction in the tick wins. Exact ties go asteroid → ship → arrival → expiry.
  - Arrival, asteroid and ship ends detonate; expiry is harmless removal. Launch and aim lie inside the convex arena, so `exit` cannot occur.
- **Splash.** At a detonation, every ship alive at tick start (including the launcher) takes `missile.damage` (45) once if:
  - its position sampled at the impact fraction is within `blastRadiusUnits` (750) of the impact point, and
  - it has line of sight from that point.

  The direct victim is guaranteed that single hit, never a second one. Beams and missile hits of one tick form a single damage batch (shields, then hull, then destruction), so a ship destroyed in a batch still completes its own same-tick shot or launch.
- **Ordnance knowledge (per side, never the aim or launcher):**
  - **Hostile missiles:** while the observer is alive, a hostile missile within its funded missile range and line of sight is tracked. The range is `passiveMissileRangeUnits` (7,000), or `activeMissileRangeUnits` (10,000) while tracking. Each missile gets a stable `missile-N` alias.
  - **Lost tracks:** an unseen missile becomes an age-labelled stale sighting. Its uncertainty is `age × missile speed`, capped at the farthest map corner.
  - **Track end:** a track ends (`hostile-missile-expired`) only when the observer saw the missile end, or `missileLifetimeTicks` after its last sighting. An unseen detonation never deletes memory.
  - **Detonations:** a detonation seen by an observer that it did not strike directly yields `observed-impact` (rounded position; `contactAlias` only when the struck ship was its current contact).
  - **Own telemetry:** `ownMissiles` is updated every tick, continues after the launcher dies, and never names a victim. `own-missile` events fire at launch and at the end, with status `detonated`, `expired` or `exited-map`.
  - **Launch events:** a launch yields `own-shot` (`{ kind: 'missile', aim }`), `own-energy` (`reason: 'missile'`) and `own-ammunition` (−1). A launch the opponent sights yields its `observed-shot` (`weapon: 'missile'`).
- **Boundaries.** At a completed window's `endTick`, a destroyed ship plus no live missiles classifies the outcome, as for lasers.
  - **Destroyed ship with live missiles:** there is no outcome, and the private `nextState.terminalPending` is set.
  - **`assessment.ordnancePending`** is non-null only for an observer that knows of a destruction (its own, or an observed opponent's): `known-own-missiles` (its flying missile IDs) first, otherwise `observed-opponent-destroyed`. An unobserved enemy death changes nothing the player sees or validates and yields no pending explanation; event IDs are numbered per side, so they reveal nothing either.
  - **After an observed destruction:** the observer's weapon orders fail validation (`observed-opponent-destroyed`), but evasive movement remains available.
- **Validation (missiles):**
  - Errors: `out-of-bounds` (aim, with `cell`), `no-ammunition` and `observed-opponent-destroyed`.
  - Conditionals for the first tick: `awaiting-cooldown` (`readyTick`) and `awaiting-energy`.
  - Warning: cloak with a launch adds `activity-breaks-cloak`.

### Application API for windows (UI-31)

1. After each `resolveTurn`, read `nextState.outcome`. When it is set, the encounter is over; its reveal tick is `endTick`.
2. Otherwise build the next `AcceptedTurn` with `startTick = nextState.tick` and `turnIndex = nextState.turnIndex`:
   - **Player alive:** a normal turn. `automatic: false`, the player's committed orders, and patrol orders from the planner if the patrol is alive (`null` if it is destroyed).
   - **Player destroyed:** an automatic window. `automatic: true`, `orders.player = null`, and `orders.patrol` from the planner (its own observation, memory and RNG) if the patrol is alive, otherwise `null`.
   - **Both destroyed:** a drain window with `null`/`null` orders.
3. Count automatic windows from the player's destruction and stop with an internal invariant failure (never a draw) if they exceed `aftermathWindowBound(rules, remainingSurvivorAmmunition)`. The engine does not count them.
4. These private facts stay out of presentation: `ships[side].alive`, `nextState.missiles`, `terminalPending`. Only the destroyed player's own `ownShip.status` is public.

## Limitations (next work packages)

- A ship alive at turn start always makes its first-tick pulse attempt, so `sensorAttempt` never reports `own-destroyed`. Planner memory and random streams pass through unchanged; patrol ordering and automatic-window orders belong to the planner/application (TSB-40/UI-31).
- Swept contact fractions use exact closed-form roots in double precision. Exact ties are reproduced for integer-aligned geometry; other near-ties resolve deterministically by the computed value.
- A committed missile intent still launches after its owner observes the opponent's destruction mid-turn (no replanning during execution). The hold-fire restriction applies from the next planning phase.
- `propulsion-funding` is a forecast from the own observation. It only states that movement may pause.
