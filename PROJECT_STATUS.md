# Project status — Tactical Space Battle

Canonical: /home/jd/projects/tactical-space-battle/PROJECT_STATUS.md. Sole writer: lead. DEVELOPMENT_PLAN.md is the sole backlog; GAME_DESIGN.md / WEGO_SPEC.md specify approved rules; ARCHITECTURE.md / AGENTS.md specify boundaries. Worktree copies may be stale.

## Authority and current milestone

The user approved automated implementation through M3's local release candidate on 2026-10-12: "plan is aproved. All systems go. Run automated as much as possible from now on". On 2026-10-13 the user added: "commit and push this we'll have a rest after 7 hours grinding". Commit and push of the reviewed tsb/integration release are authorised; default/release-branch merges and public deployment remain separate actions. Factory development is on the requested break.

Repository /home/jd/projects/tactical-space-battle, branch tsb/integration tracking origin/tsb/integration. Origin https://github.com/jdwd40/tactical-space-battle.git is a new private repository in the signed-in jdwd40 account (no matching game remote existed). Accepted integrated application source f34724a0f2e9ec2fb13e211851d66591b7507c6d; independent combined RC technical PASS. Release/status checkpoint49b5b9b followed. Authorised push of checkpoint455b73874852e6c584fb845c00e2b0ec5128e356 succeeded and git ls-remote confirmed the identical remote tip. This final rest record changes only status and will also be synchronised. Baseline c315b14409ce101fc5c296bc5e533ee91ca9bc7e.

M0 COMPLETE: approved rules/contracts, runnable scaffold, public initial scenario and reviewed console. Combined build/typecheck/lint, 57 unit tests and 7 Chromium tests passed at b71fe73. This was startup, not gameplay.

M1 COMPLETE: real headless movement engine, PixiJS plot, application controller and complementary lifecycle regressions REVIEWED and INTEGRATED. Combined 850d987 build/typecheck/lint, 166 unit tests / 21 files and 24 Chromium tests passed on 2026-10-13 (browser4391, one worker/no reuse). Plot/commit/genuine 100-tick movement/playback/assessment, complete-result playback independence and fresh restart with cleared acquired/lost contact history verified. Prior fbea50e combined163unit/23browser also passed and was recovered after interruption without duplication.

M2A COMPLETE atc279edb: sensors/stealth20, real UI21 and information regressions22 REVIEWED/INTEGRATED. Combined build/typecheck/lint,215unit/25files and27Chromium tests at4391 passed. Reviewer21 also verified production scan/replay/restart, keyboard/reduced motion and contact selection/expiry;22/r1 confirmed strict nested future-payload audit and negative controls. Reviewed sensor-code preview is available (artifact sourcea3beb00, runtime unchanged by22 test-only additions).

M2B COMPLETE at088a522: both weapons/resources, shield/hull damage, swept projectile/obstacle behavior, cross-turn/launcher-death persistence, simultaneous destruction and observer-safe outcomes. Tasks30A/30B/31/32 independently PASS and integrated. Combined build/typecheck/lint,274unit/31files and36Chromium tests passed at4391 with one worker/no reuse. Reviewer31 also checked the production interface and four real-engine automatic-aftermath/re-entrant restart/abandon probes.

M2C COMPLETE technically at f34724a: real-AI browser duel, survivor evasion/automatic aftermath, faithful replay and reproducible restart.40/41/42 PASS/integrated. Earlier8711 combined browser38PASS/1environmentfailure was traced to a lead Markdown edit triggering Vite reload; frozen focused rerun passed. Final f347 complete50-browser run passes without that environment failure.

M3 COMPLETE — local release candidate delivered at f34724a. User-required clear laser-hit/incoming-damage feedback, full phone playability and richer visuals implemented, independently reviewed and integrated.50/r0 found3Medium blockers (test port isolation, newer damage labels, offscreen phone combat), all fixed and round1 PASS.52B README round0 PASS; combinedRC independent technical PASS. Exact frozen candidate: build/typecheck/lint,332unit/40files,50Chromium tests PASS; one bounded diagnostic encounter and exact file replay PASS. Fresh independent production completed nine-turn seed17 missions on laptop and touch phone, through defeat/replay/restart. Actual private-origin laptop/phone checks PASS. Human gameplay/visual acceptance remains pending the requested retest, not claimed.

