import { describe, expect, it } from 'vitest'
import type { MissileState, ShipState, SimulationState, TurnResolution } from '../contracts/private'
import type { Ruleset, Side, SideObservation, TurnOrders } from '../contracts/public'
import { DUEL_SCENARIO } from '../scenarios/private'
import { DUEL_MAP, DUEL_RULES } from '../scenarios/public'
import { aftermathWindowBound, createRuleset, DUEL_CONFIG } from '../scenarios/rules'
import { initialiseSession, observeSide, previewRoute, resolveTurn, validateOrders } from './index'
import { stepMissile, type ShipMotion } from './missiles'
import { resolveTurnInOrder } from './resolve'
import { lock, orders, withShip } from './testSupport'

// Reproducible inputs: seed 31, DUEL_SCENARIO (spawns (3,10) and (16,10)), orders built below.
// Defaults: missile 200 units/tick, cost 10,000, damage 45, blast 750, cooldown 100, lifetime 150.
const SEED = 31
const fire = (base: TurnOrders, column: number, row: number): TurnOrders => ({ ...base, weapon: { kind: 'missile', aim: { column, row } } })
const laser = (base: TurnOrders): TurnOrders => ({ ...base, weapon: { kind: 'laser', contactAlias: 'contact-1' } })
const uncloaked = { cloakRequested: false, cloakActive: false }

function placed(player: Partial<ShipState>, patrol: Partial<ShipState> = {}, rules: Ruleset = DUEL_RULES): SimulationState {
  return withShip(withShip(initialiseSession(DUEL_SCENARIO, rules, SEED), 'player', player), 'patrol', patrol)
}
/** Player uncloaked at (10,10), 6 cells from the patrol; after one hold turn both hold `contact-1`. */
function engaged(rules: Ruleset = DUEL_RULES): SimulationState {
  const s0 = placed({ position: { x: 10_500, y: 10_500 }, ...uncloaked }, {}, rules)
  return resolveTurn(s0, lock(s0, orders(0, null), orders(0, null)), rules, DUEL_SCENARIO).nextState
}
const run = (state: SimulationState, player: TurnOrders | null, patrol: TurnOrders | null, rules: Ruleset = DUEL_RULES, automatic = false) =>
  resolveTurn(state, { ...lock(state, player, patrol), automatic }, rules, DUEL_SCENARIO)
const frame = (result: TurnResolution, side: Side, tick: number): SideObservation => {
  const found = result.presentations[side].frames.find((candidate) => candidate.tick === tick)
  if (found === undefined) throw new Error(`no ${side} frame at ${tick}`)
  return found.observation
}
/** Event payloads without their per-side id/tick. */
const bodies = (observation: SideObservation) => observation.events.map((event) => {
  const body: Record<string, unknown> = { ...event }
  delete body.id
  delete body.tick
  return body
})
const kindsAt = (result: TurnResolution, side: Side, tick: number) => frame(result, side, tick).events.map((event) => event.kind)
const ends = (result: TurnResolution) => result.internalEvents.flatMap((event) => (event.kind === 'missile-resolved'
  ? [`${event.tick}:${event.missileId}:${event.reason}:${event.fraction}:${event.position.x},${event.position.y}${event.directVictimId === undefined ? '' : `:${event.directVictimId}`}`] : []))
const issueCodes = (state: SimulationState, side: Side, draft: TurnOrders, rules: Ruleset = DUEL_RULES) =>
  validateOrders(draft, observeSide(state, side, rules, DUEL_SCENARIO), rules).issues.map((issue) => `${issue.field}:${issue.severity}:${issue.code}`)

