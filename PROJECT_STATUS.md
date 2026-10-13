# Project status — Tactical Space Battle

Canonical: /home/jd/projects/tactical-space-battle/PROJECT_STATUS.md. Sole writer: lead. DEVELOPMENT_PLAN.md is the sole backlog; GAME_DESIGN.md / WEGO_SPEC.md specify approved rules; ARCHITECTURE.md / AGENTS.md specify boundaries. Worktree copies may be stale.

## Authority and current milestone

The user approved automated implementation through M3's local release candidate on 2026-10-12: "plan is aproved. All systems go. Run automated as much as possible from now on". Local commits, integration, tests and corrections are authorised. No default/release-branch merge, remote push or public deployment is authorised.

Repository /home/jd/projects/tactical-space-battle, local branch tsb/integration, no remote. Accepted source fbea50ed56d6809fd06a91fd1343bb0a38016981; documentation checkpoints follow in Git. Baseline c315b14409ce101fc5c296bc5e533ee91ca9bc7e.

M0 COMPLETE: approved rules/contracts, runnable scaffold, public initial scenario and reviewed console. Combined build/typecheck/lint, 57 unit tests and 7 Chromium tests passed at b71fe73. This was startup, not gameplay.

Current M1: the real headless movement engine, PixiJS plot and application controller are REVIEWED and INTEGRATED. Combined accepted fbea50e build/typecheck/lint, 163 unit tests / 20 files and 23 Chromium tests passed on 2026-10-13; the interrupted lead check completed successfully and was recovered, not duplicated. M1 acceptance is plot/commit/genuine 100-tick movement/playback/assessment, playback-independent results and clean restart. TSB-12B complementary multi-turn lifecycle regressions remain before the formal M1 checkpoint. Sensors/combat/reactive AI and complete-duel outcomes remain M2, then M3 polish/release checks.

## Confirmed factory mapping and recovery

Current workspace w7; preserve existing tab names and original sessions. Revalidated all panes and read their own completion/recovery reports on 2026-10-13 after model-capacity interruption. No new agents/sessions. Implementation checkouts clean; only the lead's canonical status edit was uncommitted. No conflicting work found.

| Role | Confirmed pane / tab | Original session | State |
| --- | --- | --- | --- |
| Lead | w7:p1 / Sol6.1M | 01a12cb2-14ea-7df1-9e72-3d26779d541c | Active orchestration/integration |
| General | w7:p8 / opusx builder | 09697ee9-8599-4a78-926d-23fd735b9c69 | Available; accepted TSB-10 unchanged; TSB-20 follows M1 |
| UI | w7:p5 / opus UI | a9360339-a6cf-46b7-8e1b-11e28d7e9ab1 | Available; accepted TSB-11C /2 unchanged; TSB-21 follows M1 |
| Assistant | w7:p9 / Codex Jnr | 01a1318b-b734-7c43-a314-4c5a78839c48 | TSB-12B /1 delivered; available pending findings |
| Reviewer | w7:p7 / sol6.1h Review | 01a131d6-82cc-7160-aa30-8be514aebede | REVIEW-TSB-12B /1/round0 active; prior11C PASS preserved |

Earlier outages: Herdr stopped at 22:58:38 UTC Oct12 and 05:21 UTC Oct13. User established kernel OOM killed headless Chrome, then systemd OOMPolicy=stop ended the scope. User added 4G swap and moved Herdr to herdr.service with OOMPolicy=continue; infrastructure investigation ended. General moved p3→p8 and Assistant p6→p9; original sessions restored, existing /home/jd trust confirmations explicitly authorised and cleared. Reviewer/Assistant native resume had lost their original full-access policy; the same UUIDs were resumed with their recorded original permissions, without model changes. Reviewer browser access subsequently passed. Interrupted REVIEW-TSB-11B /2/round1 was re-run and accepted. No current recovery blocker.