Acceptance delivered: all approved first-playable rules/features, real observer-safe engine/AI loop, deterministic tests and simultaneous/swept/persistent weapon regressions, usable keyboard/touch interface, faithful playback, all encounter outcomes, same-seed restart, runnable production artifact and verified instructions. No expansion tasks added.

## Confirmed factory mapping and recovery

Current workspace w7; preserve existing tab names and original sessions. Revalidated all panes and read their own completion/recovery reports on 2026-10-13 after model-capacity interruption. No new agents/sessions. Implementation checkouts clean; only the lead's canonical status edit was uncommitted. No conflicting work found.

| Role | Confirmed pane / tab | Original session | State |
| --- | --- | --- | --- |
| Lead | w7:p1 / Sol6.1M | 01a12cb2-14ea-7df1-9e72-3d26779d541c | Release checkpoint complete; awaiting human retest |
| General | w7:p8 / opusx builder | 09697ee9-8599-4a78-926d-23fd735b9c69 | Available;51 PASS/integrated; further exploration stopped |
| UI | w7:p5 / opus UI | a9360339-a6cf-46b7-8e1b-11e28d7e9ab1 | Available;50/2 round1 PASS/integrated, no active assignment |
| Assistant | w7:p9 / Codex Jnr | 01a1318b-b734-7c43-a314-4c5a78839c48 | Available;52B/1 PASS/integratedf34724a, no active assignment |
| Reviewer | w7:p7 / sol6.1h Review | 01a131d6-82cc-7160-aa30-8be514aebede | Available;52B/1 round0 andcombinedRC PASSf34724a; allbrowser ports freed |

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
| TSB-41 UI /1 | ui-41 / tsb/41-mission-flow / c4fb6c7477762e31ef47cb0d157158b10b9b0987 | 7f6aa01c33b08ad401e92a391a4476a97e1b8d1e round0 PASS; integrated8711dc7;291unit/34files/39browser/production independently PASS; one low clipboardfocus issue routed50 |
| TSB-42 Assistant /1 | assistant-42 / tsb/42-encounter-tests / 8711dc703c8d87db225906bb29ef6138c4b1db43 | Delivered00c744cbe632d6e08ac1403fff212506fecd60d5; round0 PASS; integrated13521ac;4focused/305fullunit,4browser and3independent aftermath probes PASS; actual ending/reset screenshots inspected |
| TSB-50 UI /1→2 | ui-50 / tsb/50-tactical-polish / original8711dc7; revisedbasef39013a734b3a1b074bf0cf6f0f2701af2d4ecdb | Final84778e98b19b54adc7be05d48da8d764d5a4ef0b round1 PASS; all3Medium findings resolved.328unit/29affectedbrowser4388 andindependentactualrenderer/freshproduction/threephones/bothmotionsettings PASS. Integrated9c3e257/c4bb48b/19bc604/90285a8. Required hit/damage cues/fulltouch/visuals retained; no engine/AI/rule/dependency/lifecycle changes |
| TSB-51 General /1 | general-51 / tsb/51-ai-balance / 4ffd1a287d00ac67c84cee4427a359d91f3f25c4 | 310983a8f5c6579372107a32c5bea009e7e4bb5b round0 PASS; integratedd162f8d/f39013a;311unit/36files and4independentprobes PASS; no rule-number changes |
| TSB-52A Assistant /1 | assistant-52a / tsb/52a-batch / 667b829fce9f012bba0db01b04f7545fdba78123 | 0fd7b15efc3ea8005f4b651b3a928e120194e03e round0 PASS; integrated559cd53/4ffd1a2;298unit/34files/tool/build/type/lint PASS;4independentautomatic/failure/replay probes PASS;20runs zero invalidity,20exactreplays |
| TSB-52B Assistant /1 | assistant-52b / tsb/52b-delivery / originalff51def; finalverificationbase90285a8 | Finalf34724a0f2e9ec2fb13e211851d66591b7507c6d README-only delta; round0/task andcombinedRC PASS, integrated exactf347 via authorized localfastforward.9links/8scripts/devproductionHTTP/assets checked; root332unit/50browser/build/type/lint plusfreshindependentproduction PASS |