describe('plotted missile launch, travel and resources', () => {
  it('launches once at the first eligible tick, travels from the next tick and detonates harmlessly on arrival', () => {
    const s0 = initialiseSession(DUEL_SCENARIO, DUEL_RULES, SEED)
    const draft = fire(orders(0, null, true), 8, 10)
    expect(issueCodes(s0, 'player', draft)).toEqual(['cloak:warning:activity-breaks-cloak'])
    const result = run(s0, draft, orders(0, null))
    // 100,000 capped regen − 300 sustain − 10,000 launch; cooldown and exposure from tick 1.
    expect(frame(result, 'player', 1).ownShip).toMatchObject({
      energy: { currentMilli: 89_700 }, ammunition: { current: 5, max: 6 }, cloak: { state: 'latched-activity' },
      clocks: { missileReadyTick: 101, exposureUntilTick: 31 }, turnActions: { weaponIntentSpent: true },
    })
    const launched = { id: 'player-missile-1', position: { x: 3500, y: 10_500 }, aim: { column: 8, row: 10 }, launchTick: 1, updatedTick: 1, status: 'flying' }
    expect(bodies(frame(result, 'player', 1))).toEqual([
      { kind: 'own-shot', position: { x: 3500, y: 10_500 }, weapon: { kind: 'missile', aim: { column: 8, row: 10 } } },
      { kind: 'own-energy', deltaMilli: -10_000, reason: 'missile' },
      { kind: 'own-ammunition', delta: -1 },
      { kind: 'own-missile', missile: launched },
      { kind: 'own-cloak', cloak: { requested: true, actual: false, state: 'latched-activity' } },
    ])
    expect(frame(result, 'player', 1).ownMissiles).toEqual([launched])
    expect(frame(result, 'player', 2).ownMissiles[0].position).toEqual({ x: 3700, y: 10_500 })
    expect(frame(result, 'player', 25).ownMissiles[0]).toMatchObject({ position: { x: 8300, y: 10_500 }, status: 'flying' })
    // 5,000 units at 200/tick: arrival at the end of tick 26.
    expect(ends(result)).toEqual(['26:player-missile-1:arrival:1:8500,10500'])
    expect(bodies(frame(result, 'player', 26))).toEqual([
      { kind: 'observed-impact', position: { x: 8500, y: 10_500 }, weapon: 'missile' },
      { kind: 'own-missile', missile: { ...launched, position: { x: 8500, y: 10_500 }, updatedTick: 26, status: 'detonated' } },
    ])
    expect(result.internalEvents.filter((event) => event.kind === 'shot')).toHaveLength(1)
    expect(result.presentations.player.assessment).toMatchObject({ weaponAttempt: { kind: 'fired', tick: 1, weapon: 'missile' }, deltas: { ammunition: -1 }, ordnancePending: null })
    expect(result.nextState.missiles).toEqual([])
    // Thirteen cells away, the patrol learns nothing: no shot, track, aim or launcher identity.
    expect(result.presentations.patrol.assessment.events).toEqual([])
    expect(JSON.stringify(result.presentations.patrol)).not.toMatch(/"aim"|player-missile|launcher/)
  })

  it('waits for energy after higher-priority grants and for an absolute cooldown that carries across turns', () => {
    // Moving uncloaked: 9,899 + 200 − 100 = 9,999 on tick 1, then 10,099 on tick 2.
    const low = placed({ energyMilli: 9899, ...uncloaked })
    const draft = fire(orders(0, { column: 4, row: 10 }), 9, 10)
    expect(validateOrders(draft, observeSide(low, 'player', DUEL_RULES, DUEL_SCENARIO), DUEL_RULES).issues)
      .toEqual([{ field: 'weapon', severity: 'conditional', code: 'awaiting-energy', details: { requiredEnergyMilli: 10_000, availableEnergyMilli: 9999 } }])
    const waited = run(low, draft, orders(0, null))
    expect(frame(waited, 'player', 1).ownShip.energy.currentMilli).toBe(9999)
    expect(frame(waited, 'player', 2).ownShip).toMatchObject({ energy: { currentMilli: 99 }, ammunition: { current: 5 } })
    expect(waited.presentations.player.assessment.weaponAttempt).toEqual({ kind: 'fired', tick: 2, weapon: 'missile' })
    // A tick-50 launch is ready again at tick 150: the next turn waits, then launches late in it.
    const late = run(placed({ missileReadyTick: 50, ...uncloaked }), fire(orders(0, null), 9, 10), orders(0, null))
    expect(late.presentations.player.assessment.weaponAttempt).toEqual({ kind: 'fired', tick: 50, weapon: 'missile' })
    const s1 = late.nextState
    expect(validateOrders(fire(orders(1, null), 9, 10), observeSide(s1, 'player', DUEL_RULES, DUEL_SCENARIO), DUEL_RULES).issues)
      .toEqual([{ field: 'weapon', severity: 'conditional', code: 'awaiting-cooldown', details: { readyTick: 150 } }])
    const next = run(s1, fire(orders(1, null), 19, 10), orders(1, null))
    expect(next.presentations.player.assessment.weaponAttempt).toEqual({ kind: 'fired', tick: 150, weapon: 'missile' })
    // Launched at 150 toward (19,10): still flying at the boundary and carried into the next turn.
    expect(next.nextState.missiles).toEqual([expect.objectContaining({ id: 'player-missile-2', launchTick: 150, expiresAtTick: 300, distanceTravelledUnits: 10_000 })])
    // The holding patrol at (16,10) lies on that path: struck after 12,650 units, in the following turn.
    const carried = run(next.nextState, orders(2, null), orders(2, null))
    expect(ends(carried)).toEqual(['214:player-missile-2:ship:0.25:16150,10500:patrol-ship'])
  })

  it('never launches with an empty magazine or outside the map, and never goes negative', () => {
    const last = placed({ ammunition: 1, ...uncloaked })
    const result = run(last, fire(orders(0, null), 9, 10), orders(0, null))
    expect(result.nextState.ships.player.ammunition).toBe(0)
    expect(issueCodes(result.nextState, 'player', fire(orders(1, null), 9, 10))).toEqual(['weapon:error:no-ammunition'])
    expect(() => run(result.nextState, fire(orders(1, null), 9, 10), orders(1, null))).toThrow('weapon:no-ammunition')
    expect(issueCodes(last, 'player', fire(orders(0, null), 20, 10))).toEqual(['weapon:error:out-of-bounds'])
  })
})

