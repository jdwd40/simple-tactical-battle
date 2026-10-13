import { describe, expect, it } from 'vitest'
import type { SimulationState, TurnResolution } from '../contracts/private'
import type { Ruleset, Side, SideObservation, TurnOrders } from '../contracts/public'
import { DUEL_SCENARIO } from '../scenarios/private'
import { DUEL_MAP, DUEL_RULES } from '../scenarios/public'
import { createRuleset, DUEL_CONFIG } from '../scenarios/rules'
import { ENGINE_CAPABILITIES, initialiseSession, observeSide, previewRoute, resolveTurn, validateOrders } from './index'
import { resolveTurnInOrder } from './resolve'
import { lock, orders, withShip } from './testSupport'
import { applyDamage, proposeLaser } from './weapons'

// Reproducible inputs: seed 30, DUEL_SCENARIO; the player is placed at cell (10,10), exactly the
// 6-cell laser range west of the patrol spawn (16,10), on the asteroid-free row y = 10,500.
const SEED = 30
const PLAYER_AT = { x: 10_500, y: 10_500 }
const HIDDEN_KEYS = ['entityId', 'targetEntityId', 'sourceIds', 'cloakLatch', 'cloakActive', 'orders', 'seed', 'random', 'internalEvents']

const laser = (base: TurnOrders, contactAlias = 'contact-1'): TurnOrders => ({ ...base, weapon: { kind: 'laser', contactAlias } })
/** Turn 0 with the given orders from the placed start; returns the state at its boundary, contacts in memory. */
function engaged(player: TurnOrders, patrol: TurnOrders = orders(0, null), rules: Ruleset = DUEL_RULES): SimulationState {
  const s0 = withShip(initialiseSession(DUEL_SCENARIO, rules, SEED), 'player', { position: PLAYER_AT, cloakRequested: player.cloak, cloakActive: player.cloak })
  return resolveTurn(s0, lock(s0, player, patrol), rules, DUEL_SCENARIO).nextState
}
const frame = (result: TurnResolution, side: Side, tick: number): SideObservation => {
  const found = result.presentations[side].frames.find((candidate) => candidate.tick === tick)
  if (found === undefined) throw new Error(`no ${side} frame at ${tick}`)
  return found.observation
}
const kindsAt = (result: TurnResolution, side: Side, tick: number) => frame(result, side, tick).events.map((event) => event.kind)
const issueCodes = (state: SimulationState, side: Side, draft: TurnOrders, rules: Ruleset = DUEL_RULES) =>
  validateOrders(draft, observeSide(state, side, rules, DUEL_SCENARIO), rules).issues.map((issue) => `${issue.field}:${issue.severity}:${issue.code}`)
/** The player pulsed in turn 0 (seen while exposed and latched), then held cloaked: the patrol's memory is stale at tick 200. */
function hiddenShooter(): SimulationState {
  const s1 = engaged(orders(0, null, true, 'activePulse'))
  return resolveTurn(s1, lock(s1, orders(1, null, true), orders(1, null)), DUEL_RULES, DUEL_SCENARIO).nextState
}
const shots = (result: TurnResolution) => result.internalEvents.filter((event) => event.kind === 'shot').map((event) => `${event.tick}:${event.entityId}`)

