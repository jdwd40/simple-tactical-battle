# Project status — Tactical Space Battle

Canonical: /home/jd/projects/tactical-space-battle/PROJECT_STATUS.md. Sole writer: lead. DEVELOPMENT_PLAN.md is the sole backlog; GAME_DESIGN.md / WEGO_SPEC.md specify approved rules; ARCHITECTURE.md / AGENTS.md specify boundaries. Worktree copies may be stale.

## Authority and current milestone

The user approved automated implementation through M3's local release candidate on 2026-10-12: "plan is aproved. All systems go. Run automated as much as possible from now on". Local commits, integration, tests and corrections are authorised. No default/release-branch merge, remote push or public deployment is authorised.

Repository /home/jd/projects/tactical-space-battle, local branch tsb/integration, no remote. Accepted source 7a3c3439f104e9f49f260eb13cb80eb0a95cdc42; documentation checkpoints follow in Git. Baseline c315b14409ce101fc5c296bc5e533ee91ca9bc7e.

M0 COMPLETE: approved rules/contracts, runnable scaffold, public initial scenario and reviewed console. Combined build/typecheck/lint, 57 unit tests and 7 Chromium tests passed at b71fe73. This was startup, not gameplay.

M1 COMPLETE: real headless movement engine, PixiJS plot, application controller and complementary lifecycle regressions REVIEWED and INTEGRATED. Combined 850d987 build/typecheck/lint, 166 unit tests / 21 files and 24 Chromium tests passed on 2026-10-13 (browser4391, one worker/no reuse). Plot/commit/genuine 100-tick movement/playback/assessment, complete-result playback independence and fresh restart with cleared acquired/lost contact history verified. Prior fbea50e combined163unit/23browser also passed and was recovered after interruption without duplication.

Current M2A: TSB-20 sensors/stealth engine PASS/integrated7a3c343; combined build/type/lint/180unit pass. UI21 clean component checkpoint1b4b33c (194unit/26browser) collected; lead rebased it conflict-free onto accepted20 at7a3c343, new checkpoint53d8a4a. Same21/1 resumed for real scan/production/browser verification before review. Assistant22 public-controller information regressions start from accepted20; UI21 owns browser controls/tooltips/log inspection. Final M2A gate waits for both reviewed changes and combined browser checks. Combat, reactive AI and complete-duel outcomes remain M2B/C, followed by M3 release checks.

## Confirmed factory mapping and recovery

Current workspace w7; preserve existing tab names and original sessions. Revalidated all panes and read their own completion/recovery reports on 2026-10-13 after model-capacity interruption. No new agents/sessions. Implementation checkouts clean; only the lead's canonical status edit was uncommitted. No conflicting work found.

| Role | Confirmed pane / tab | Original session | State |
| --- | --- | --- | --- |
| Lead | w7:p1 / Sol6.1M | 01a12cb2-14ea-7df1-9e72-3d26779d541c | Active orchestration/integration |
| General | w7:p8 / opusx builder | 09697ee9-8599-4a78-926d-23fd735b9c69 | Available; TSB-20 /1 PASS/integrated |
| UI | w7:p5 / opus UI | a9360339-a6cf-46b7-8e1b-11e28d7e9ab1 | TSB-21 /1 delivered; available pending review findings |
| Assistant | w7:p9 / Codex Jnr | 01a1318b-b734-7c43-a314-4c5a78839c48 | TSB-22 /1 delivered; available pending review |
| Reviewer | w7:p7 / sol6.1h Review | 01a131d6-82cc-7160-aa30-8be514aebede | REVIEW-TSB-21 /1/round0 active;22 queued afterward |

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
| TSB-12B Assistant /1 | assistant-12b / tsb/12b-lifecycle / fbea50ed56d6809fd06a91fd1343bb0a38016981 |1f70d8c0972ae0856c462768c3135ce912bb542b; round0 PASS; integrated850d987; combined166unit/24browser/build/type/lint PASS |
| TSB-20 General /1 | general-20 / tsb/20-sensors / 850d98787ccd6fa32a2bc15bc481a2b976f29430 |85c8c510dec194e3807a8efcfaf3b474915c7281; round0 PASS; integrated7a3c343; combined180unit/build/type/lint pass;6835 independent assertions/23turns/3tick sizes |
| TSB-21 UI /1 | ui-21 / tsb/21-sensors / original850d987; reviewbase7a3c3439f104e9f49f260eb13cb80eb0a95cdc42 | Checkpoint1b4b33c→rebased53d8a4a; finaldd1f31ad407448f7da4cb0a3e8a48c0f463d7ca5 delivered208unit/24files,27browser,build/type/lint/production pass; round0 active reviews/21-r0 |
| TSB-22 Assistant /1 | assistant-22 / tsb/22-information / 7a3c3439f104e9f49f260eb13cb80eb0a95cdc42 | Deliverede3eff4dba432e98212c8cf08a62f257c28b6880f;4focused/184fullunit/23files/build/type/lint pass; review queued in reviews/22-r0 after21 |

