import { describe, expect, it } from 'vitest'
import type { Scenario } from '../contracts/private'
import type { PublicMap, SideObservation, TurnOrders } from '../contracts/public'
import { createScenario, DUEL_SCENARIO } from '../scenarios/private'
import { DUEL_MAP, DUEL_RULES } from '../scenarios/public'
import { createRuleset, DUEL_CONFIG } from '../scenarios/rules'
import { ENGINE_CAPABILITIES, initialiseSession, observeSide, previewRoute, resolveTurn, validateOrders } from './index'
import { lock, orders } from './testSupport'

const HIDDEN_KEYS = ['entityId', 'targetEntityId', 'launcherEntityId', 'spawns', 'seed', 'random', 'plannerMemory', 'internalEvents', 'terminalPending', 'acceptedTurns', 'presentations', 'cloakLatch', 'orders']

function crossingTurn() {
  const s0 = initialiseSession(DUEL_SCENARIO, DUEL_RULES, 7)
  return resolveTurn(s0, lock(s0, orders(0, { column: 16, row: 10 }, true), orders(0, { column: 3, row: 10 })), DUEL_RULES, DUEL_SCENARIO)
}
const contactsAt = (frames: readonly { tick: number; observation: SideObservation }[], tick: number) =>
  frames.find((frame) => frame.tick === tick)?.observation.contacts

describe('passive sensing and contact memory', () => {
  it('detects a cloaked moving ship only within 3+1 cells and an uncloaked moving ship within 7+1', () => {
    const result = crossingTurn()
    const patrolFrames = result.presentations.patrol.frames
    const playerFrames = result.presentations.player.frames
    // Separation shrinks 180 units/tick from 13,000; 4,000 is reached at tick 50, 8,000 at tick 28.
    expect(contactsAt(patrolFrames, 49)).toEqual([])
    expect(contactsAt(patrolFrames, 50)).toEqual([{ alias: 'contact-1', kind: 'current', measurement: { position: { x: 8500, y: 10_500 }, tick: 50 }, ageTicks: 0, uncertaintyRadiusUnits: 0 }])
    expect(contactsAt(playerFrames, 27)).toEqual([])
    expect(contactsAt(playerFrames, 28)?.[0]).toMatchObject({ alias: 'contact-1', kind: 'current', measurement: { position: { x: 14_260, y: 10_500 }, tick: 28 } })
    expect(contactsAt(playerFrames, 29)?.[0]).toMatchObject({ previousMeasurement: { tick: 28 }, estimatedVelocity: { xUnitsPerTick: -80, yUnitsPerTick: 0 } })
    expect(contactsAt(playerFrames, 100)?.[0].kind).toBe('current')
  })
  it('turns a lost contact stale with age and public-max-speed uncertainty', () => {
    const result = crossingTurn()
    const frames = result.presentations.patrol.frames
    // After crossing, separation exceeds 4,000 at tick 95; last measurement was tick 94.
    expect(contactsAt(frames, 94)?.[0].kind).toBe('current')
    expect(contactsAt(frames, 95)?.[0]).toMatchObject({ alias: 'contact-1', kind: 'stale', ageTicks: 1, uncertaintyRadiusUnits: 100, measurement: { tick: 94, position: { x: 12_900, y: 10_500 } } })
    expect(contactsAt(frames, 100)?.[0]).toMatchObject({ kind: 'stale', ageTicks: 6, uncertaintyRadiusUnits: 600 })
    const kinds = result.presentations.patrol.assessment.events.map((event) => event.kind)
    expect(kinds).toEqual(['contact-acquired', 'contact-lost'])
    expect(result.presentations.patrol.assessment.contacts).toHaveLength(1)
  })
  it('keeps the alias through reacquisition and expires memory after the configured lifetime', () => {
    const rules = createRuleset({ ...DUEL_CONFIG, timing: { ...DUEL_CONFIG.timing, contactMemoryMs: 3_000 } })
    const s0 = initialiseSession(DUEL_SCENARIO, rules, 7)
    const t0 = resolveTurn(s0, lock(s0, orders(0, { column: 16, row: 10 }, true), orders(0, { column: 3, row: 10 })), rules, DUEL_SCENARIO)
    const patrol = t0.presentations.patrol.frames
    // Lost at tick 95 (measured tick 94); memory of 30 ticks has not expired by 100.
    expect(contactsAt(patrol, 100)?.[0]).toMatchObject({ alias: 'contact-1', kind: 'stale' })
    const s1 = t0.nextState
    // Player turns back west towards the frigate: reacquired under the same alias.
    const t1 = resolveTurn(s1, lock(s1, orders(1, { column: 3, row: 10 }, true), orders(1, null)), rules, DUEL_SCENARIO)
    const reacquired = t1.presentations.patrol.frames.find((frame) => frame.observation.contacts[0]?.kind === 'current')
    expect(reacquired?.observation.contacts[0].alias).toBe('contact-1')
    expect(reacquired?.events.map((event) => event.kind)).toContain('contact-acquired')
    // Without reacquisition the stale contact expires at measurement tick + 30.
    const t1Hold = resolveTurn(s1, lock(s1, orders(1, null, true), orders(1, { column: 0, row: 10 })), rules, DUEL_SCENARIO)
    const expiry = t1Hold.presentations.patrol.frames.find((frame) => frame.events.some((event) => event.kind === 'contact-expired'))
    expect(expiry?.tick).toBe(94 + 30)
    expect(expiry?.observation.contacts).toEqual([])
  })
})