describe('conditional once-only laser', () => {
  it('fires once at the first eligible tick with cost, cooldown, exposure and cloak latch; the emission reveals the shooter', () => {
    const s1 = engaged(orders(0, null, true))
    expect(ENGINE_CAPABILITIES).toEqual({ activePulse: true, laser: true, missile: true })
    expect(s1.ships.player.energyMilli).toBe(89_800)
    const draft = laser(orders(1, null, true))
    expect(issueCodes(s1, 'player', draft)).toEqual(['cloak:warning:activity-breaks-cloak'])
    const result = resolveTurn(s1, lock(s1, draft, orders(1, null)), DUEL_RULES, DUEL_SCENARIO)
    // 89,800 + 200 regen − 300 sustain (not refunded) − 18,000 laser.
    expect(frame(result, 'player', 101).ownShip).toMatchObject({
      energy: { currentMilli: 71_700 }, cloak: { requested: true, actual: false, state: 'latched-activity' },
      clocks: { laserReadyTick: 151, exposureUntilTick: 131 }, turnActions: { weaponIntentSpent: true },
    })
    expect(frame(result, 'player', 101).events).toEqual([
      { id: 't101-000', tick: 101, kind: 'own-shot', position: PLAYER_AT, weapon: { kind: 'laser', contactAlias: 'contact-1' } },
      { id: 't101-001', tick: 101, kind: 'own-energy', deltaMilli: -18_000, reason: 'laser' },
      { id: 't101-002', tick: 101, kind: 'own-cloak', cloak: { requested: true, actual: false, state: 'latched-activity' } },
      { id: 't101-003', tick: 101, kind: 'observed-impact', position: { x: 16_500, y: 10_500 }, weapon: 'laser', contactAlias: 'contact-1' },
    ])
    // The cloaked shooter was invisible pre-fire; its exposure is sensed post-fire in the same tick.
    expect(frame(result, 'patrol', 100).contacts).toEqual([])
    expect(frame(result, 'patrol', 101).events.map(({ kind }) => kind)).toEqual(['contact-acquired', 'observed-shot', 'own-damage'])
    expect(frame(result, 'patrol', 101).events.slice(1)).toEqual([
      { id: 't101-001', tick: 101, kind: 'observed-shot', sourceAlias: 'contact-1', position: PLAYER_AT, weapon: 'laser' },
      { id: 't101-002', tick: 101, kind: 'own-damage', shieldsLost: 35, hullLost: 0 },
    ])
    expect(frame(result, 'patrol', 101).ownShip.shields).toEqual({ current: 25, max: 60 })
    // Still eligible for 99 more ticks, but the intent is spent: one shot only.
    expect(shots(result)).toEqual(['101:player-ship'])
    expect(result.presentations.player.assessment.weaponAttempt).toEqual({ kind: 'fired', tick: 101, weapon: 'laser' })
    expect(result.presentations.patrol.assessment.weaponAttempt).toEqual({ kind: 'not-requested' })
    expect(result.presentations.patrol.assessment.deltas).toMatchObject({ shields: -35, hull: 0 })
    // The shooter learns of an impact, never the enemy's damage or health.
    expect(JSON.stringify(result.presentations.player)).not.toMatch(/shieldsLost|hullLost/)
  })

  it('pays regen → cloak → pulse → propulsion before the weapon, waiting one tick when one milli short', () => {
    const s1 = engaged(orders(0, null, true))
    const draft = laser(orders(1, { column: 11, row: 10 }, true, 'activePulse'))
    // 30,200 + 200 − 300 − 12,000 − 100 = 18,000: exactly the laser cost on the first tick.
    const exact = withShip(s1, 'player', { energyMilli: 30_200 })
    expect(issueCodes(exact, 'player', draft)).toEqual(['cloak:warning:activity-breaks-cloak'])
    const paid = resolveTurn(exact, lock(exact, draft, orders(1, null)), DUEL_RULES, DUEL_SCENARIO)
    expect(frame(paid, 'player', 101).ownShip).toMatchObject({ energy: { currentMilli: 0 }, sensor: 'tracking', position: { x: 10_600 } })
    expect(paid.presentations.player.assessment).toMatchObject({ interruptions: [], sensorAttempt: { kind: 'succeeded' }, weaponAttempt: { kind: 'fired', tick: 101 } })
    const short = withShip(s1, 'player', { energyMilli: 30_199 })
    expect(validateOrders(draft, observeSide(short, 'player', DUEL_RULES, DUEL_SCENARIO), DUEL_RULES).issues).toEqual([
      { field: 'cloak', severity: 'warning', code: 'activity-breaks-cloak' },
      { field: 'weapon', severity: 'conditional', code: 'awaiting-energy', details: { requiredEnergyMilli: 18_000, availableEnergyMilli: 17_999 } },
    ])
    const waited = resolveTurn(short, lock(short, draft, orders(1, null)), DUEL_RULES, DUEL_SCENARIO)
    expect(frame(waited, 'player', 101).ownShip).toMatchObject({ energy: { currentMilli: 17_999 }, position: { x: 10_600 }, turnActions: { weaponIntentSpent: false } })
    // Tick 102: +200 regen, cloak already latched by the pulse, −100 propulsion, −18,000 laser.
    expect(frame(waited, 'player', 102).ownShip).toMatchObject({ energy: { currentMilli: 99 }, turnActions: { weaponIntentSpent: true } })
    expect(shots(waited)).toEqual(['102:player-ship'])
    expect(Math.min(...waited.presentations.player.frames.map((f) => f.observation.ownShip.energy.currentMilli))).toBeGreaterThanOrEqual(0)
  })

  it('waits on a stale contact without firing at its unseen true position, then fires after reacquisition and range', () => {
    // Turn 0: the patrol drives east to (19,10); the cloaked player loses it at tick 26.
    const s1 = engaged(orders(0, null, true), orders(0, { column: 19, row: 10 }))
    const view = observeSide(s1, 'player', DUEL_RULES, DUEL_SCENARIO)
    expect(view.contacts).toEqual([expect.objectContaining({ alias: 'contact-1', kind: 'stale', measurement: { position: { x: 18_500, y: 10_500 }, tick: 25 } })])
    const draft = laser(orders(1, null, true))
    expect(validateOrders(draft, view, DUEL_RULES).issues).toEqual([
      { field: 'cloak', severity: 'warning', code: 'activity-breaks-cloak' },
      { field: 'weapon', severity: 'conditional', code: 'awaiting-current-lock', details: { contactAlias: 'contact-1' } },
    ])
    const blind = resolveTurn(s1, lock(s1, draft, orders(1, null)), DUEL_RULES, DUEL_SCENARIO)
    expect(shots(blind)).toEqual([])
    expect(blind.presentations.player.assessment.weaponAttempt).toEqual({ kind: 'unfired', weapon: 'laser', reasons: ['no-current-lock'] })
    expect(blind.presentations.patrol.assessment.deltas).toMatchObject({ shields: 0, hull: 0 })
    // The patrol returns west: moving signature reacquired at tick 113 (7,960 units), in laser range at tick 138 (5,960).
    const back = resolveTurn(s1, lock(s1, draft, orders(1, { column: 15, row: 10 })), DUEL_RULES, DUEL_SCENARIO)
    expect(frame(back, 'player', 112).contacts[0].kind).toBe('stale')
    expect(frame(back, 'player', 113).contacts[0]).toMatchObject({ alias: 'contact-1', kind: 'current' })
    expect(shots(back)).toEqual(['138:player-ship'])
    expect(frame(back, 'player', 138).events.find((event) => event.kind === 'observed-impact')).toMatchObject({ position: { x: 16_460, y: 10_500 } })
  })

  it('reports unseen-safe unfired reasons and keeps cooldowns across short configured turns', () => {
    const outOfRange = engaged(orders(0, null), orders(0, null))
    const far = withShip(outOfRange, 'player', { position: { x: 9500, y: 10_500 } })
    const waited = resolveTurn(far, lock(far, laser(orders(1, null)), orders(1, null)), DUEL_RULES, DUEL_SCENARIO)
    expect(waited.presentations.player.assessment.weaponAttempt).toEqual({ kind: 'unfired', weapon: 'laser', reasons: ['out-of-range'] })
    // 1 s turns: a tick-11 shot is ready again at tick 61, five turns later.
    const rules = createRuleset({ ...DUEL_CONFIG, version: 'short-turns', timing: { ...DUEL_CONFIG.timing, turnMs: 1000 } })
    let state = engaged(orders(0, null), orders(0, null), rules)
    const results: TurnResolution[] = []
    const validations: string[][] = []
    for (let turn = 1; turn <= 6; turn++) {
      const draft = laser(orders(turn, null))
      validations.push(issueCodes(state, 'player', draft, rules))
      const result = resolveTurn(state, lock(state, draft, orders(turn, null)), rules, DUEL_SCENARIO)
      results.push(result)
      state = result.nextState
    }
    expect(validations).toEqual([[], ...Array.from({ length: 4 }, () => ['weapon:conditional:awaiting-cooldown']), []])
    expect(validateOrders(laser(orders(2, null)), observeSide(results[0].nextState, 'player', rules, DUEL_SCENARIO), rules).issues[0].details).toEqual({ readyTick: 61 })
    expect(results.map((result) => result.presentations.player.assessment.weaponAttempt)).toEqual([
      { kind: 'fired', tick: 11, weapon: 'laser' },
      ...Array.from({ length: 4 }, () => ({ kind: 'unfired', weapon: 'laser', reasons: ['cooldown'] })),
      { kind: 'fired', tick: 61, weapon: 'laser' },
    ])
    // Second hit: the remaining 25 shields absorb first, overflow 10 reaches hull.
    expect(frame(results[5], 'patrol', 61).events.find((event) => event.kind === 'own-damage')).toMatchObject({ shieldsLost: 25, hullLost: 10 })
  })
})

