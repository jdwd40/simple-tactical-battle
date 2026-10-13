# Headless encounter diagnostics

Requires the repository's supported Node version, Git and `npm ci`. Uses the real engine and accepted `planOpponent`, hosted by the installed Vitest runner. No browser, server or extra dependency. The optional job is outside the default unit-test include list and uses one worker.

```sh
npm run batch -- --seeds 1 --out /tmp/tsb-batch-four
npm run batch -- --seeds 1,2,3,4,5 --out /tmp/tsb-batch-twenty
npm run batch -- --seeds 1 --policies pursuit-laser --limit 20 --out /tmp/tsb-batch-short
npm run batch -- --replay /tmp/tsb-batch-four/pursuit-laser-seed-1.json
```

Seeds are explicit uint32 integers, distinct, at most five. Policies default to all four; select distinct comma-separated names. The default normal-turn limit is 200, configurable from 1 to 200. Unknown/duplicate/missing arguments fail. Automatic aftermath uses a separate finite ammunition/lifetime bound, unaffected by the normal-turn cutoff. Do not expand a batch beyond twenty runs without lead coordination.

The four deterministic diagnostic examples bind public rules and receive only their own observation:

- `concealed-search`: rotates through public central waypoints, cloaks when a full movement/sustain budget is available, lasers a close current contact.
- `scan-search`: searches those waypoints, pulses on alternating turns while lacking a current contact and funded, lasers a close current contact.
- `pursuit-laser`: pursues the freshest measured contact and requests a conditional laser; searches when no memory remains.
- `predictive-missile`: plots measured position plus measured velocity times estimated flight ticks, bounded by lifetime/stale uncertainty and the map; avoids obvious asteroid trajectories/self-blast and evades recent public hostile missile sightings. Holds fire when ammunition is empty; it is not an optimal fallback laser player.

All living actors plan once per window. The patrol's returned memory and independent RNG are threaded into the next engine call. Destroyed actors submit null orders. Invalid diagnostic player orders get an explicitly recorded hold fallback; invalid production planner orders stop the run and preserve the rejected draft, validation issues and boundary. No production defect is repaired here.

`metrics.json` contains seed, policy, source revision/dirty flag, versions, actual outcome, normal/automatic counts and bound, AI policy transitions, separate scan/weapon intents and actual discharges, rejection/fallback records, invariant failures, stale-contact age/turn counts and stalled destination turns. An unchanged start/end position with a destination is only a stalling indicator, not proof of a defect. `runMetadata.outputDirectory` is explicitly variable metadata; the other output is deterministic for the same source and inputs.

Each run also saves an exact **private diagnostic** reproduction: full rules/scenario, initial state, accepted order envelopes and pre-resolution planner memory/RNG, final state/hash and any failing boundary. Nonfinite numeric failures and negative zero use explicit `$tsbNumber` tags so file replay does not coerce them to null/zero. These files can include authoritative hidden information. Keep generated reports out of Git and never feed them to the UI. Filenames are deterministic and an existing output directory is overwritten for matching runs; use a fresh task directory when preserving evidence.

Replay reads the JSON file and resolves recorded envelopes without replanning, checking the complete final state and hash. It verifies a recorded invalid planner order by revalidating that draft, and retries a recorded failing resolution boundary. Planning exceptions retain their exact boundary state but are not rerun by envelope replay. Replay requires compatible source; the original revision is printed and a changed engine may produce a mismatch. No wall-clock simulation input is used.

A `diagnostic-cutoff` means the normal-turn budget ended with no outcome. It is never a gameplay draw, victory or defeat. A run `failure` exits the command unsuccessfully after saving evidence; intentional diagnostic fallbacks are separate. Cutoffs exit successfully as diagnostics and save the same complete reproduction data. Win counts alone do not establish balance or enjoyment.

Focused tests: `npm run test:unit -- src/tests/batch/batchHarness.test.ts --maxWorkers=2`. This small suite checks argument bounds, cutoff semantics, deterministic planner threading, file replay/tampering, explicit fallback/invalid-planner evidence, invariant negative controls and measured-velocity/evasion policy behavior.

Tool-only typecheck (including the optional job/config): `./node_modules/.bin/tsc --project tools/batch/tsconfig.json`.
