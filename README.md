# Shadow-Dancer — Tactical Space Battle

A first-playable browser spaceship duel against an observation-only patrol AI. Plan movement,
scanning, cloak and a weapon order while time is paused; both ships then act simultaneously
for ten simulated seconds. The tactical plot shows your ship's current knowledge, including
last-known contacts. Recorded playback, outcomes and same-seed restart support reproducible encounters.
The game runs entirely in the browser, with no backend.

Start with the [playtest guide](PLAYTEST.md) for the mission, controls, reference encounter,
human feedback checklist and [known limitations](PLAYTEST.md#known-limitations).

## Install and run

Run commands from this repository's root. Use Node satisfying the exact `package.json` range
`^22.13.0 || ^24.0.0 || >=26.0.0`, and npm with the committed `package-lock.json`.
The documentation preparation environment uses Node 26.7.0 and npm 11.19.0.
`npm ci` installs the locked dependencies without updating them.

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/` and choose **Begin mission**. For a reproducible seed, open
`http://127.0.0.1:5173/?seed=17`. The development server supports editing and hot reload.

To build and serve the production files locally:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/`. Build performs a TypeScript check and writes `dist/`;
preview serves that build and needs rebuilding after source changes. Stop either server with Ctrl+C.
Defaults are loopback host `127.0.0.1`, development port 5173 and preview port 4173.
Both use strict ports: an occupied port fails rather than silently selecting another.
Choose a free port with `--port` when needed.

Localhost URLs are accessible on the machine running the server. A separately provided private
preview requires access to its Tailnet or an explicitly arranged SSH tunnel. A local build or
private preview does not establish public hosting; public deployment requires separate authorisation.

## Checks

```sh
npm run typecheck
npm run lint
npm run test:unit -- --maxWorkers=2
npm run build
```

For browser checks, install the Playwright Chromium prerequisite first:

```sh
npx playwright install chromium
TSB_BROWSER_PORT=4271 npm run test:e2e -- --workers=1
```

Chromium installation needs the browser download/cache and a compatible host with its system
libraries available. The command above installs the browser; it does not install operating-system
packages. The environment-variable example uses POSIX shell syntax.

Playwright starts this checkout's development server on loopback, using port 4271 by default.
`TSB_BROWSER_PORT` selects another isolated port (1024–65535). Server reuse is disabled;
the tests must not attach to another checkout's running app. Use one Chromium worker and,
in the shared development environment, the lead's assigned browser slot and port.
Run from a frozen committed verification checkout: **do not edit served files, including Markdown,
while browser checks are active**. File watching can reload a page and invalidate a long encounter.
Screenshots/traces are written under `test-results/`; failures retain their trace.

## Optional headless diagnostics

Git is needed to record source provenance. The optional batch tool uses the real engine and AI,
independently of the browser and default unit-test job. A small run and its replay:

```sh
batch_dir=$(mktemp -d /tmp/shadow-dancer-batch.XXXXXX)
npm run batch -- --seeds 17 --policies pursuit-laser --limit 20 --out "$batch_dir"
npm run batch -- --replay "$batch_dir/pursuit-laser-seed-17.json"
```

Use a fresh output directory to preserve earlier evidence. A `diagnostic-cutoff` records an
unfinished encounter at the normal-turn budget; it is never a gameplay draw. See the
[batch guide](tools/batch/README.md) for the four example policies, bounds, metrics, failures and
exact replay. These examples are diagnostic players, not evidence of optimal play or balanced combat.

## Report a problem

Include the seed or copied seed link, each turn's orders, observed and expected behaviour,
browser/OS, and the applicable revision (`git rev-parse HEAD`). Playback details help reproduce
presentation issues. Attach relevant screenshots or test artifacts when available.

Public screenshots and player observations describe what the ship knew. Batch reproduction files
contain private authoritative state, including hidden information: keep them in diagnostic/review
channels and never use them as UI payloads. Technical checks and human gameplay acceptance are
separate; use the [playtest checklist](PLAYTEST.md#what-to-look-for) to report clarity and gameplay feedback.

## Project references

- [Game design](GAME_DESIGN.md): encounter scope and tactical rules.
- [WEGO specification](WEGO_SPEC.md): fixed ticks, simultaneity and information boundaries.
- [Architecture](ARCHITECTURE.md): module and public/private contracts.
- [Development plan](DEVELOPMENT_PLAN.md): the approved milestones and sole backlog.
- [Working conventions](AGENTS.md): ownership, review and verification rules.