One active assignment per builder; independent reviewer source read-only. Initial review plus at most two correction rounds. Approval applies only to the exact reviewed revision. All paths below are relative to /home/jd/projects/tactical-space-battle-worktrees.

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
| TSB-11C UI /1→2 | ui-11c / tsb/11c-playable / f4d77dc649497be98d63de63da4d06dd5e123be7 |0f8378d7 round0 CHANGES_REQUIRED3medium; corrected06601d1eca25977364e343a901984ae6d349f844 round1 PASS;163unit/23browser/build/type/lint/production independentlypass; integrated e33d043/fbea50e; combined 163unit/23browser/build/type/lint PASS |
| TSB-12B Assistant /1 | assistant-12b / tsb/12b-lifecycle / fbea50ed56d6809fd06a91fd1343bb0a38016981 | Delivered1f70d8c0972ae0856c462768c3135ce912bb542b;166unit/21files,24browser/build/type/lint passed; independent round0 active in reviews/12b-r0 |

Original assignments, reports and review verdicts: handoffs/. Exact detached snapshots: reviews/<task>-r<round>; Git worktree list records retained heads. TSB-11C report-a2/review-r1 documents the three corrected blockers: nested view immutability, re-entrant restart/abandon during commit, and blank grid fields after restart. No further review of that accepted change is pending.

Ownership: General simulation/AI/domain and sequenced scenario/contract amendments; Assistant root configuration/lockfile and scoped support; UI React/application/Pixi. Lead transfers obsolete src/ui/ScenarioStartup.tsx and its fixture-test adaptation to TSB-12B only. UI's import-boundary amendment is accepted: App/main compose the private game facade; UI/rendering/AI/public fixtures remain barred from authoritative state directly or through barrels. See AGENTS.md and handoffs/TSB-11C-decisions.md.

## Verification and preview

Accepted foundation evidence includes 20-turn/3600-segment checks across four tick sizes, 1709 adversarial assertions including 500 geometry cases, resource checks, hidden-state equivalence and negative regressions. Controller evidence includes single resolution, cached observation-only scripted planning, cursor-prefix replay, immutable stable views and re-entrant/stale-timer guards. Latest reviewer independently ran 163 unit / 23 browser tests and production restart/abandon checks, with blank entry, focus recovery, one canvas, no errors and no production diagnostics.

Browser artifacts and reports: handoffs/TSB-11C-report-a2.md, handoffs/TSB-11C-review-r1.md; reviews/11c-r1/test-results/reviewer-production-restart.png; /tmp/tsb-review-11c-r1-controller-probes.json and /tmp/tsb-review-11c-r1-production.json. Earlier task evidence remains in handoffs and review snapshots. Chromium coverage only; no human gameplay acceptance or screenreader audit claimed.

Private production movement preview: http://100.109.154.60:5280/?seed=17 on the existing Tailscale interface. Immutable build: previews/m1-fbea50e/dist; source recorded in SOURCE_REVISION. Lead exec session64866 owns the server. Fresh Chromium validation of this exact origin passed HTTP200, plot16/10 → commit → skip → assessment at13/10 → restart with blank fields/one canvas/no errors/no production diagnostics. Evidence: previews/m1-fbea50e/verification.json, planning.png and assessment.png. Access requires the user's Tailnet or SSH forwarding; server-local reachability alone does not prove the user's access. This is a movement drill: passive contacts, scripted patrol, no active scan/weapon combat or outcomes yet. It is not a public deployment. Task browser ports: UI4272, Assistant4273, reviewer438x, combined4391; one Chromium worker and sequential browser jobs.

## Decisions, blockers and next actions

Approved mechanics and numerical tuning hypotheses remain unchanged. Accepted refinements: stable getView/subscribe, encounter/revision identity, own route preview, cursor-prefix-only replay, controller-owned presentation clock, replay origin without future outcome, tick-only events with deduplicated prefixes. Latest player turn plus automatic aftermath is replay scope. See contracts/README.md and handoffs/TSB-02-ui-decisions.md.

Next: validate the private preview; collect TSB-12B /1, review exact snapshot, route any focused fixes, integrate and verify combined result. Then release TSB-20/21 in separate worktrees against the settled contracts, followed by22; continue30/31/32,40/41/42 and50/51/52 through the authorised release candidate. No implementation blocker or new approval needed within this scope.

State: IMPLEMENTED / REVIEWED / INTEGRATED M0 and the M1 playable candidate. Formal M1 completion awaits12B. READY_TO_MERGE no; DEPLOYED no. At the complete-duel checkpoint request human playtest feedback and keep it separate from technical completion. Do not add expansion features.