describe('swept impacts, ties and splash', () => {
  it('hits a holding ship at the exact swept contact point and damages it once; the target tracks the hostile missile', () => {
    const s0 = placed({ position: { x: 10_500, y: 10_500 }, ...uncloaked })
    const result = run(s0, fire(orders(0, null), 16, 10), orders(0, null))
    // Contact at 350 units (missile 100 + ship 250): x = 16,150, a quarter into tick 30.
    expect(ends(result)).toEqual(['30:player-missile-1:ship:0.25:16150,10500:patrol-ship'])
    expect(frame(result, 'patrol', 30).ownShip.shields.current).toBe(15)
    expect(kindsAt(result, 'patrol', 1)).toEqual(['contact-acquired', 'hostile-missile-sighted', 'observed-shot'])
    expect(bodies(frame(result, 'patrol', 1)).slice(1)).toEqual([
      { kind: 'hostile-missile-sighted', missile: { alias: 'missile-1', kind: 'current', ageTicks: 0, uncertaintyRadiusUnits: 0, measurement: { position: { x: 10_500, y: 10_500 }, tick: 1 } } },
      { kind: 'observed-shot', sourceAlias: 'contact-1', position: { x: 10_500, y: 10_500 }, weapon: 'missile' },
    ])
    expect(frame(result, 'patrol', 29).hostileMissiles).toEqual([{ alias: 'missile-1', kind: 'current', ageTicks: 0, uncertaintyRadiusUnits: 0, measurement: { position: { x: 16_100, y: 10_500 }, tick: 29 } }])
    expect(bodies(frame(result, 'patrol', 30))).toEqual([
      { kind: 'hostile-missile-expired', alias: 'missile-1' }, { kind: 'own-damage', shieldsLost: 45, hullLost: 0 },
    ])
    expect(frame(result, 'patrol', 30).hostileMissiles).toEqual([])
    expect(bodies(frame(result, 'player', 30))[0])
      .toEqual({ kind: 'observed-impact', position: { x: 16_150, y: 10_500 }, weapon: 'missile', contactAlias: 'contact-1' })
    expect(JSON.stringify(result.presentations.patrol)).not.toMatch(/"aim"|player-missile|launcher/)
  })

  it('sweeps relative to a moving target, and a plotted missile misses a ship that left its cell', () => {
    // Patrol drives west at 80/tick into a missile from x = 10,610: 490 apart at the start of tick 21,
    // closing at 280/tick, so contact (350) is exactly half-way through the tick, not at either endpoint.
    const closing = run(placed({ position: { x: 10_610, y: 10_500 }, ...uncloaked }), fire(orders(0, null), 16, 10), orders(0, { column: 10, row: 10 }))
    expect(ends(closing)).toEqual(['21:player-missile-1:ship:0.5:14510,10500:patrol-ship'])
    expect(frame(closing, 'patrol', 21).ownShip.position).toEqual({ x: 16_500 - 21 * 80, y: 10_500 })
    // Evasion: the patrol heads north; the stale aim point is reached with nobody inside the blast.
    const evaded = run(placed({ position: { x: 10_500, y: 10_500 }, ...uncloaked }), fire(orders(0, null), 16, 10), orders(0, { column: 16, row: 3 }))
    expect(ends(evaded)).toEqual(['31:player-missile-1:arrival:1:16500,10500'])
    expect(evaded.presentations.patrol.assessment.deltas).toMatchObject({ shields: 0, hull: 0 })
  })

  it('catches a crossing that both tick endpoints miss (fast-missile ruleset)', () => {
    const fast = createRuleset({ ...DUEL_CONFIG, version: 'fast-missile', missile: { ...DUEL_CONFIG.missile, speedUnitsPerSecond: 10_000 } })
    // 1,000 units/tick: tick 10 runs x 11,500 → 12,500, both 500 from a ship at x 12,000.
    const result = run(placed({}, { position: { x: 12_000, y: 10_500 } }, fast), fire(orders(0, null, true), 19, 10), orders(0, null), fast)
    expect(ends(result)).toEqual(['10:player-missile-1:ship:0.15:11650,10500:patrol-ship'])
  })

  it('stops at the swept asteroid face; arrival/expiry tie favours arrival; expiry is harmless', () => {
    const rock = run(placed({ position: { x: 3500, y: 4500 }, ...uncloaked }), fire(orders(0, null), 10, 4), orders(0, null))
    // Asteroid (7,4) starts at x 7,000; the 100-unit missile circle touches it at x 6,900, end of tick 18.
    expect(ends(rock)).toEqual(['18:player-missile-1:asteroid:1:6900,4500'])
    const brief = createRuleset({ ...DUEL_CONFIG, version: 'brief-missile', timing: { ...DUEL_CONFIG.timing, missileLifetimeMs: 1000 } })
    // Launch tick 1, expires at the end of tick 11 after 2,000 units of travel.
    const tied = run(placed(uncloaked, {}, brief), fire(orders(0, null), 5, 10), orders(0, null), brief)
    expect(ends(tied)).toEqual(['11:player-missile-1:arrival:1:5500,10500'])
    const expired = run(placed(uncloaked, { position: { x: 5500, y: 10_900 } }, brief), fire(orders(0, null), 6, 10), orders(0, null), brief)
    expect(ends(expired)).toEqual(['11:player-missile-1:expiry:1:5500,10500'])
    expect(expired.presentations.patrol.assessment.deltas).toMatchObject({ shields: 0, hull: 0 })
    expect(frame(expired, 'player', 11).ownMissiles[0]).toMatchObject({ status: 'expired', position: { x: 5500, y: 10_500 } })
  })

  it('splashes the launcher and the opponent once each (friendly fire allowed, launcher never struck directly)', () => {
    // Aimed at its own cell: zero-length path, arrival at fraction 0 of tick 2; the patrol is 600 away.
    const result = run(placed(uncloaked, { position: { x: 4100, y: 10_500 } }), fire(orders(0, null), 3, 10), orders(0, null))
    expect(ends(result)).toEqual(['2:player-missile-1:arrival:0:3500,10500'])
    expect(frame(result, 'player', 2).events.find((event) => event.kind === 'own-damage')).toMatchObject({ shieldsLost: 40, hullLost: 5 })
    expect(frame(result, 'patrol', 2).events.find((event) => event.kind === 'own-damage')).toMatchObject({ shieldsLost: 45, hullLost: 0 })
  })

  it('breaks exact ties asteroid → ship → arrival and requires line of sight for splash (unit sweeps)', () => {
    const missile = (patch: Partial<MissileState>): MissileState => ({
      id: 'player-missile-1', launcherEntityId: 'player-ship', launcherSide: 'player', aim: { column: 10, row: 4 },
      launchPosition: { x: 3500, y: 4100 }, aimPosition: { x: 10_500, y: 4100 }, position: { x: 6700, y: 4100 },
      distanceTravelledUnits: 3200, launchTick: 1, expiresAtTick: 151, ...patch,
    })
    const still = (entityId: string, side: Side, x: number, y: number): ShipMotion => ({ entityId, side, start: { x, y }, end: { x, y } })
    // Rock face at x 6,900 and a ship 350 above the same point: equal fractions, asteroid wins, ship splashed.
    const tie = stepMissile(missile({}), [still('patrol-ship', 'patrol', 6900, 3750)], 18, DUEL_RULES, DUEL_MAP).resolution
    expect(tie).toMatchObject({ reason: 'asteroid', fraction: 1, point: { x: 6900, y: 4100 }, victimIds: ['patrol-ship'] })
    expect(tie?.directVictimId).toBeUndefined()
    // Around the (7000,4000) corner the sightline is blocked; the launcher's clear position is splashed.
    const blocked = stepMissile(missile({}), [still('player-ship', 'player', 6600, 3600), still('patrol-ship', 'patrol', 7300, 3750)], 18, DUEL_RULES, DUEL_MAP).resolution
    expect(blocked).toMatchObject({ reason: 'asteroid', victimIds: ['player-ship'] })
    // Ship contact exactly at the plotted arrival point beats arrival.
    const arriving = missile({ launchPosition: { x: 3500, y: 10_500 }, aimPosition: { x: 10_500, y: 10_500 }, aim: { column: 10, row: 10 }, position: { x: 10_300, y: 10_500 }, distanceTravelledUnits: 6800 })
    expect(stepMissile(arriving, [still('patrol-ship', 'patrol', 10_850, 10_500)], 36, DUEL_RULES, DUEL_MAP).resolution)
      .toMatchObject({ reason: 'ship', fraction: 1, directVictimId: 'patrol-ship', victimIds: ['patrol-ship'] })
    expect(stepMissile(arriving, [still('player-ship', 'player', 10_850, 10_500)], 36, DUEL_RULES, DUEL_MAP).resolution)
      .toMatchObject({ reason: 'arrival', victimIds: ['player-ship'] })
  })
})