Original assignments, reports and review verdicts: handoffs/. Exact detached snapshots: reviews/<task>-r<round>; Git worktree list records retained heads. TSB-11C report-a2/review-r1 documents the three corrected blockers: nested view immutability, re-entrant restart/abandon during commit, and blank grid fields after restart. No further review of that accepted change is pending.

Ownership: General simulation/AI/domain and sequenced scenario/contract amendments; Assistant root configuration/lockfile and scoped support; UI React/application/Pixi. Lead transfers obsolete src/ui/ScenarioStartup.tsx and its fixture-test adaptation to TSB-12B only. UI's import-boundary amendment is accepted: App/main compose the private game facade; UI/rendering/AI/public fixtures remain barred from authoritative state directly or through barrels. See AGENTS.md and handoffs/TSB-11C-decisions.md.

TSB-21 narrow scope clarification: application factory/index may expose whitelisted immutable system capability booleans for App to pass to console controls. No world/EngineApi payload or private game imports in UI/rendering, including type-only imports. No lifecycle redesign. See handoffs/TSB-21-scope.md; this is an implementation wiring choice, not a new mechanic.

## Verification and preview

Accepted source f34724a0f2e9ec2fb13e211851d66591b7507c6d. Exact frozen verification snapshot: /home/jd/projects/tactical-space-battle-worktrees/verification/f34724a. Combined npm ci --offline, build, typecheck, lint,332unit/40files and50Chromium tests PASS (4391,oneworker,no reuse). Durable commands/exitcodes/logs: handoffs/combined-f34724a/results.json. All browser checks used immutable served files includingMarkdown; canonical status stayed outside.

Requirements evidence includes input determinism, reversed simultaneous effects, observation-invariant AI, strict hidden/future replay audits and negative controls, energy/ammunition/cooldowns, swept geometry/obstacles/bounds, projectile and launcher-death persistence, survivor/automatic aftermath, all outcomes, duplicate commit/re-entrant restart and renderer cleanup. Current browser run covers complete realAI mission and same-page repeat with different playback, mobile fulltouch flow/threeviewports/scrolledCommit/keyboard/reducedmotion/labels/replay. Existing20-run headless stability and20exactreplays afterAI51 remain applicable; final exactf347 CLI smoke(seed17,pursuit-laser,limit20) and its saved replay both PASS in combined-f34724a/batch-smoke. Diagnostic cutoff is never a gameplay draw; win counts do not prove fun/balance.

Independent final verdict: handoffs/TSB-52B-review-r0.txt. Reviewer inspected root332unit/50browser evidence, rebuilt exactf347, verified matching application hashes and ran fresh production nine-turn seed17 laptop-keyboard and phone-touch missions through outcome/replay/restart. Hit101/rewind100, own destruction837/reveal900, cleanreset, insecureHTTPcopy/focus and production diagnostic/testpage stripping PASS. Screenshots and /tmp/tsb-review-52b-production.json copied into the preview artifact folder below.

Live private preview: http://100.109.154.60:5280/?seed=17 (Tailnet or SSH forwarding). Immutable production /home/jd/projects/tactical-space-battle-worktrees/previews/rc-f34724a/dist, SOURCE_REVISION=f34724a, task-owned PID1221769 in server.pid/server.log. Prior PID1129371 was verified against its exact command/owner and stopped; old m2c-8711 artifact and previous canonical generated build preserved. New server binds only100.109.154.60,HTTP200. Canonical /home/jd/projects/tactical-space-battle/dist exactly matches verified artifact (16files, build-files.sha256.json).

