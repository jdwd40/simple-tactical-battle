# Project status — Tactical Space Battle

Canonical: /home/jd/projects/tactical-space-battle/PROJECT_STATUS.md. Sole writer: lead. DEVELOPMENT_PLAN.md is the sole backlog; GAME_DESIGN.md / WEGO_SPEC.md specify approved rules; ARCHITECTURE.md / AGENTS.md specify boundaries. Worktree copies may be stale.

## Authority and current milestone

The user approved automated implementation through M3's local release candidate on 2026-10-12: "plan is aproved. All systems go. Run automated as much as possible from now on". Local commits, integration, tests and corrections are authorised. No default/release-branch merge, remote push or public deployment is authorised.

Repository /home/jd/projects/tactical-space-battle, local branch tsb/integration, no remote. Accepted source c4fb6c7477762e31ef47cb0d157158b10b9b0987; documentation checkpoints follow in Git. Baseline c315b14409ce101fc5c296bc5e533ee91ca9bc7e.

M0 COMPLETE: approved rules/contracts, runnable scaffold, public initial scenario and reviewed console. Combined build/typecheck/lint, 57 unit tests and 7 Chromium tests passed at b71fe73. This was startup, not gameplay.

M1 COMPLETE: real headless movement engine, PixiJS plot, application controller and complementary lifecycle regressions REVIEWED and INTEGRATED. Combined 850d987 build/typecheck/lint, 166 unit tests / 21 files and 24 Chromium tests passed on 2026-10-13 (browser4391, one worker/no reuse). Plot/commit/genuine 100-tick movement/playback/assessment, complete-result playback independence and fresh restart with cleared acquired/lost contact history verified. Prior fbea50e combined163unit/23browser also passed and was recovered after interruption without duplication.

M2A COMPLETE atc279edb: sensors/stealth20, real UI21 and information regressions22 REVIEWED/INTEGRATED. Combined build/typecheck/lint,215unit/25files and27Chromium tests at4391 passed. Reviewer21 also verified production scan/replay/restart, keyboard/reduced motion and contact selection/expiry;22/r1 confirmed strict nested future-payload audit and negative controls. Reviewed sensor-code preview is available (artifact sourcea3beb00, runtime unchanged by22 test-only additions).

M2B COMPLETE at088a522: both weapons/resources, shield/hull damage, swept projectile/obstacle behavior, cross-turn/launcher-death persistence, simultaneous destruction and observer-safe outcomes. Tasks30A/30B/31/32 independently PASS and integrated. Combined build/typecheck/lint,274unit/31files and36Chromium tests passed at4391 with one worker/no reuse. Reviewer31 also checked the production interface and four real-engine automatic-aftermath/re-entrant restart/abandon probes.

Current M2C acceptance: the complete browser mission against observation-only PATROL/INVESTIGATE/ENGAGE/SEARCH AI, survivor evasion while missiles remain, faithful replay and reproducible restart without terminal intervention or gameplay mocks. TSB-40 round0 PASS and integratedc4fb6c7. TSB-41 /1 delivered7f6aa01, review queued after52A; TSB-42 follows accepted41. Human gameplay acceptance remains pending and separate from technical completion.

## Confirmed factory mapping and recovery

Current workspace w7; preserve existing tab names and original sessions. Revalidated all panes and read their own completion/recovery reports on 2026-10-13 after model-capacity interruption. No new agents/sessions. Implementation checkouts clean; only the lead's canonical status edit was uncommitted. No conflicting work found.