describe('simultaneous batches, persistence and boundary endings', () => {
  it('batches a missile impact with a same-tick laser: both lethal, order-independent, mutual destruction', () => {
    const s1 = withShip(withShip(engaged(), 'player', { shields: 0, hull: 35 }), 'patrol', { shields: 0, hull: 45, laserReadyTick: 130 })
    const turn = lock(s1, fire(orders(1, null), 16, 10), laser(orders(1, null)))
    const before = JSON.stringify(s1)
    const result = resolveTurn(s1, turn, DUEL_RULES, DUEL_SCENARIO)
    expect(JSON.stringify(resolveTurnInOrder(s1, turn, DUEL_RULES, DUEL_SCENARIO, ['patrol', 'player']))).toBe(JSON.stringify(result))
    expect(resolveTurn(s1, turn, DUEL_RULES, DUEL_SCENARIO)).toEqual(result)
    expect(JSON.stringify(s1)).toBe(before)
    expect(ends(result)).toEqual(['130:player-missile-1:ship:0.25:16150,10500:patrol-ship'])
    expect(result.internalEvents.filter((event) => event.kind === 'damage' || event.kind === 'destruction').map((event) => `${event.tick}:${event.kind}`))
      .toEqual(['130:damage', '130:destruction', '130:damage', '130:destruction'])
    expect(result.presentations.patrol.assessment.weaponAttempt).toEqual({ kind: 'fired', tick: 130, weapon: 'laser' })
    expect(result.nextState).toMatchObject({ outcome: { outcome: 'mutual-destruction', revealTick: 200 }, terminalPending: false, missiles: [] })
  })

  it('keeps a dead launcher\'s missile across the boundary; the observer may only evade until it resolves (victory)', () => {
    // Patrol launches at the player's cell at tick 195; the player's laser kills it at 196.
    const s1 = withShip(withShip(engaged(), 'player', { laserReadyTick: 196 }), 'patrol', { shields: 0, hull: 30, missileReadyTick: 195 })
    const turn1 = run(s1, laser(orders(1, null)), fire(orders(1, null), 10, 10))
    const s2 = turn1.nextState
    expect(s2).toMatchObject({ outcome: null, terminalPending: true, missiles: [expect.objectContaining({ id: 'patrol-missile-1', launcherSide: 'patrol' })] })
    expect(s2.ships.patrol.alive).toBe(false)
    expect(turn1.presentations.player.assessment.ordnancePending).toEqual({ reason: 'observed-opponent-destroyed' })
    expect(turn1.presentations.patrol.assessment.ordnancePending).toEqual({ reason: 'known-own-missiles', missileIds: ['patrol-missile-1'] })
    expect(frame(turn1, 'player', 200).hostileMissiles).toEqual([expect.objectContaining({ alias: 'missile-1', kind: 'current' })])
    expect(issueCodes(s2, 'player', laser(orders(2, null)))).toEqual(['weapon:error:observed-opponent-destroyed'])
    expect(issueCodes(s2, 'player', fire(orders(2, null), 16, 10))).toEqual(['weapon:error:observed-opponent-destroyed'])
    expect(() => run(s2, orders(2, null), null, DUEL_RULES, true)).toThrow('automatic exactly while')
    expect(() => run(s2, orders(2, null), orders(2, null))).toThrow('Destroyed patrol ship cannot receive orders')
    const evaded = run(s2, orders(2, { column: 10, row: 13 }), null)
    expect(ends(evaded)).toEqual(['225:patrol-missile-1:arrival:1:10500,10500'])
    expect(evaded.presentations.player.assessment.deltas).toMatchObject({ shields: 0, hull: 0 })
    expect(kindsAt(evaded, 'player', 225)).toEqual(['hostile-missile-expired', 'observed-impact'])
    expect(evaded.nextState.outcome).toEqual({ outcome: 'victory', revealTick: 300 })
    const held = run(s2, orders(2, null), null)
    expect(ends(held)).toEqual(['224:patrol-missile-1:ship:0.25:10850,10500:player-ship'])
    expect(frame(held, 'player', 224).events.find((event) => event.kind === 'own-damage')).toMatchObject({ shieldsLost: 40, hullLost: 5 })
    expect(held.nextState.outcome).toEqual({ outcome: 'victory', revealTick: 300 })
  })

  it('runs automatic windows while the player is dead; the survivor still plans; outcome after drainage within the bound', () => {
    const s1 = withShip(withShip(engaged(), 'player', { shields: 0, hull: 30, missileReadyTick: 190 }), 'patrol', { laserReadyTick: 195 })
    const turn1 = run(s1, fire(orders(1, null), 16, 10), laser(orders(1, null)))
    const s2 = turn1.nextState
    expect(s2).toMatchObject({ outcome: null, terminalPending: true })
    expect(s2.ships.player).toMatchObject({ alive: false, destructionTick: 195 })
    expect(turn1.presentations.player.assessment.ordnancePending).toEqual({ reason: 'known-own-missiles', missileIds: ['player-missile-1'] })
    expect(turn1.presentations.patrol.assessment.ordnancePending).toEqual({ reason: 'observed-opponent-destroyed' })
    expect(() => run(s2, null, orders(2, null))).toThrow('automatic exactly while')
    expect(() => run(s2, orders(2, null), orders(2, null), DUEL_RULES, true)).toThrow('Destroyed player ship cannot receive orders')
    expect(() => run(s2, null, laser(orders(2, null)), DUEL_RULES, true)).toThrow('weapon:observed-opponent-destroyed')
    let windows = 0
    let state = s2
    let last: TurnResolution | null = null
    while (state.outcome === null) {
      last = run(state, null, orders(state.turnIndex, null), DUEL_RULES, true)
      windows += 1
      state = last.nextState
    }
    expect(windows).toBe(1)
    expect(windows).toBeLessThanOrEqual(aftermathWindowBound(DUEL_RULES, state.ships.patrol.ammunition))
    if (last === null) throw new Error('window expected')
    expect(last.presentations.player.automatic).toBe(true)
    expect(ends(last)).toEqual(['219:player-missile-1:ship:0.25:16150,10500:patrol-ship'])
    // The dead launcher keeps own telemetry but makes no new observations.
    expect(kindsAt(last, 'player', 219)).toEqual(['own-missile'])
    expect(frame(last, 'player', 219).contacts[0]).toMatchObject({ kind: 'stale', measurement: { tick: 195 } })
    expect(state.outcome).toEqual({ outcome: 'defeat', revealTick: 300 })
  })

  it('drains ordnance with no orders when both ships are dead, then classifies mutual destruction (1 s turns)', () => {
    const rules = createRuleset({ ...DUEL_CONFIG, version: 'short-turns', timing: { ...DUEL_CONFIG.timing, turnMs: 1000 } })
    // Turn 0: the player launches north toward (10,0) at tick 1 (10,000 units, arrival tick 51).
    const s0 = placed({ position: { x: 10_500, y: 10_500 }, ...uncloaked, shields: 0, hull: 35 }, { shields: 0, hull: 35 }, rules)
    const s1 = run(s0, fire(orders(0, null), 10, 0), orders(0, null), rules).nextState
    const s2 = run(s1, laser(orders(1, null)), laser(orders(1, null)), rules).nextState
    expect(s2).toMatchObject({ outcome: null, terminalPending: true, ships: { player: { alive: false }, patrol: { alive: false } } })
    let state = s2
    let windows = 0
    while (state.outcome === null) {
      state = run(state, null, null, rules, true).nextState
      windows += 1
    }
    expect(windows).toBe(4)
    expect(windows).toBeLessThanOrEqual(aftermathWindowBound(rules, 0))
    expect(state.outcome).toEqual({ outcome: 'mutual-destruction', revealTick: 60 })
  })
})

