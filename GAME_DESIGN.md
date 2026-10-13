# Tactical Space Battle — first playable design

Status: baseline and build plan approved by the user on 2026-10-12: "plan is aproved. All systems go." Implementation is authorised within the first-playable scope. Numerical values are initial tuning hypotheses.

## Requirements established by the brief

One browser encounter: Shadow-Dancer versus one Federation Patrol Frigate on an authored 20×20 battlefield. The experience centres on detection, prediction, positioning and concealment under limited energy and ammunition.

A brief mission introduction establishes the closing stage of the interstellar colonial war: the Federation controls the colonies, Earth remains free, and Shadow-Dancer must survive the patrol encounter. Convey this through the introduction, ship names and console; do not expand it into a campaign. Use developed vector ship silhouettes and layered combat effects; a substantial asset pipeline remains deferred.

WEGO is fixed: unlimited paused planning, simultaneous commitment, 10 seconds of execution in 100ms steps, assessment and observer-faithful replay. Include movement and heading, passive/active sensors, cloak, last-known contacts, lasers, travelling missiles, shields/hull, reactive fair AI, three destruction outcomes, same-seed restart and an abandon/restart action. Playback never changes combat.

Use TypeScript, React/Vite, PixiJS, Tailwind, Vitest and Playwright without a backend. Campaigns, accounts, multiplayer, microJBase, fleets, trading, teleportation, decoys, repairs, complex physics and LLM combat are excluded.

## Approved first-playable baseline

An order contains a destination or hold, passive sensing/one active pulse, desired cloak state, and hold fire/one laser attack/one plotted missile. A weapon intent discharges at most once in the turn, at its first eligible tick; otherwise it waits until the turn ends. It never carries an unspent shot into another turn. The active pulse attempts once on the first tick, then succeeds or reports insufficient energy; it never repeats automatically. New planning retains destination and actual cloak state, but resets the sensor order to passive and the weapon to hold fire.

Positions move continuously along deterministic eight-neighbour grid routes. Heading follows the route segment immediately; there are no turning delays or weapon arcs. Asteroids block movement, sensor sightlines, beams and missiles. No diagonal corner cutting. Ships may cross or overlap; there is no ramming or ship-based path obstruction. Unreached destinations remain selected for the next turn, and progress resumes on recommit unless changed to hold or a new destination.

Use fixed spawns at cells (3,10) and (16,10), zero-based. Twelve asteroid cells form four small clusters: (7,4), (7,5), (8,5); (12,5), (13,5), (13,6); (6,13), (7,13), (7,14); (12,13), (12,14), (13,14). The map is public; neither side starts with an enemy contact. Shadow-Dancer starts holding, passive and cloaked; the frigate starts passive and has no cloak equipment. The seed selects AI patrol ordering and tactical tie breaks, not a procedural map.

| Tunable value | Shadow-Dancer | Patrol Frigate |
| --- | ---: | ---: |
| Speed, cells/second | 1.0 | 0.8 |
| Hull / shields | 100 / 40 | 100 / 60 |
| Starting/max energy | 100 | 100 |
| Energy regeneration/second | 2 | 2 |
| Propulsion cost/second while moving | 1 | 1 |
| Cloak cost/second | 3 | Not equipped |
| One active pulse cost / tracking window | 12 / 2 seconds | 12 / 2 seconds |
| Laser cost / damage / range | 18 / 35 / 6 cells | Same |
| Laser cooldown | 5 seconds | Same |
| Missile cost / damage / ammunition | 10 / 45 / 6 | 10 / 45 / 4 |
| Missile speed / cooldown / lifetime | 2 cells/second / 10 seconds / 15 seconds | Same |

Shields absorb damage first; overflow damages hull. Neither shields nor hull regenerate. Values are initial tuning hypotheses, not evidence of balance.

Passive sensing refreshes each tick without energy cost. Uncloaked ship detection range is 7 cells; cloaked range is 3. A funded active pulse grants tracking for 2 seconds: ranges become 10 and 7 respectively, then sensing returns to passive. Movement adds 1 cell to these non-exposed ship thresholds; exposed ships instead have a 12-cell detection threshold in either mode. All sensing requires line of sight.

A successful scan or weapon discharge exposes the ship for 3 seconds and breaks cloak for the rest of the turn. Selecting cloak with a scan/attack is legal but must show this consequence before commit. Recloaking requires an explicit cloak order in a later planning phase; prior exposure can delay its actual activation. It never resumes in the firing/scanning turn merely because exposure expired. Failed cloak payment also disables it for that turn and reports the interruption. A failed unfunded scan/shot creates no activity exposure.

Current contacts contain measured position; estimated velocity comes only from previous measurements. Losing detection produces an explicitly stale position with age and a growing uncertainty radius based on public maximum speed. Memory expires after 60 simulated seconds. Never display exact enemy energy, damage, orders or an unseen destruction.

Lasers require a fresh contact at the firing tick. A remembered contact can be nominated, but the intent waits for reacquisition, range, line of sight, energy and cooldown. Missiles aim at an immutable plotted cell, without homing. They detonate on the first asteroid/opposing-ship collision or plotted arrival; blast radius is 0.75 cell, with line of sight required for splash damage. A missile damages each ship at most once; direct and splash damage do not stack on the struck ship. Splash can damage either ship. Map exit or lifetime expiry removes the missile without a blast. Missiles ignore their launcher for direct collision, are not intercepted, and persist after launcher's destruction.

Finalise an outcome only at a completed turn boundary with a destroyed ship and no live missiles. Either surviving ship can choose evasive WEGO orders while ordnance remains. After an observed opponent destruction, restrict that observer's new weapons to hold fire; an unseen destruction cannot change its available orders or announce a provisional result. If the player is destroyed, automatically advance normal turn windows while the surviving frigate plans from its own observation/memory. Destroyed ships issue no orders, and both destroyed drains ordnance without planners. Detailed timing and finite-ammunition bounds are in WEGO_SPEC.md.

## Presentation and opponent

Use a visually engaging military command console with the battlefield dominant. The UI Builder should apply its frontend-design skill when available. Solid measured contacts, dashed stale contacts with age/uncertainty, labelled planned paths, executed trails and distinct plotted targets must remain understandable without colour. Show phase, draft orders, conditional readiness, own resources, exposure/cloak, filtered events and deliberate Commit Turn. Provide keyboard destination/target entry alongside canvas interaction, visible focus, playback controls and reduced motion.

The user's 2026-10-13 playtest approved additional release requirements: confirmed outgoing hits and incoming shield/hull damage need clear battlefield effects, readable notices and prominent assessment summaries even after Skip; the game must support a full touch-only phone flow (390×844,360×800 and landscape) as well as1366×768; the visual presentation needs stronger ships, weapon/impact/scan effects and polish. Existing observed-impact/own-damage events supply the evidence: distinguish a discharge from an observed hit and an unconfirmed effect. Preserve observer boundaries and replay timestamps; richer presentation cannot invent enemy health, hidden origins or unseen motion. Human gameplay acceptance remains separate from automated verification.

The frigate uses PATROL → INVESTIGATE → ENGAGE → SEARCH after contact loss. It sometimes requests a single scan pulse, investigates remembered sightings, leads missiles using measured motion, and disengages or evades when resources/threats warrant. Its planner receives only its observation, memory and independent seeded tie-break input. It never sees player orders or replans during execution.

Optional later ideas: additional authored encounters and ship variants. They are not release acceptance criteria.