Original assignments, reports and review verdicts: handoffs/. Exact detached snapshots: reviews/<task>-r<round>; Git worktree list records retained heads. TSB-11C report-a2/review-r1 documents the three corrected blockers: nested view immutability, re-entrant restart/abandon during commit, and blank grid fields after restart. No further review of that accepted change is pending.

Ownership: General simulation/AI/domain and sequenced scenario/contract amendments; Assistant root configuration/lockfile and scoped support; UI React/application/Pixi. Lead transfers obsolete src/ui/ScenarioStartup.tsx and its fixture-test adaptation to TSB-12B only. UI's import-boundary amendment is accepted: App/main compose the private game facade; UI/rendering/AI/public fixtures remain barred from authoritative state directly or through barrels. See AGENTS.md and handoffs/TSB-11C-decisions.md.

TSB-21 narrow scope clarification: application factory/index may expose whitelisted immutable system capability booleans for App to pass to console controls. No world/EngineApi payload or private game imports in UI/rendering, including type-only imports. No lifecycle redesign. See handoffs/TSB-21-scope.md; this is an implementation wiring choice, not a new mechanic.

## Verification and preview

Accepted foundation evidence includes 20-turn/3600-segment checks across four tick sizes, 1709 adversarial assertions including 500 geometry cases, resource checks, hidden-state equivalence and negative regressions. Controller evidence includes single resolution, cached observation-only scripted planning, cursor-prefix replay, immutable stable views and re-entrant/stale-timer guards. Latest reviewer independently ran 163 unit / 23 browser tests and production restart/abandon checks, with blank entry, focus recovery, one canvas, no errors and no production diagnostics.

Browser artifacts and reports: handoffs/TSB-11C-report-a2.md, handoffs/TSB-11C-review-r1.md; reviews/11c-r1/test-results/reviewer-production-restart.png; /tmp/tsb-review-11c-r1-controller-probes.json and /tmp/tsb-review-11c-r1-production.json. Earlier task evidence remains in handoffs and review snapshots. Chromium coverage only; no human gameplay acceptance or screenreader audit claimed.

Private production movement preview: http://100.109.154.60:5280/?seed=17 on the existing Tailscale interface. Immutable accepted M1 build: previews/m1-850d987/dist; source850d987 recorded in SOURCE_REVISION. Original foreground preview ended withSIGTERM during interruption; replacement is task-owned detached PID971192, recorded in previews/m1-850d987/server.pid with server.log. Fresh Chromium validation of this exact updated origin passed HTTP200, plot16/10 → commit → skip → assessment at13/10 → restart with blank fields/one canvas/no errors/no production diagnostics. Evidence: previews/m1-850d987/verification.json, planning.png and assessment.png; earlier fbea50e artifacts retained. Access requires the user's Tailnet or SSH forwarding; server-local reachability alone does not prove the user's access. This is a movement drill: passive contacts, scripted patrol, no active scan/weapon combat or outcomes yet. It is not a public deployment. Task browser ports: UI4272, Assistant4273, reviewer438x, combined4391; one Chromium worker and sequential browser jobs.

## Decisions, blockers and next actions

Approved mechanics and numerical tuning hypotheses remain unchanged. Accepted refinements: stable getView/subscribe, encounter/revision identity, own route preview, cursor-prefix-only replay, controller-owned presentation clock, replay origin without future outcome, tick-only events with deduplicated prefixes. Latest player turn plus automatic aftermath is replay scope. See contracts/README.md and handoffs/TSB-02-ui-decisions.md.

Next: collect/review exact Assistant22 and UI21 final deliveries, integrate accepted changes and verify combined sensor interface; update private preview at M2A. Continue30/31/32,40/41/42 and50/51/52 through the authorised release candidate. No implementation blocker or new approval needed within this scope. Model-capacity interruption delayed lead reporting; original combined M1 job completed successfully and existing worker sessions/assignments were preserved.

State: IMPLEMENTED / REVIEWED / INTEGRATED M0 and M1. M2A active. READY_TO_MERGE no; DEPLOYED no. At the complete-duel checkpoint request human playtest feedback and keep it separate from technical completion. Do not add expansion features.
