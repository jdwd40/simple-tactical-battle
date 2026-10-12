# Project status — Tactical Space Battle

Canonical: /home/jd/projects/tactical-space-battle/PROJECT_STATUS.md. Sole writer: lead. DEVELOPMENT_PLAN.md is the sole backlog; rules: GAME_DESIGN.md / WEGO_SPEC.md; boundaries: ARCHITECTURE.md / AGENTS.md. Worktree status copies may be stale.

## Authority and current milestone

User approved automated implementation through M3's local release candidate on 2026-10-12: "plan is aproved. All systems go. Run automated as much as possible from now on". Local commits, integration, tests and corrections authorised. No default/release-branch merge, remote push or public deployment authorised.

M0 COMPLETE: approved rules/contracts, scaffold, public initial scenario and reviewed console. Combined canonical build/typecheck/lint,57 unit tests/7 files and7 Chromium tests passed at b71fe73 on 2026-10-12. Static startup only; no gameplay claim.

Current M1 acceptance: real deterministic fixed-tick movement; browser plot/commit/playback/assessment; speed/pause/skip independence; clean restart. Engine and Pixi components active; real application binding and supporting regressions follow accepted deliveries.

Repository /home/jd/projects/tactical-space-battle, local tsb/integration, accepted source b71fe73; documentation checkpoint follows. No remote. Baseline c315b14409ce101fc5c296bc5e533ee91ca9bc7e. Lead status edits can be uncommitted between checkpoints.

## Confirmed factory mapping

Revalidated 2026-10-12 in Herdr workspace w7; preserve names/configurations. Roles confirmed by own-pane reports/user assignments, not model labels. Explicit pane identity/user confirmation establish caller despite Codex subprocesses omitting Herdr environment. Revalidate after restarts/moves.

| Role | Pane / tab | Current state |
| --- | --- | --- |
| Lead | w7:p1 / Sol6.1M | Integration/orchestration |
| General | w7:p3 / opusx builder | TSB-10 / attempt1 active; checkpoint requested after no source/tool progress since22:38 |
| UI | w7:p5 / opus UI | TSB-11B / attempt1 active, renderer/new controls |
| Assistant | w7:p6 / codex Jnr | TSB-03B accepted/integrated; no active assignment |
| Reviewer | w7:p7 / sol6.1h Review | REVIEW-TSB-03B /1/round0 PASS; available |

One assignment per builder. Lead alone dispatches; reviewer source read-only. Initial review plus at most two correction rounds. Paths below are under /home/jd/projects/tactical-space-battle-worktrees.

## Tasks and accepted revisions

| Task | Worktree / branch / base | Delivered revision / state |
| --- | --- | --- |
| TSB-01 Lead | canonical repository | Approved documentation reconciliation complete |
| TSB-03A Assistant /1 | assistant-03a / tsb/03a-scaffold / c315b14 | 85223d31ad454bc6b56f60e830904e531728a579; round0 PASS; integrated08e14d9 |
| TSB-02 General /1 | general-02 / tsb/02-contracts / 7d58e4373b77b94e224fd2cc0214e58044aafbbd | Stopped after bounded waits without source changes; clean base preserved; no success claimed |
| TSB-02 Assistant /2→3 | assistant-02 / tsb/02-contracts-a2 / 7890bf9399111ef97b736de908441c76cfd02632 | 66c6346 then592d7955cbd93bc63855e5d0bd996c4401c4cf0b; typed UI check usable; round0 PASS; integrated228dd87/ba5670f |
| TSB-11A UI /1→2 | ui-11a / tsb/11a-console / 7d58e43 | f7d2ebd round0 CHANGES_REQUIRED (production font licence); eb38b7efeb0fee5629c7ad7277d489aaa45e6d64 round1 PASS; integratedff0b88f/6dc5593 |
| TSB-03B Assistant /1 | assistant-03b / tsb/03b-fixtures / cf58c7d1c531191be470d9b45646d30860413f37 | 0e4368000fd5b2d882c5acf473f13496641ff55a; round0 PASS; integratedb71fe73 |
| TSB-10 General /1 | general-10 / tsb/10-foundation / cf58c7d1c531191be470d9b45646d30860413f37 | Active; simulation only; no delivery/review |
| TSB-11B UI /1 | ui-11b / tsb/11b-battlefield / cf58c7d1c531191be470d9b45646d30860413f37 | Active; renderer/new components/tests; excludes App/root styling/config/controller |

Review snapshots: reviews/03a-r0@85223d3;11a-r0@f7d2ebd;11a-r1@eb38b7e;02-r0-a3@592d795;03b-r0@0e436. Original handoffs and collected reports in handoffs. Approval applies only to reviewed revision.

Ownership: General simulation/AI/domain; contract/scenario amendments sequenced by lead. Assistant root configuration/lockfile. UI React/application/Pixi. 03B temporary App startup ownership now released; 11C real engine/controller binding follows accepted10+11B. All concurrent writes isolated.

## Verification and preview

- Scaffold: independent install/build/type/lint, Chromium smoke and production inspection passed; initial zero unit tests explicitly allowed.
- Contracts:42unit/3files, build/type/lint; reviewer35 extra timing, validation, serialization and isolation probes. Typed UI usability check passed. Runtime engine obligations deferred.
- Console: dev/production screenshots1366×768,1024×700,390×844, keyboard/focus/reduced-motion. Licence correction8unit/7browser; byte-identical source/build/HTTP licence verified.
- Startup03B: builder/reviewer57unit/7files,7browser; reviewer transitive-private-import negative probe and production screenshots/readouts/keyboard. Combined canonical checks passed after integration.

Chromium coverage. No human gameplay acceptance or screenreader audit claimed. No playable preview yet. Reserve private Tailscale100.109.154.60:5280 for M1/M2; user needs that Tailnet or SSH forwarding. Track demo process/revision once real gameplay exists; no public exposure.

## Decisions and next actions

Approved baseline unchanged; numerical values are tuning hypotheses. Accepted refinements: stable getView/subscribe and encounter/revision identity; own route preview; cursor-prefix-only replay; controller-owned clock; historical replay origin without future outcome; tick-only frame events and deduplicated accumulated prefix. Latest player turn plus automatic aftermath is replay scope. Decisions: handoffs/TSB-02-ui-decisions.md and contracts/README.md.

Initial concrete schema typing transferred to Assistant after General02 stalled without edits; General retains engine/combat/AI. General10 has no changes after ten minutes since last tool output; same-task steering delivered to inspect actual blocker, configuration unchanged. UI11B producing renderer files.

Next: collect10/11B exact reports; independent review, focused fixes, integration and combined checks. Then UI11C real controller binding and Assistant12 lifecycle regressions. Continue20/21/22,30/31/32,40/41/42,50/51/52 through scoped release candidate. Sole task acceptance/dependencies remain DEVELOPMENT_PLAN.md.

Completion: IMPLEMENTED M0; REVIEWED M0; INTEGRATED M0; READY_TO_MERGE no; DEPLOYED no. Human playtest requested at complete duel; human and technical acceptance separate.