describe('observer information boundaries for ordnance', () => {
  it('ages a lost hostile missile, keeps it through an unseen detonation and ends it only at the public lifetime bound', () => {
    // Player at (10,10); the patrol launches away toward (19,0) at tick 1 and the missile leaves passive range.
    const s0 = placed({ position: { x: 10_500, y: 10_500 }, ...uncloaked })
    const turn0 = run(s0, orders(0, null), fire(orders(0, null), 19, 0))
    const lostAt = turn0.presentations.player.frames.find((f) => f.observation.hostileMissiles[0]?.kind === 'stale')?.tick ?? -1
    expect(lostAt).toBe(13)
    expect(frame(turn0, 'player', 13).hostileMissiles).toEqual([expect.objectContaining({ alias: 'missile-1', kind: 'stale', ageTicks: 1, uncertaintyRadiusUnits: 200, measurement: expect.objectContaining({ tick: 12 }) })])
    expect(kindsAt(turn0, 'player', 13)).toEqual(['hostile-missile-lost'])
    expect(ends(turn0)).toEqual([expect.stringMatching(/^54:patrol-missile-1:arrival:/)])
    expect(frame(turn0, 'player', 100).hostileMissiles[0]).toMatchObject({ kind: 'stale', ageTicks: 88 })
    expect(JSON.stringify(turn0.presentations.player)).not.toMatch(/"aim"|patrol-missile|launcher/)
    const turn1 = run(turn0.nextState, orders(1, null), orders(1, null))
    expect(frame(turn1, 'player', 161).hostileMissiles).toHaveLength(1)
    expect(frame(turn1, 'player', 162).hostileMissiles).toEqual([])
    expect(kindsAt(turn1, 'player', 162)).toEqual(['hostile-missile-expired'])
  })

  it('makes an unseen enemy death invisible: identical player frames, events, assessment, validation and preview', () => {
    // Blind launch at the patrol's cell from 13 cells away; the patrol has launched at (19,0) at tick 60.
    const draft = fire(orders(0, null, true), 16, 10)
    const patrol = fire(orders(0, null), 19, 0)
    const fragile = run(placed({}, { shields: 0, hull: 45, missileReadyTick: 60 }), draft, patrol)
    const sturdy = run(placed({}, { missileReadyTick: 60 }), draft, patrol)
    expect(ends(fragile)).toEqual(['65:player-missile-1:ship:0.25:16150,10500:patrol-ship'])
    expect(fragile.nextState).toMatchObject({ outcome: null, terminalPending: true })
    expect(fragile.nextState.ships.patrol.alive).toBe(false)
    expect(sturdy.nextState).toMatchObject({ outcome: null, terminalPending: false })
    expect(fragile.presentations.player).toEqual(sturdy.presentations.player)
    const view = observeSide(fragile.nextState, 'player', DUEL_RULES, DUEL_SCENARIO)
    expect(view).toEqual(observeSide(sturdy.nextState, 'player', DUEL_RULES, DUEL_SCENARIO))
    expect(view.observedOpponentDestructionTick).toBeUndefined()
    const blind = fire(orders(1, { column: 5, row: 10 }, true), 16, 9)
    expect(validateOrders(blind, view, DUEL_RULES)).toEqual(validateOrders(blind, observeSide(sturdy.nextState, 'player', DUEL_RULES, DUEL_SCENARIO), DUEL_RULES))
    expect(validateOrders(blind, view, DUEL_RULES).structurallyValid).toBe(true)
    expect(previewRoute(blind.movement, view.ownShip, view.map, DUEL_RULES)).toEqual(previewRoute(blind.movement, observeSide(sturdy.nextState, 'player', DUEL_RULES, DUEL_SCENARIO).ownShip, view.map, DUEL_RULES))
    // The dead patrol's missile still flies; the next normal player turn ends at its boundary.
    const turn1 = run(fragile.nextState, blind, null)
    expect(ends(turn1)).toEqual([expect.stringMatching(/^1\d\d:patrol-missile-1:arrival:/), expect.stringMatching(/^1\d\d:player-missile-2:/)])
    expect(turn1.presentations.player.frames.filter((f) => f.tick < 200).every((f) => f.observation.outcome === undefined)).toBe(true)
    expect(turn1.nextState.outcome).toEqual({ outcome: 'victory', revealTick: 200 })
  })
})
