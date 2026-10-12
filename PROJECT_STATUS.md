# Project status — Tactical Space Battle

Canonical path: `/home/jd/projects/tactical-space-battle/PROJECT_STATUS.md`. Sole writer: orchestrator. Workers report updates; worktree copies are not canonical.

## Current state

- Milestone: M0 — rules, contracts and runnable skeleton. Plan approved on 2026-10-12; executable scaffold preparation is underway. M0 is not complete.
- Established requirements: the user's first playable duel brief, main build plan and fixed WEGO cycle/stack/exclusions. The user approved the baseline and automated implementation on 2026-10-12: "plan is aproved. All systems go."
- Location: `/home/jd/projects/tactical-space-battle`, explicitly confirmed by the user on 2026-10-12. Newly created for planning documents; no existing project repository or instructions were found there.
- Planning delivery: [GAME_DESIGN.md](GAME_DESIGN.md), [WEGO_SPEC.md](WEGO_SPEC.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) and this record. AGENTS.md records durable worker conventions; executable work follows.
- Git: initialised on local tsb/integration. Documentation baseline c315b14409ce101fc5c296bc5e533ee91ca9bc7e; no reviewed code yet.
- Implementation: M0 scaffold reviewed and integrated; shared contracts are next. Independent review / code integration / executable demonstration: not yet delivered. No gameplay or human playtest results exist; scaffold checks are recorded below.
- Planning validation: document inventory, references and work-package consistency checked. M0 scaffold dependencies and build/lint/browser checks have run; gameplay checks await implementation. Read-only setup checks are recorded below, separately from code delivery/review.
- Demo / production build / accessible preview: none. Existing private Tailscale address 100.109.154.60 confirmed; reserve port 5280 for a private playable preview at M1/M2, with an SSH forwarding alternative; no public hosting action is authorised.

M0 acceptance after approval: agreed rules/contracts, working dev/build/typecheck/lint/unit/browser commands, launchable application, loaded initial scenario and passing browser smoke test. A skeleton is not playable gameplay. Implementation is authorised through the scoped M3 local release candidate.

## Live factory mapping

Last confirmed on 2026-10-12: session `default`, workspace `w7`, directory `/home/jd`. Role evidence is the workers' own pane reports, plus the user's explicit reviewer assignment. Names/configurations are preserved. Revalidate addresses and availability before dispatch or after session changes.

| Role | Pane / existing tab label | State |
| --- | --- | --- |
| Orchestrator | `w7:p1` / `Sol6.1M` | Confirmed by this conversation |
| General Builder | `w7:p3` / `opusx builder` | Confirmed role; TSB-02 attempt 1 stopped after repeated waits with no source changes. Available for later simulation assignment |
| UI Builder | `w7:p5` / `opus UI` | Confirmed UI BUILDER READY report; TSB-02-UI-CHECK complete; active TSB-11A independent layout. Read frontend-design skill from the installed Claude plugin; no active assignment |
| Assistant Builder | `w7:p6` / `codex Jnr` | Confirmed role and ASSISTANT BUILDER READY in SETUP-A01 / attempt 1; available, no active assignment |
| Independent Reviewer | `w7:p7` / `sol6.1h Review` | User assigned role in this pane; subsequent own acknowledgement confirms Independent Reviewer and availability for scope/criteria. Ready; TSB-03A review completed PASS, no active review |

Herdr 0.9.0 client/server and workspace discovery were verified. Codex tool subprocesses omit Herdr environment context; focused-pane lookup can identify the lead rather than the caller. Explicit pane inspection plus each unique delivered setup check confirms identity without inventing environment values.

## Task and review checkpoint

The main plan's work packages replace earlier undispatched placeholder IDs; DEVELOPMENT_PLAN.md is the sole dependency-ordered backlog. No approved implementation or subsequent user decision was overwritten.

| Tasks | Owner / dependency | Current state |
| --- | --- | --- |
| TSB-01 | Lead; approved planning/reconciliation scope | Documentation reconciled; no code or independent code-review verdict |
| TSB-02 | Assistant attempt 2, precise approved schema; General retains simulation/AI ownership | Attempt 1 stopped, no source delivery; attempt 2 preparing |
| TSB-03 (increments TSB-03A/B) | Assistant; repository baseline, then TSB-02 for fixtures/scenario completion | TSB-03A REVIEWED/INTEGRATED, attempt 1, round 0 PASS; TSB-03B NOT_DISPATCHED |
| TSB-10 / TSB-11 / TSB-12 | General / UI / Assistant; accepted M0, then real foundation/UI for regressions | TSB-11A independent layout ACTIVE attempt 1; 10/11B/12 waiting M0 |
| TSB-20 / TSB-21 / TSB-22 | General / UI / Assistant; accepted M1, agreed sensor contracts, then integrated implementation | NOT_DISPATCHED |
| TSB-30 / TSB-31 / TSB-32 | General / UI / Assistant; accepted M2A, agreed combat contracts, then integrated implementation | NOT_DISPATCHED |
| TSB-40 / TSB-41 / TSB-42 | General / UI / Assistant; accepted M2B, then integrated AI/mission flow | NOT_DISPATCHED |
| TSB-50 / TSB-51 / TSB-52 | UI / General / Assistant; accepted M2, evidenced findings, then combined release verification | NOT_DISPATCHED |

