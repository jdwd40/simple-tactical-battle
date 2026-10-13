# Application controller (TSB-11C)

`src/game` is the application authority between the private engine and the public UI. Only
`App.tsx` (the composition root) imports it, via `src/game/index.ts`; UI, rendering, AI and
public fixtures are blocked from it by `src/fixtures/importBoundary.test.ts`.

## Factory

```ts
const controller = createGameController({
  seed,                 // first encounter and every same-seed restart
  newSeed: randomSeed,  // entropy for new-seed restarts (application, never the engine)
  clock,                // optional PresentationClock (default browserClock)
  engine,               // optional EngineApi (default SIMULATION_ENGINE) — wrap to count/inspect calls
  planOpponent,         // optional PlanOpponent (default scriptedPatrol, the interim drill script)
})
<GameConsole controller={controller} capabilities={controller.capabilities} seedOf={...} onBriefing={...} />   // public surface, capability booleans, seed
controller.dispose()                       // unmount: cancels timers, pauses; commands stay usable
```

`App.tsx` composes the controller with `planOpponent` from `src/ai` (TSB-40). That planner
receives only the patrol's observation, memory and stream, once per planning entry and in each
automatic window. `scriptedPatrol` remains the default for headless tests and the labelled
test-only page (`tests/harness/duel`).

`controller.seedOf(encounterId)` returns the current encounter's seed as a plain number (null
for any other id). The console shows it as reproduction data and builds a `?seed=` link from it.
Nothing else of the session is exposed.

`controller.capabilities` is the injected engine's `{ activePulse, laser, missile }`, copied as frozen
booleans and nothing else (TSB-21). The console declares its own structural prop type and never
imports this module; it offers the active pulse only when `activePulse` is true and the ship has an
active sensor.

The controller implements `GameController` from `src/contracts/public.ts`:

- `getView()` returns a frozen view with a stable reference until the next publish; `subscribe` returns an unsubscribe. `revision` increases on every publish; `encounterId` (`encounter-N`) changes on restart.
- **Planning entry** observes both sides once: the player view, and the opponent plan from the patrol's own observation, memory and planner stream. Draft edits never re-plan. New planning carries the destination and actual cloak state; sensor and weapon reset.
- **`setDraft`** (planning only) validates and previews with the engine.
- **`commit(expectedTurnIndex)`** returns `ignored` (wrong phase or stale turn), `rejected` (structural errors), or `accepted`. It publishes the locked `commit` phase, resolves exactly once, then starts execution playing at the current speed.
- **Playback** owns the presentation clock: one cursor tick per `tickMs / speed`. `play`, `pause`, `speed`, `seek`, `step` and `skipToEnd` move only the cursor. Views expose frames and events only through the cursor; the assessment appears when the cursor reaches `endTick`. From assessment, `play`, a backward step or a seek replays the recorded frames as `execution` with `replayOf: 'assessment'`; nothing is resolved again.
- **Combat endings (TSB-31)** come only from the engine's recorded `outcome` in the private next state. The controller holds it and shows the terminal `{ kind: 'combat', outcome, assessment }` view only when the cursor reaches its `revealTick`. Before that, execution shows nothing of it, including during a replay from the ending (`replayOf: 'terminal'`). Abandon is refused once a combat ending exists.
- **Automatic aftermath.** If the player's ship is destroyed and no outcome is recorded at the turn's end, the next WEGO window is resolved once, when the cursor reaches that end: `automatic: true`, player orders `null`. The living patrol plans from its own observation, memory and stream; a destroyed one is never asked. Windows are appended to the replay prefix, so `endTick` grows only as each window begins. `skipToEnd` walks through the windows as they begin. After the approved `aftermathWindowBound`, the controller stops and logs an invariant failure rather than inventing a draw.
- A destroyed opponent is never planned for in normal turns either; its orders are `null`. Nothing about that is visible to the player.
- **`finishAssessment`** enters the next planning phase. **`abandon`** gives a terminal `{ kind: 'abandoned' }` view frozen on the last shown frame, with timers stopped. **`restart`** builds a fresh session (same or new seed); a stale timer callback checks encounter ownership and does nothing.

## Test seams (for TSB-12B and later integration)

- `createManualClock()`: time moves only through `clock.advance(ms)`; `clock.pending` counts scheduled ticks. The real cadence is `rules.timing.tickMs / speed`.
- Wrap `SIMULATION_ENGINE` functions with spies (for example `vi.fn(SIMULATION_ENGINE.resolveTurn)`) to prove single resolution and replay without resimulation.
- Pass a `PlanOpponent` spy to check once-per-planning-entry planning and its inputs. TSB-40 replaces `scriptedPatrol` through the same option.
- In the browser, `?seed=<uint32>` gives a reproducible encounter. The dev server exposes `window.__plotDiagnostics()` (drawn-plot summary only); production builds strip it.

## Drill limits (until TSB-30/40)

The console offers passive sensing, the active pulse when the engine's capability allows it, and the cloak (TSB-21); the weapon stays at hold fire while `laser` and `missile` are false. The patrol follows a fixed public loop and cannot react or fire. There is no damage, destruction, automatic aftermath or outcome; the terminal view is reached only by abandoning.