| Role | Confirmed pane / tab | Original session | State |
| --- | --- | --- | --- |
| Lead | w7:p1 / Sol6.1M | 01a12cb2-14ea-7df1-9e72-3d26779d541c | Active orchestration/integration |
| General | w7:p8 / opusx builder | 09697ee9-8599-4a78-926d-23fd735b9c69 | Available;40 /1 round0 PASS/integrated |
| UI | w7:p5 / opus UI | a9360339-a6cf-46b7-8e1b-11e28d7e9ab1 | Available;41 /1 delivered, review queued after52A |
| Assistant | w7:p9 / Codex Jnr | 01a1318b-b734-7c43-a314-4c5a78839c48 | Available;52A /1 delivered for review |
| Reviewer | w7:p7 / sol6.1h Review | 01a131d6-82cc-7160-aa30-8be514aebede | REVIEW-TSB-52A /1 round0 assigned |

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
| TSB-21 UI /1 | ui-21 / tsb/21-sensors / original850d987; reviewbase7a3c3439f104e9f49f260eb13cb80eb0a95cdc42 | Checkpoint1b4b33c→rebased53d8a4a; finaldd1f31ad407448f7da4cb0a3e8a48c0f463d7ca5 round0 PASS; integrated0d7b945/a3beb00;208unit/27browser/production independentlypass; combined208unit/build/type/lint pass |
| TSB-22 Assistant /1→2 | assistant-22 / tsb/22-information / 7a3c3439f104e9f49f260eb13cb80eb0a95cdc42 |e3eff4d round0 CHANGES_REQUIRED (test audit gap, no production leak); fixed6332e686fb1891b2fe8d9375d96c00a9503a9e0c round1 PASS; integrateda4b9f33/c279edb; combined215unit/27browser/build/type/lint pass |
| TSB-30A General /1 | general-30a / tsb/30a-lasers / c279edbd3c9c945a3bbbd472a895379dd5f22dae |d3e526eb4b0b6fed227cc799b5bc7e22614357d8 (engine0dfdbcb+docs) round0 PASS; integrated4940506/64738f4; combined226unit/build/type/lint pass; independent seed73 range/funding50/100/200ms/reversedbatch/privacy probes pass |
| TSB-30B General /1 | general-30b / tsb/30b-missiles / 64738f42537d44aeb85f52f6282c4cf93d38d72a | deb0c6a955605c0661a3867f7cc3bfd48e57f6af (enginee027e8c+docs) round0 PASS; integrated7f01a3f/9f2e3d2; combined241unit/build/type/lint pass;6independent seed83 sweep/funding/persistence/privacy probes pass |
| TSB-31 UI /1 | ui-31 / tsb/31-combat-ui / originalc279edb; reviewbase9f2e3d2074f3bcd0ef53de86ffa86f9bf611cde8 | Finalb4551055c2b45993f4007ead4131974db331f8a3 round0 PASS; integrated159916e/d0ad835/aa1dffc/088a522;267unit/36browser/production and4independentrealafterlife/reentrancyprobes pass; combined M2B274unit/36browser PASS |
| TSB-32 Assistant /1 | assistant-32 / tsb/32-combat-regressions / 9f2e3d2074f3bcd0ef53de86ffa86f9bf611cde8 |38fb1cd46cba8fd1cbda44fec2288b965ba86f50 round0 PASS; integratedfbac43a; combined248unit/build/type/lint pass; independentnegativeblindholdcontrol and reproducibleinputs verified |
| TSB-40 General /1 | general-40 / tsb/40-opponent / 9f2e3d2074f3bcd0ef53de86ffa86f9bf611cde8 | b0e2b7ae92ccf5e30657d5bc8fc04628210085d0 round0 PASS; integratedc4fb6c7;255unit/29files,14AItests/9boundedencounters and4independent public-boundary/navigation/resource probes PASS |
| TSB-41 UI /1 | ui-41 / tsb/41-mission-flow / c4fb6c7477762e31ef47cb0d157158b10b9b0987 | Delivered7f6aa01c33b08ad401e92a391a4476a97e1b8d1e;291unit/34files/39browser/build/type/lint/production PASS; round0 queued reviews/41-r0 after52A |
| TSB-52A Assistant /1 | assistant-52a / tsb/52a-batch / 667b829fce9f012bba0db01b04f7545fdba78123 | Delivered0fd7b15efc3ea8005f4b651b3a928e120194e03e;298unit/34files/build/type/lint/tooltype PASS;20runs zero invalidity,20exactreplays; round0 assigned reviews/52a-r0 |

Original assignments, reports and review verdicts: handoffs/. Exact detached snapshots: reviews/<task>-r<round>; Git worktree list records retained heads. TSB-11C report-a2/review-r1 documents the three corrected blockers: nested view immutability, re-entrant restart/abandon during commit, and blank grid fields after restart. No further review of that accepted change is pending.

Ownership: General simulation/AI/domain and sequenced scenario/contract amendments; Assistant root configuration/lockfile and scoped support; UI React/application/Pixi. Lead transfers obsolete src/ui/ScenarioStartup.tsx and its fixture-test adaptation to TSB-12B only. UI's import-boundary amendment is accepted: App/main compose the private game facade; UI/rendering/AI/public fixtures remain barred from authoritative state directly or through barrels. See AGENTS.md and handoffs/TSB-11C-decisions.md.

TSB-21 narrow scope clarification: application factory/index may expose whitelisted immutable system capability booleans for App to pass to console controls. No world/EngineApi payload or private game imports in UI/rendering, including type-only imports. No lifecycle redesign. See handoffs/TSB-21-scope.md; this is an implementation wiring choice, not a new mechanic.

## Verification and preview

