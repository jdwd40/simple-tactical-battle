# Project status — Tactical Space Battle

Canonical: /home/jd/projects/tactical-space-battle/PROJECT_STATUS.md. Sole writer: lead. DEVELOPMENT_PLAN.md is the sole backlog; rules: GAME_DESIGN.md / WEGO_SPEC.md; boundaries: ARCHITECTURE.md / AGENTS.md. Worktree status copies may be stale.

## Authority and current milestone

User approved automated implementation through M3's local release candidate on 2026-10-12: "plan is aproved. All systems go. Run automated as much as possible from now on". Local commits, integration, tests and corrections authorised. No default/release-branch merge, remote push or public deployment authorised.

M0 COMPLETE: approved rules/contracts, scaffold, public initial scenario and reviewed console. Combined canonical build/typecheck/lint,57 unit tests/7 files and7 Chromium tests passed at b71fe73 on 2026-10-12. Static startup only; no gameplay claim.

Current M1 acceptance: real deterministic fixed-tick movement; browser plot/commit/playback/assessment; speed/pause/skip independence; clean restart. Engine and Pixi components accepted/integrated. UI11C real application/controller binding active; Assistant12B lifecycle regressions follow its accepted delivery.

Repository /home/jd/projects/tactical-space-battle, local tsb/integration, accepted source f4d77dc649497be98d63de63da4d06dd5e123be7; documentation checkpoint follows (see git log). No remote. Baseline c315b14409ce101fc5c296bc5e533ee91ca9bc7e. Combined build/typecheck/lint,136unit/18files and15browser passed on2026-10-13. Browser acceptance is static M0 plus public renderer fixtures; real M1 controller/Pixi binding remains pending.

## Confirmed factory mapping

Herdr shut down at22:58:38 UTC on2026-10-12 (server log; cause not established). Lead inadvertently invoked server startup while checking availability at22:58:58; saved w7 tab/pane topology restored, new terminal IDs. Original Claude session UUIDs restored at p3/p5, blocked by /home/jd folder-trust prompts; user confirmation requested per bundled Herdr skill. Codex p6/p7 initially restored as empty shells; exact original UUIDs identified from task histories, resumed/confirmed without model/config overrides. Lead's exact active session01a12cb2-14ea-7df1-9e72-3d26779d541c verified against current tool calls and max configuration; same-session frontend resumption at p1 initiated without a new prompt/second writer. Revalidate identity/readiness after recovery; do not dispatch on tab labels alone.

| Role | Pane / tab | Current state |
| --- | --- | --- |
| Lead | w7:p1 / Sol6.1M | Exact original active thread/frontend recovered; orchestration checkpoint |
| General | w7:p8 / opusx builder | Original09697ee9 session moved/restored after05:21OOM; RECOVERY-G03 check;10 accepted, no active implementation |
| UI | w7:p5 / opus UI |11B /2 accepted; active11C /1 real controller/application binding in ui-11c |
| Assistant | w7:p9 / Codex Jnr | Original01a1318b session restored in newpane afterOOM; RECOVERY-A03 check;12A accepted, no active implementation |
| Reviewer | w7:p7 / sol6.1h Review | REVIEW-TSB-11B /2/round1 PASS after post-OOM rerun; available |

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
| TSB-10 General /1 | general-10 / tsb/10-foundation / cf58c7d1c531191be470d9b45646d30860413f37 | 041e441e516d842cc2423e96c637c61ff0d323c3; round0 PASS, integratedd8a62d9; combined build/type/lint/unit92passed |
| TSB-12A Assistant /1 | assistant-12a / tsb/12a-regressions / d8a62d956f0def3c71d8b6c6dd3cd493ecd9def1 | 36cc382aa840beb38aeb2120617714e9db19d42c; round0 PASS, integratedd945ab4; focused12/full104unit passed; build/type/lint passed;12B follows11C |
| TSB-11B UI /1→2 | ui-11b / tsb/11b-battlefield / cf58c7d1c531191be470d9b45646d30860413f37 | e81ce79 round0 CHANGES_REQUIRED; fixedfd611b78eec3ee5260b71eb59cdb599ee84e9297 round1 PASS; integrated7258b77/f4d77dc; post-OOM82unit/15browser independentpass; combined136unit/15browser passed |
| TSB-11C UI /1 | ui-11c / tsb/11c-playable / f4d77dc649497be98d63de63da4d06dd5e123be7 | Active real engine/controller/App movement drill, own tests/browser4272;12B after usable accepted controller |

Review snapshots: reviews/03a-r0@85223d3;11a-r0@f7d2ebd;11a-r1@eb38b7e;02-r0-a3@592d795;03b-r0@0e436. Original handoffs and collected reports in handoffs. Approval applies only to reviewed revision.