Actual private-origin verification.json PASS: laptop1366x768 and touch phone390x844, visible own/confirmed contact hits at101, rewind100 clears cues, assessment explains35shieldloss, phone scrolledCommit showsHUD/fullplot/Pause, same-seed reset/onecanvas/noerrors/globals, exact real-origin clipboard/focus. Useful images: private-laptop-exchange.png, private-phone-exchange.png, private-phone-assessment.png and independent tsb-review-52b-*.png in previews/rc-f34724a.

Running/install/check/reproduction instructions: README.md; mission/controls/combat interpretation/human checklist: PLAYTEST.md; bounded diagnostics: tools/batch/README.md. Chromium/emulated touch verified, physicaldevices/Safari/screenreader audit not claimed. Headless softwareWebGL retains some additional longframes; functional playback checks pass. Initial balance values and simpleAI remain hypotheses. Build chunk-size warning nonblocking. Public hosting/push/defaultmerge not performed.

## Decisions, blockers and next actions

Approved mechanics and numerical tuning hypotheses remain unchanged. Accepted refinements: stable getView/subscribe, encounter/revision identity, own route preview, cursor-prefix-only replay, controller-owned presentation clock, replay origin without future outcome, tick-only events with deduplicated prefixes. Latest player turn plus automatic aftermath is replay scope. See contracts/README.md and handoffs/TSB-02-ui-decisions.md.

TSB-40 API connection failed mid-response around10:32UTC; no completed delivery claimed. Same original pane/session/assignment resumed after inspecting preserved untracked src/ai files at9f2e3d2. Same-session continuation completed deliveryb0e2b7a; no reset/model/session replacement or infrastructure changes.

Recovery at11:09UTC confirmed integrationc4fb6c7 clean; all retained builder/review worktrees clean except active41 edits. Original role/pane identities unchanged; no conflicting edits or duplicated assignments. AI integration build/typecheck/lint and288unit/33files PASS; durable logs under /home/jd/projects/tactical-space-battle-worktrees/handoffs/combined-c4fb6c7. Prior M2B browser result is preserved; no duplicate browser run is needed before41.

Next action after the break: revalidate Git/Herdr states and collect the user retest of the updated preview (hit clarity, phoneportrait/landscape, visual appeal/device/browser). All assignments/reviews complete; no active builder work or pending technical reviews. No new build work during the break; private preview stays available. Route demonstrated defects to their existing owners under the same factory workflow. Push is now authorised; default/release-branch merge and public deployment require separate applicable permission.

State: IMPLEMENTED yes; REVIEWED yes; INTEGRATED yes (exactf347 source); PUSHED yes to private origin/tsb/integration, remote tip independently verified. RELEASE CANDIDATE ready for human acceptance. READY_TO_MERGE held pending human acceptance/applicable merge approval; no default/releasebranch merge. DEPLOYED no (private demonstration only). Factory on user-requested break; all workers idle, no pending reviews. Preview remains running at the established private address.

AI heuristic accepted: prefer laser intents within range+1cell and missiles farther out, without changing weapon legality/stats. All9simpleplayer scripts lost and no missile was selected in those9runs; unitmissilechoices verified, balance/human assessment remains51/M3, no enjoyment claim.

2026-10-13 human playtest: hit confirmations and incoming damage were unclear; mobile view broke; stronger visual presentation requested. Explicitly approved M3 requirements are recorded in GAME_DESIGN.md and TSB-50-human-feedback.md. Private preview access confirmed by feedback; human gameplay acceptance not granted.
51 operational deviation: exploratory400shortvariants/~35other runs exceeded the assigned budget. Stopped further exploration; independent review used4probes/6savedhashes and zero additional encounters. No rule changes or balance/fun claim.


2026-10-13 final checkpoint: f347 technical RC independently PASS; all332unit/50browser andrequired build checks green, private preview refreshed/actualoriginverified, source andproductionartifacts delivered. Human retest pending; no active assignments/pendingreviews.