Accepted foundation evidence includes 20-turn/3600-segment checks across four tick sizes, 1709 adversarial assertions including 500 geometry cases, resource checks, hidden-state equivalence and negative regressions. Controller evidence includes single resolution, cached observation-only planning, cursor-prefix replay, immutable stable views and re-entrant/stale-timer guards. Latest combined scripted-combat evidence:274unit/36browser/build/type/lint PASS. Reviewer31 independently ran267unit/36browser and fresh production interaction checks; reviewer40 verified the observation-only planner and117-seed navigation/resource/hidden-world probes. Main browser AI integration is41, still active.

Browser artifacts and reports: handoffs/TSB-11C-report-a2.md, handoffs/TSB-11C-review-r1.md; reviews/11c-r1/test-results/reviewer-production-restart.png; /tmp/tsb-review-11c-r1-controller-probes.json and /tmp/tsb-review-11c-r1-production.json. Earlier task evidence remains in handoffs and review snapshots. Chromium coverage only; no human gameplay acceptance or screenreader audit claimed.

Private sensor preview: http://100.109.154.60:5280/?seed=17 on the existing Tailscale interface. Immutable reviewed source a3beb004b1937677bd250b54e35b8c3a9404396e in previews/m2a-a3beb00/dist; SOURCE_REVISION, server.pid and server.log record it. Task-owned detached PID1005513 replaces the stopped M1 preview971192. Fresh private-origin Chromium check passed HTTP200, course10/12 → turn1 → hold/pulse turn2 → assessment → replay100/101 → restart: no future contact at100, real tracking/exposure/broken cloak at101, blank restart fields, one canvas, no errors or production diagnostics. Evidence: previews/m2a-a3beb00/verification.json, pulse-planning.png, pulse-replay-101.png. M1 artifacts remain available. Formal M2A completed atc279edb with215unit/27browser after22/r1; this artifact predates the test-only22 additions and contains the accepted runtime sensors/UI.

Access requires the user's Tailnet or SSH forwarding; server-local reachability does not prove user access. This is a sensor drill, with a scripted patrol and weapons held; combat/reactive AI/outcomes remain later. No public deployment. Task ports: UI4272, Assistant4273, reviewer438x, combined4391; one Chromium worker and sequential browser jobs.

## Decisions, blockers and next actions

Approved mechanics and numerical tuning hypotheses remain unchanged. Accepted refinements: stable getView/subscribe, encounter/revision identity, own route preview, cursor-prefix-only replay, controller-owned presentation clock, replay origin without future outcome, tick-only events with deduplicated prefixes. Latest player turn plus automatic aftermath is replay scope. See contracts/README.md and handoffs/TSB-02-ui-decisions.md.

TSB-40 API connection failed mid-response around10:32UTC; no completed delivery claimed. Same original pane/session/assignment resumed after inspecting preserved untracked src/ai files at9f2e3d2. Same-session continuation completed deliveryb0e2b7a; no reset/model/session replacement or infrastructure changes.

Recovery at11:09UTC confirmed integrationc4fb6c7 clean; all retained builder/review worktrees clean except active41 edits. Original role/pane identities unchanged; no conflicting edits or duplicated assignments. AI integration build/typecheck/lint and288unit/33files PASS; durable logs under /home/jd/projects/tactical-space-battle-worktrees/handoffs/combined-c4fb6c7. Prior M2B browser result is preserved; no duplicate browser run is needed before41.

Next: collect41's exact delivery, independent review/corrections, integrate and verify the real AI duel; then42 complete-loop regressions, private preview and human-playtest checkpoint, followed by50/51/52 releasecandidate. Independent52A headless tooling is assigned alongside41 to supply reproducible evidence for51; final52B instructions/regressions wait for the full duel/polish. No current blocker/new approval needed. UI41 browser4272 slot granted, one Chromium worker; preview replacement deferred until the accepted full duel. Test-only real-engine/scripted-opponent pages remain excluded from production; shared guard/config changes require coordination. Original sessions/assignments preserved. Sole backlog DEVELOPMENT_PLAN.md.

State: IMPLEMENTED / REVIEWED / INTEGRATED M0,M1,M2A,M2B and headlessAI40. M2C active. READY_TO_MERGE no; DEPLOYED no. At the complete-duel checkpoint request human playtest feedback and keep it separate from technical completion. Do not add expansion features.

AI heuristic accepted: prefer laser intents within range+1cell and missiles farther out, without changing weapon legality/stats. All9simpleplayer scripts lost and no missile was selected in those9runs; unitmissilechoices verified, balance/human assessment remains51/M3, no enjoyment claim.