describe('observer-safe projection', () => {
  it('publishes own truth and never authoritative IDs, opposing internals or orders', () => {
    const result = crossingTurn()
    for (const side of ['player', 'patrol'] as const) {
      const json = JSON.stringify(result.presentations[side])
      for (const key of HIDDEN_KEYS) expect(json).not.toContain(`"${key}"`)
    }
    const initial = observeSide(initialiseSession(DUEL_SCENARIO, DUEL_RULES, 7), 'player', DUEL_RULES, DUEL_SCENARIO)
    expect(initial.ownShip).toMatchObject({ status: 'alive', energy: { currentMilli: 100_000, maxMilli: 100_000 }, cloak: { requested: true, actual: true, state: 'active' }, sensor: 'passive', destination: null })
    expect(initial.contacts).toEqual([])
    expect(initial.map).toEqual(DUEL_MAP)
    expect(Object.isFrozen(initial.ownShip.route)).toBe(true)
    expect(JSON.parse(JSON.stringify(initial))).toEqual(initial)
  })
  it('gives identical player frames, validation and previews when only hidden enemy facts differ', () => {
    const moved: Scenario = createScenario({ ...DUEL_SCENARIO, spawns: { ...DUEL_SCENARIO.spawns, patrol: { ...DUEL_SCENARIO.spawns.patrol, cell: { column: 19, row: 2 } } } }, DUEL_RULES)
    const a = initialiseSession(DUEL_SCENARIO, DUEL_RULES, 7)
    const b = initialiseSession(moved, DUEL_RULES, 9)
    const draft = orders(0, { column: 5, row: 12 }, true)
    const observeA = observeSide(a, 'player', DUEL_RULES, DUEL_SCENARIO)
    const observeB = observeSide(b, 'player', DUEL_RULES, moved)
    expect(JSON.stringify(observeB)).toBe(JSON.stringify(observeA))
    expect(validateOrders(draft, observeB, DUEL_RULES)).toEqual(validateOrders(draft, observeA, DUEL_RULES))
    expect(previewRoute(draft.movement, observeB.ownShip, observeB.map, DUEL_RULES)).toEqual(previewRoute(draft.movement, observeA.ownShip, observeA.map, DUEL_RULES))
    // Different unseen enemy orders and positions leave every recorded player frame unchanged.
    const ra = resolveTurn(a, lock(a, draft, orders(0, { column: 19, row: 19 })), DUEL_RULES, DUEL_SCENARIO)
    const rb = resolveTurn(b, lock(b, draft, orders(0, null)), DUEL_RULES, moved)
    expect(JSON.stringify(rb.presentations.player)).toBe(JSON.stringify(ra.presentations.player))
    expect(JSON.stringify(ra.nextState.ships.patrol)).not.toBe(JSON.stringify(rb.nextState.ships.patrol))
  })
})