describe('simultaneous damage batch, destruction and boundary outcomes', () => {
  const open = () => engaged(orders(0, null), orders(0, null))
  it('lets both lethal beams of one tick land, whatever the side evaluation order: mutual destruction at the boundary', () => {
    const s1 = withShip(withShip(open(), 'player', { shields: 0, hull: 30 }), 'patrol', { shields: 0, hull: 35 })
    const before = JSON.stringify(s1)
    const turn = lock(s1, laser(orders(1, null)), laser(orders(1, null)))
    const result = resolveTurn(s1, turn, DUEL_RULES, DUEL_SCENARIO)
    expect(JSON.stringify(resolveTurnInOrder(s1, turn, DUEL_RULES, DUEL_SCENARIO, ['patrol', 'player']))).toBe(JSON.stringify(result))
    expect(resolveTurn(s1, turn, DUEL_RULES, DUEL_SCENARIO)).toEqual(result)
    expect(JSON.stringify(s1)).toBe(before)
    expect(Object.isFrozen(result.nextState.ships.patrol)).toBe(true)
    expect(result.nextState.random).toEqual(s1.random)
    expect(shots(result)).toEqual(['101:player-ship', '101:patrol-ship'])
    expect(kindsAt(result, 'player', 101)).toEqual(['own-shot', 'own-energy', 'observed-shot', 'observed-impact', 'own-damage', 'observed-destruction', 'own-destruction'])
    expect(frame(result, 'player', 101).events.slice(4)).toEqual([
      { id: 't101-004', tick: 101, kind: 'own-damage', shieldsLost: 0, hullLost: 30 },
      { id: 't101-005', tick: 101, kind: 'observed-destruction', contactAlias: 'contact-1', position: { x: 16_500, y: 10_500 } },
      { id: 't101-006', tick: 101, kind: 'own-destruction', position: PLAYER_AT },
    ])
    expect(frame(result, 'player', 101).ownShip).toMatchObject({ status: 'destroyed', hull: { current: 0 } })
    // The full turn still runs; dead observers keep memory (stale, destruction tick) without new sightings.
    expect(frame(result, 'player', 102).contacts[0]).toMatchObject({ alias: 'contact-1', kind: 'stale', observedDestructionTick: 101, measurement: { tick: 101 } })
    expect(frame(result, 'player', 199).outcome).toBeUndefined()
    expect(result.presentations.patrol.frames.some((f) => f.tick < 200 && (f.observation.outcome !== undefined || f.events.some((event) => event.kind === 'outcome')))).toBe(false)
    expect(frame(result, 'player', 200).outcome).toEqual({ outcome: 'mutual-destruction', revealTick: 200 })
    expect(kindsAt(result, 'patrol', 200)).toEqual(['outcome'])
    expect(result.nextState.outcome).toEqual({ outcome: 'mutual-destruction', revealTick: 200 })
    expect(observeSide(result.nextState, 'player', DUEL_RULES, DUEL_SCENARIO).observedOpponentDestructionTick).toBe(101)
    expect(() => resolveTurn(result.nextState, lock(result.nextState, null, null), DUEL_RULES, DUEL_SCENARIO)).toThrow('final outcome')
    for (const side of ['player', 'patrol'] as const) {
      const json = JSON.stringify(result.presentations[side])
      for (const key of HIDDEN_KEYS) expect(json).not.toContain(`"${key}`)
    }
  })

  it('completes the dying ship\'s same-tick shot only; from the next tick it neither fires, moves nor regenerates (defeat)', () => {
    // Player: 20 shields + 10 hull, laser ready only at tick 102, moving east.
    const s1 = withShip(open(), 'player', { shields: 20, hull: 10, laserReadyTick: 102 })
    const draft = laser(orders(1, { column: 11, row: 10 }))
    expect(validateOrders(draft, observeSide(s1, 'player', DUEL_RULES, DUEL_SCENARIO), DUEL_RULES).issues)
      .toEqual([{ field: 'weapon', severity: 'conditional', code: 'awaiting-cooldown', details: { readyTick: 102 } }])
    const result = resolveTurn(s1, lock(s1, draft, laser(orders(1, null))), DUEL_RULES, DUEL_SCENARIO)
    expect(frame(result, 'player', 101).events.find((event) => event.kind === 'own-damage')).toMatchObject({ shieldsLost: 20, hullLost: 10 })
    const after = result.presentations.player.frames.filter((f) => f.tick >= 101).map((f) => f.observation.ownShip)
    expect(new Set(after.map((ship) => `${ship.status}:${ship.position.x}:${ship.energy.currentMilli}`)).size).toBe(1)
    expect(after[0]).toMatchObject({ status: 'destroyed', position: { x: 10_600 } })
    expect(shots(result)).toEqual(['101:patrol-ship'])
    expect(result.presentations.player.assessment.weaponAttempt).toEqual({ kind: 'unfired', weapon: 'laser', reasons: ['cooldown', 'own-destroyed'] })
    expect(result.nextState.outcome).toEqual({ outcome: 'defeat', revealTick: 200 })
    // A ship that dies in the batch still lands its shot from that same tick.
    const traded = resolveTurn(withShip(s1, 'player', { laserReadyTick: 0 }), lock(s1, draft, laser(orders(1, null))), DUEL_RULES, DUEL_SCENARIO)
    expect(shots(traded)).toEqual(['101:player-ship', '101:patrol-ship'])
    expect(frame(traded, 'patrol', 101).ownShip.shields.current).toBe(25)
    expect(traded.nextState.outcome).toEqual({ outcome: 'defeat', revealTick: 200 })
  })

  it('classifies victory at the boundary and then restricts the observer to hold fire', () => {
    const s1 = withShip(open(), 'patrol', { shields: 20, hull: 15 })
    const result = resolveTurn(s1, lock(s1, laser(orders(1, null)), orders(1, null)), DUEL_RULES, DUEL_SCENARIO)
    expect(frame(result, 'patrol', 101).events.find((event) => event.kind === 'own-damage')).toMatchObject({ shieldsLost: 20, hullLost: 15 })
    expect(kindsAt(result, 'patrol', 101)).toContain('own-destruction')
    expect(result.nextState.outcome).toEqual({ outcome: 'victory', revealTick: 200 })
    const view = observeSide(result.nextState, 'player', DUEL_RULES, DUEL_SCENARIO)
    expect(validateOrders(laser(orders(2, null)), view, DUEL_RULES).issues).toEqual([{ field: 'weapon', severity: 'error', code: 'observed-opponent-destroyed' }])
    expect(validateOrders(orders(2, null), view, DUEL_RULES).structurallyValid).toBe(true)
  })
})

