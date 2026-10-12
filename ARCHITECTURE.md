# Architecture and shared contracts

Status: M0 architecture approved with the build plan on 2026-10-12. These boundaries govern shared contracts and parallel work.

## Structure

One TypeScript repository with `src/contracts`, `src/simulation`, `src/ai`, `src/application`, `src/ui`, `src/rendering`, `src/scenarios` and `src/fixtures`; tests stay near their subjects or in `tests/e2e`. Retain the documented `src/application` name for the responsibility described as `src/game` in the main plan. The engine runs without React, PixiJS, DOM, timers or browser storage. No service infrastructure or additional state-management dependency is proposed.

Simulation owns authoritative state and projects side-specific observations. AI consumes only those observations and its memory. A small application controller owns the private game session, validates/fixes order envelopes, coordinates AI and engine calls, and publishes presentation data. React controls and PixiJS receive that published data and commands only; they cannot import unrestricted state. PixiJS animation callbacks may advance a playback cursor, never the engine.

Use direct PixiJS inside a React-managed canvas lifecycle, avoiding an extra React/Pixi adapter. Destroy rendering resources/listeners on unmount/restart and guard asynchronous initialisation with encounter identity. Public knowledge frames drive map symbols and React resource panels together. DOM controls provide keyboard alternatives to map clicks. Measure turn-resolution latency and browser responsiveness; introduce a worker only if those measurements justify it.

## Contract inventory

These are precise payload specifications, not implementation code. All coordinates, times and resource units have the definitions in WEGO_SPEC.md. Published values are immutable copies without authoritative object references.

| Contract | Required content and constraints |
| --- | --- |
| `Ruleset` | Version, tick/turn duration, geometry units, movement/sensor/signature/resource/weapon/damage values, memory lifetimes and aftermath bounds. Frozen for an encounter; durations validated as whole ticks. |
| `Scenario` | Version/ID, public 20×20 terrain, authored spawns and ship loadouts. Not supplied wholesale to UI/AI if it includes hidden spawns. |
| `TurnOrders` | `turnIndex`; movement discriminant hold/destination with integer column/row; sensor passive/activePulse (one first-tick attempt); cloak boolean; weapon discriminant hold/laser/missile. Laser has an observer-local contact alias; missile has a plotted column/row. No enemy entity coordinate lookup in orders. |
| `OrderValidation` | Structural validity plus field-specific issues; separate conditional readiness/warnings. Inputs are orders, own observation and public rules/map. Errors must remain equal when only inaccessible state changes. |
| `SimulationState` (private) | Rules/scenario versions, seed and explicit RNG state, absolute tick/turn, live/dead ships and resources, internal routes/committed policies, cooldown/exposure/scan clocks, spent-pulse/weapon flags, cloak-off latch until later commitment, missiles with immutable aim and expiry, per-side knowledge stores, terminal-pending/final state. |
| `SideObservation` | Side/turn/tick; public map; own ship position/heading/resources/equipment/current modes and interruptions; own committed/draft-relevant facts; contacts; own missile telemetry; observed hostile missiles; filtered events; final outcome only when revealable. Never enemy orders, true unobserved positions, exact enemy resources or future frames. |
| `ContactMemory` | Observer-local alias, measured position and observation tick, previous measurement/derived velocity when available, current/stale discriminant, age/uncertainty, optional observed destruction. Private alias-to-entity mapping stays inside simulation. |
| `PlannerMemory` | Patrol progress, PATROL/INVESTIGATE/ENGAGE/SEARCH policy state, remembered observations and persistent observed opposing destruction. Changes only from that side's received facts and its own previous decisions. |
| `InternalEvent` (private) | Tick, canonical event ID, kind, true source/target/position/effects and diagnostic reason. Never forwarded by merely toggling a visibility flag. |
| `VisibleEvent` | Tick/ID/kind with an explicitly constructed observer-safe payload: own costs/interruptions/damage, observed shots/impacts, contact changes or permitted terminal outcome. Unknown information is omitted. |
| `PublicReplayFrame` | Tick, side observation and visible events recorded at that tick; no reference to later snapshots. |
| `TurnResolution` (private) | Exact locked input envelopes, next authoritative state, internal diagnostics and per-side recorded frames. Its public derivative is `TurnPresentation`: start/end ticks, this observer's frames and reveal-timed assessment. |
| `GameView` | Phase, own draft/validation, current public frame, playback cursor/settings and permitted assessment/outcome. The UI has no handle to private resolution/state. |

Core function boundaries: initialise scenario/rules/seed → private session; validate orders against observation → validation; plan AI from observation/memory/planner seed → orders and updated planner memory; resolve locked orders from state → resolution; derive one side's presentation → immutable public frames. UI commands are set draft, commit, control playback, finish assessment, abandon and restart.

## Lifecycle and reproducibility

Planning keeps one editable player draft. Commit atomically captures both validated envelopes and locks inputs before resolving. Resolution may calculate the complete turn immediately, but execution publishes only its current frame. Assessment offers replay and next planning, including evasion turns while the player survives and missiles remain. Terminal encounters offer final replay and restart. Automatic aftermath follows observed own destruction and appears as locked execution; each living frigate's next turn is planned from its own observation/memory, allowing evasion rather than freezing its old route. A private ending flag never drives early UI phase changes, weapon validation, AI decisions or an unseen provisional result.

Seed/rules/scenario versions and accepted order envelopes form the reproducible encounter record; diagnostic failures also record engine revision and tick. AI uses a dedicated stream independent of simulation internals. New-seed entropy belongs to the application, not the engine. Preferences may use localStorage; campaign/save systems are excluded.

## Tooling and ownership

Observed tooling: Node 26.7.0, npm 11.19.0 and Git 2.53.0. No project manifest/lockfile exists. After implementation approval, M0 bootstrap resolves and locks compatible stable versions of the required stack using official peer/engine constraints. Current [Vite requirements](https://vite.dev/guide/) and [Vitest requirements](https://vitest.dev/guide/) were checked; the installed Node exceeds their documented minimums. Use the official [Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite) and [PixiJS application lifecycle](https://pixijs.com/8.x/guides/components/application). Exact package versions remain a bootstrap deliverable, not an invented existing baseline.

The orchestrator accepts shared contracts/rules and alone writes root PROJECT_STATUS.md. General Builder owns core contract types in TSB-02, simulation/AI and authored rules/scenario data; UI Builder checks contract usability without editing the shared files. Assistant Builder owns package/lockfiles and root test/build configuration in TSB-03, then scoped fixtures/tests. Shared-file ownership transfers or amendments are sequenced through the lead. UI Builder owns application presentation, React and PixiJS. Builders own their relevant tests. Reviewer uses a fixed isolated revision and remains read-only on implementation source.