describe('order validation (own observation and public rules only)', () => {
  const observation = observeSide(initialiseSession(DUEL_SCENARIO, DUEL_RULES, 7), 'player', DUEL_RULES, DUEL_SCENARIO)
  const codes = (draft: unknown) => validateOrders(draft as TurnOrders, observation, DUEL_RULES).issues.map((issue) => `${issue.field}:${issue.severity}:${issue.code}`)
  it('accepts hold and reachable destinations', () => {
    expect(validateOrders(orders(0, null, true), observation, DUEL_RULES)).toEqual({ structurallyValid: true, issues: [] })
    expect(validateOrders(orders(0, { column: 16, row: 3 }, true), observation, DUEL_RULES).structurallyValid).toBe(true)
  })
  it('reports typed structural errors per field', () => {
    expect(codes(null)).toEqual(['orders:error:invalid-shape'])
    expect(codes({ ...orders(0, null), movement: { kind: 'destination', cell: { column: 2.5, row: 1 } }, cloak: 'yes' })).toEqual(['movement:error:invalid-shape', 'cloak:error:invalid-shape'])
    expect(codes(orders(3, null))).toEqual(['turnIndex:error:invalid-turn'])
    expect(codes(orders(0, { column: 20, row: 0 }))).toEqual(['movement:error:out-of-bounds'])
    expect(codes(orders(0, { column: 7, row: 4 }))).toEqual(['movement:error:obstacle'])
    expect(validateOrders(orders(0, { column: 7, row: 4 }), observation, DUEL_RULES).issues[0].details).toEqual({ cell: { column: 7, row: 4 } })
    const sealed: PublicMap = { ...DUEL_MAP, asteroidCells: [...DUEL_MAP.asteroidCells, { column: 1, row: 0 }, { column: 0, row: 1 }, { column: 2, row: 1 }, { column: 1, row: 2 }] }
    expect(validateOrders(orders(0, { column: 1, row: 1 }), { ...observation, map: sealed }, DUEL_RULES).issues.map((issue) => issue.code)).toEqual(['unreachable'])
  })
  it('rejects equipped capabilities not implemented by this engine increment instead of silently ignoring them', () => {
    expect(ENGINE_CAPABILITIES).toEqual({ activePulse: true, laser: false, missile: false })
    expect(codes({ ...orders(0, null), sensor: 'activePulse' })).toEqual([])
    expect(codes({ ...orders(0, null), weapon: { kind: 'laser', contactAlias: 'contact-1' } })).toEqual(['weapon:error:equipment-unavailable'])
    expect(codes({ ...orders(0, null), weapon: { kind: 'missile', aim: { column: 9, row: 9 } } })).toEqual(['weapon:error:equipment-unavailable'])
    const patrol = observeSide(initialiseSession(DUEL_SCENARIO, DUEL_RULES, 7), 'patrol', DUEL_RULES, DUEL_SCENARIO)
    expect(validateOrders(orders(0, null, true), patrol, DUEL_RULES).issues.map((issue) => `${issue.field}:${issue.code}`)).toEqual(['cloak:equipment-unavailable'])
  })
  it('warns conditionally when the same stage order predicts unfunded propulsion', () => {
    const ship = DUEL_CONFIG.ships['shadow-dancer']
    const rules = createRuleset({ ...DUEL_CONFIG, ships: { ...DUEL_CONFIG.ships, 'shadow-dancer': { ...ship, startingEnergyMilli: 1000, regenerationMilliPerSecond: 0 } } })
    const low = observeSide(initialiseSession(DUEL_SCENARIO, rules, 1), 'player', rules, DUEL_SCENARIO)
    const result = validateOrders(orders(0, { column: 16, row: 10 }), low, rules)
    expect(result.structurallyValid).toBe(true)
    expect(result.issues).toEqual([{ field: 'movement', severity: 'conditional', code: 'propulsion-funding', details: { availableEnergyMilli: 1000 } }])
    expect(validateOrders(orders(0, { column: 4, row: 10 }), low, rules).issues).toEqual([])
  })
})