Ownership: General simulation/AI/domain; contract/scenario amendments sequenced by lead. Assistant root configuration/lockfile. UI React/application/Pixi. 03B temporary App startup ownership now released; 11C real engine/controller binding follows accepted10+11B. All concurrent writes isolated.

## Verification and preview

- Scaffold: independent install/build/type/lint, Chromium smoke and production inspection passed; initial zero unit tests explicitly allowed.
- Contracts:42unit/3files, build/type/lint; reviewer35 extra timing, validation, serialization and isolation probes. Typed UI usability check passed. Runtime engine obligations deferred.
- Console: dev/production screenshots1366×768,1024×700,390×844, keyboard/focus/reduced-motion. Licence correction8unit/7browser; byte-identical source/build/HTTP licence verified.
- Startup03B: builder/reviewer57unit/7files,7browser; reviewer transitive-private-import negative probe and production screenshots/readouts/keyboard. Combined canonical checks passed after integration.
- Movement10: independent85unit/8files,20turns/3600segments across4tick sizes,1709adversarial assertions including500geometry cases/6funding calculations/hidden-state equivalence.12A independent12focused/full104unit; incorrect-endpoint negative probe proved diagnostics/failure. Combined canonical build/type/lint/unit104passed after integration. Artifacts /tmp/tsb-review-10-r0-*.json and /tmp/tsb-review-12a-r0-negative.log; collected reports in handoffs.

Chromium coverage. No human gameplay acceptance or screenreader audit claimed. No playable preview yet. Reserve private Tailscale100.109.154.60:5280 for M1/M2; user needs that Tailnet or SSH forwarding. Track demo process/revision once real gameplay exists; no public exposure.

## Decisions and next actions

Approved baseline unchanged; numerical values are tuning hypotheses. Accepted refinements: stable getView/subscribe and encounter/revision identity; own route preview; cursor-prefix-only replay; controller-owned clock; historical replay origin without future outcome; tick-only frame events and deduplicated accumulated prefix. Latest player turn plus automatic aftermath is replay scope. Decisions: handoffs/TSB-02-ui-decisions.md and contracts/README.md.

Initial concrete schema typing transferred to Assistant after General02 stalled without edits; General retains engine/combat/AI. General10 resumed concrete implementation after same-task checkpoint steering; type/lint checks clean, tests underway, configuration unchanged. UI11B is checking actual Pixi rendering in Chromium and building focused tests.

2026-10-13 user answered "yes resume", authorising the two existing /home/jd folder-trust confirmations; cleared. Full implementation authorised; do not ask again for the same confirmations. Second Herdr outage at05:21 UTC: user confirmed kernelOOM killed headlessChrome and systemd OOMPolicy=stop killed the whole scope. User added4Gswap and runs herdr.service withOOMPolicy=continue, then resumed original sessions. Cause now established; no additional infrastructure changes by lead. Runtimepane changes p3→p8 General,p6→p9 Assistant, names preserved as observed. Reviewer11B/2/round1 explicitly re-run after interruption; prior partial counts do not constitute PASS. UIp5 was an empty shell on inspection, so lead resumed exact originala9360339 UUID there; no new model/session. Revalidate each role/readiness before next dispatch.

Recovery2026-10-13: authorised trust prompts cleared, original p3/p5 UUIDs revalidated. General RECOVERY-G01/1 confirms role/clean accepted10 checkout. UI11B/1 delivered after14browser checks/layout fix. Independent round0 found one medium blocking pause/reduced-motion tween-cancellation bug (actual control-flow probe, x1250→1500 after smoothing:null). UI attempt2/correction1 active. Reviewer build/type/lint/unit78/private-import checks passed; independent browser denied loopback EPERM. Native Codex resume dropped the recorded original never/danger-full-access policy to workspace-write/network false; verified in exact session turn-context histories. Lead reconnects idle p6/p7 to SAME UUIDs with original -a never -s danger-full-access, no model/effort overrides; source-read-only reviewer role remains binding. Runtime readiness/browser access will be checked before re-review. Next: review fixed11B, integrate; UI11C real binding; General20 after M1, Assistant12B after controller. No M1/demo claim yet.

Continue20/21/22,30/31/32,40/41/42,50/51/52 through the scoped release candidate. Sole acceptance/dependencies remain DEVELOPMENT_PLAN.md. Herdr server started during recovery is left running; no server stop/update, public deployment or unrelated process changes.

Completion: IMPLEMENTED/REVIEWED/INTEGRATED M0 and headless M1 foundation/regressions; full M1 browser milestone pending; READY_TO_MERGE no; DEPLOYED no. Human playtest at complete duel; human and technical acceptance separate.