describe('observer information boundaries', () => {
  it('lets a newly revealed shooter be attacked on the next tick, never by a second pass in the firing tick', () => {
    const s2 = hiddenShooter()
    expect(observeSide(s2, 'patrol', DUEL_RULES, DUEL_SCENARIO).contacts[0]).toMatchObject({ alias: 'contact-1', kind: 'stale', measurement: { tick: 100 } })
    expect(issueCodes(s2, 'patrol', laser(orders(2, null)))).toEqual(['weapon:conditional:awaiting-current-lock'])
    const result = resolveTurn(s2, lock(s2, laser(orders(2, null, true)), laser(orders(2, null))), DUEL_RULES, DUEL_SCENARIO)
    // Tick 201: the cloaked shooter is unseen pre-fire, so the patrol cannot answer in that tick's single pass.
    expect(kindsAt(result, 'patrol', 201)).toEqual(['contact-acquired', 'observed-shot', 'own-damage'])
    expect(shots(result)).toEqual(['201:player-ship', '202:patrol-ship'])
    expect(result.presentations.patrol.assessment.weaponAttempt).toEqual({ kind: 'fired', tick: 202, weapon: 'laser' })
    expect(kindsAt(result, 'player', 202)).toEqual(['observed-shot', 'own-damage'])
  })

  it('gives the player identical results whatever hidden laser intent or energy the unseen patrol has', () => {
    const s2 = hiddenShooter()
    const drained = withShip(s2, 'patrol', { energyMilli: 0 })
    const player = orders(2, null, true)
    const worlds = [
      resolveTurn(s2, lock(s2, player, orders(2, null)), DUEL_RULES, DUEL_SCENARIO),
      resolveTurn(s2, lock(s2, player, laser(orders(2, null))), DUEL_RULES, DUEL_SCENARIO),
      resolveTurn(drained, lock(drained, player, laser(orders(2, null))), DUEL_RULES, DUEL_SCENARIO),
    ]
    expect(worlds[1].presentations.patrol.assessment.weaponAttempt).toEqual({ kind: 'unfired', weapon: 'laser', reasons: ['no-current-lock'] })
    expect(worlds[2].presentations.patrol.assessment.weaponAttempt).toEqual({ kind: 'unfired', weapon: 'laser', reasons: ['no-current-lock', 'insufficient-energy'] })
    const next = laser(orders(3, { column: 12, row: 10 }, true))
    for (const world of worlds.slice(1)) {
      expect(world.presentations.player).toEqual(worlds[0].presentations.player)
      const view = observeSide(world.nextState, 'player', DUEL_RULES, DUEL_SCENARIO)
      const baseline = observeSide(worlds[0].nextState, 'player', DUEL_RULES, DUEL_SCENARIO)
      expect(view).toEqual(baseline)
      expect(validateOrders(next, view, DUEL_RULES)).toEqual(validateOrders(next, baseline, DUEL_RULES))
      expect(previewRoute(next.movement, view.ownShip, view.map, DUEL_RULES)).toEqual(previewRoute(next.movement, baseline.ownShip, baseline.map, DUEL_RULES))
    }
  })

  it('never deletes memory, disarms, reveals or validates differently after an unobserved destruction before the boundary', () => {
    // Constructed boundary case (a TSB-30B missile could cause it): the patrol died unseen at tick 60.
    const s1 = withShip(engaged(orders(0, null, true), orders(0, { column: 19, row: 10 })), 'patrol', { alive: false, destructionTick: 60 })
    const view = observeSide(s1, 'player', DUEL_RULES, DUEL_SCENARIO)
    expect(view.observedOpponentDestructionTick).toBeUndefined()
    expect(view.contacts[0]).toMatchObject({ alias: 'contact-1', kind: 'stale' })
    expect(view.contacts[0].observedDestructionTick).toBeUndefined()
    const draft = laser(orders(1, null, true))
    expect(validateOrders(draft, view, DUEL_RULES).structurallyValid).toBe(true)
    const result = resolveTurn(s1, lock(s1, draft, null), DUEL_RULES, DUEL_SCENARIO)
    const early = result.presentations.player.frames.filter((f) => f.tick < 200)
    expect(early.every((f) => f.observation.outcome === undefined && f.observation.contacts.length === 1)).toBe(true)
    expect(result.presentations.player.assessment.events.map((event) => event.kind)).toEqual(['outcome'])
    expect(result.presentations.player.assessment.weaponAttempt).toEqual({ kind: 'unfired', weapon: 'laser', reasons: ['no-current-lock'] })
    expect(frame(result, 'player', 200).outcome).toEqual({ outcome: 'victory', revealTick: 200 })
  })

  it('checks own-knowledge line of sight in validation and in the stage-5 proposal', () => {
    const view = observeSide(engaged(orders(0, null), orders(0, null)), 'player', DUEL_RULES, DUEL_SCENARIO)
    const behindRock: SideObservation = {
      ...view, ownShip: { ...view.ownShip, position: { x: 6500, y: 4500 } },
      contacts: [{ ...view.contacts[0], measurement: { position: { x: 9500, y: 4500 }, tick: view.tick } }],
    }
    expect(validateOrders(laser(orders(1, null)), behindRock, DUEL_RULES).issues).toEqual([{ field: 'weapon', severity: 'conditional', code: 'awaiting-line-of-sight', details: { contactAlias: 'contact-1' } }])
    const s1 = engaged(orders(0, null), orders(0, null))
    const shooter = { ...s1.ships.player, orders: laser(orders(1, null)), position: { x: 6500, y: 4500 } }
    const target = { ...s1.ships.patrol, position: { x: 9500, y: 4500 } }
    expect(proposeLaser(shooter, s1.knowledge.player, [target], 101, DUEL_RULES, DUEL_MAP)).toEqual({ fire: false, reasons: ['line-of-sight-blocked'] })
    expect(proposeLaser({ ...shooter, position: { x: 6500, y: 3500 } }, s1.knowledge.player, [{ ...target, position: { x: 9500, y: 3500 } }], 101, DUEL_RULES, DUEL_MAP))
      .toMatchObject({ fire: true })
    expect(applyDamage(target, 0, 101).ship).toBe(target)
  })
})