describe('route preview', () => {
  const observation = observeSide(initialiseSession(DUEL_SCENARIO, DUEL_RULES, 7), 'player', DUEL_RULES, DUEL_SCENARIO)
  it('previews hold, predicted waypoints in world units and the nominal reachable point', () => {
    expect(previewRoute({ kind: 'hold' }, observation.ownShip, DUEL_MAP, DUEL_RULES)).toEqual({ kind: 'hold', position: { x: 3500, y: 10_500 } })
    const preview = previewRoute({ kind: 'destination', cell: { column: 16, row: 10 } }, observation.ownShip, DUEL_MAP, DUEL_RULES)
    expect(preview).toMatchObject({ kind: 'destination', destination: { column: 16, row: 10 }, predicted: true, conditionalOnPropulsionFunding: true, nominalReachablePoint: { x: 13_500, y: 10_500 } })
    if (preview.kind !== 'destination') throw new Error('destination preview expected')
    expect(preview.waypoints[0]).toEqual({ x: 3500, y: 10_500 })
    expect(preview.waypoints.at(-1)).toEqual({ x: 16_500, y: 10_500 })
    expect(preview.waypoints).toHaveLength(14)
  })
  it('matches the engine route and reports unavailable destinations with typed issues', () => {
    const s0 = initialiseSession(DUEL_SCENARIO, DUEL_RULES, 7)
    const result = resolveTurn(s0, lock(s0, orders(0, { column: 9, row: 3 }), orders(0, null)), DUEL_RULES, DUEL_SCENARIO)
    const preview = previewRoute({ kind: 'destination', cell: { column: 9, row: 3 } }, observation.ownShip, DUEL_MAP, DUEL_RULES)
    if (preview.kind !== 'destination') throw new Error('destination preview expected')
    expect(preview.waypoints).toEqual(result.presentations.player.frames[0].observation.ownShip.route.waypoints)
    expect(preview.nominalReachablePoint).toEqual(result.nextState.ships.player.position)
    expect(previewRoute({ kind: 'destination', cell: { column: 7, row: 4 } }, observation.ownShip, DUEL_MAP, DUEL_RULES))
      .toEqual({ kind: 'unavailable', issues: [{ field: 'movement', severity: 'error', code: 'obstacle', details: { cell: { column: 7, row: 4 } } }] })
  })
  it('continues the retained route for the same destination mid-way', () => {
    const s0 = initialiseSession(DUEL_SCENARIO, DUEL_RULES, 7)
    const s1 = resolveTurn(s0, lock(s0, orders(0, { column: 16, row: 10 }), orders(0, null)), DUEL_RULES, DUEL_SCENARIO).nextState
    const own = observeSide(s1, 'player', DUEL_RULES, DUEL_SCENARIO).ownShip
    const preview = previewRoute({ kind: 'destination', cell: { column: 16, row: 10 } }, own, DUEL_MAP, DUEL_RULES)
    expect(preview).toMatchObject({ kind: 'destination', waypoints: [{ x: 13_500, y: 10_500 }, { x: 14_500, y: 10_500 }, { x: 15_500, y: 10_500 }, { x: 16_500, y: 10_500 }], nominalReachablePoint: { x: 16_500, y: 10_500 } })
  })
})