TSB-03A / attempt 1: Assistant w7:p6; reserved worktree /home/jd/projects/tactical-space-battle-worktrees/assistant-03a, branch tsb/03a-scaffold. Base c315b14409ce101fc5c296bc5e533ee91ca9bc7e; head 85223d31ad454bc6b56f60e830904e531728a579. Browser smoke 1 passed; unit harness 0 tests. Review snapshot /home/jd/projects/tactical-space-battle-worktrees/reviews/03a-r0, port 4381. Remaining implementation locations/revisions unassigned. TSB-03A: PASS at 85223d31ad454bc6b56f60e830904e531728a579; integrated as 08e14d9. Review report /home/jd/projects/tactical-space-battle-worktrees/handoffs/TSB-03A-review-r0.md. TSB-03A combined checks on tsb/integration: npm ci, npm run build (includes typecheck), npm run lint and TSB_BROWSER_PORT=4391 npm run test:e2e passed; 1 Chromium smoke. General TSB-02 attempt 1 stopped and preserved at clean base 7d58e4373b77b94e224fd2cc0214e58044aafbbd in /home/jd/projects/tactical-space-battle-worktrees/general-02, tsb/02-contracts. No successful completion or code review claimed for it. UI TSB-02-UI-CHECK / attempt 1 COMPLETE; concrete API/data refinements accepted in /home/jd/projects/tactical-space-battle-worktrees/handoffs/TSB-02-ui-decisions.md; Assistant/reviewer idle. Every later review receives the exact delivered revision in an isolated snapshot, original acceptance/contracts and actual builder checks; initial review plus at most two correction rounds.

Setup deliveries only: SETUP-A01 / attempt 1 confirmed the Assistant's role and explicit pane; SETUP-R01 / attempt 1 initially found the reviewer prompt pending; the user then supplied "yes this is the reviewer agent .. use this for reviewing", and the reviewer acknowledged its assignment. Both finite prompt waits completed and reports were collected from the assigned panes matching ID/attempt. Neither is a code-review PASS or implementation delivery.

## Decisions, dependencies and next action

Approved baseline retained: fixed-point deterministic routes, 100ms simultaneous damage batches, one conditional weapon shot per turn, plotted non-homing missiles, energy priority, no shield regeneration, private engine and observer-only UI/AI/replay. Initial numerical values remain tuning hypotheses.

The main plan supersedes earlier unapproved proposals: one first-tick active pulse replaces recurring pulses; successful scan/fire keeps cloak off until a later planning phase; movement increases detection signature; AI uses PATROL/INVESTIGATE/ENGAGE/SEARCH; either living survivor can plan evasive turns while ordnance persists, including automatic observation-only AI turns after player destruction. Add the brief mission introduction and abandon/restart flow. No new campaign or expansion requirements.

Setup dependencies are resolved: project location, implementation approval and all five roles. Three builders and the reviewer are available. Collect exact task/attempt/revision reports, never infer task success from idle/READY alone.

Next action: reconcile live panes/files, initialise Git and a local baseline, assign TSB-03A / attempt 1 to the available Assistant in an isolated worktree. Review/integrate it, assign General TSB-02 with a read-only UI usability check, then Assistant TSB-03B. Release General TSB-10 and UI TSB-11 in parallel only after M0 acceptance. Actual paths/branches/revisions/ports are assigned then, not guessed now.

Policy: implementation and local reviewed integration through M3 are authorised. Automated assignments, checks and in-scope corrections proceed without repeated approval. No release/default-branch merge, push or deployment authorised. After implementation authorisation, deliver a reviewed and tested local integration candidate; external release actions require explicit permission.

Completion states: IMPLEMENTED — no; REVIEWED — no; INTEGRATED — no; READY_TO_MERGE — no; DEPLOYED — no. Human gameplay acceptance has not been requested because there is no playable duel yet. Stop the authorised build at the scoped release candidate; optional expansion work does not extend the run.

Optional future encounter/ship ideas are recorded only in GAME_DESIGN.md and do not block this release.

Contract refinements: stable controller view/subscription and encounter ID, observer-safe own route/nominal preview, history only through replay cursor, explicit phase/commit/validation/assessment shapes. Latest player-turn replay includes automatic aftermath; no encounter-wide replay browser required. Numeric mechanics unchanged.

TSB-11A / attempt 1: UI w7:p5; /home/jd/projects/tactical-space-battle-worktrees/ui-11a, tsb/11a-console, base 7d58e4373b77b94e224fd2cc0214e58044aafbbd, port 4272. Sequencing refinement: independent React console composition can run after accepted tooling; gameplay binding/Pixi/controller still wait for M0 contracts. General owns contracts/scenarios, UI owns layout files, no shared write overlap.

Ownership decision: contract implementation attempt 1 made no files after repeated finite waits and scope steering; stopped its active turn, verified clean base and settled pane. Transfer bounded concrete contract typing/config/scenario task to Assistant attempt 2; no model/session changes, no rule changes. General remains simulation/combat/AI owner.
