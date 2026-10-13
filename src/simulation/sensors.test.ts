import { describe, expect, it } from 'vitest'
import type { ShipState, SimulationState, TurnResolution } from '../contracts/private'
import type { Ruleset, Side, SideObservation, TurnOrders } from '../contracts/public'
import { DUEL_SCENARIO } from '../scenarios/private'
import { DUEL_MAP, DUEL_RULES } from '../scenarios/public'
import { createRuleset, DUEL_CONFIG } from '../scenarios/rules'
import { initialiseSession, observeSide, previewRoute, resolveTurn, validateOrders } from './index'
import { resolveTurnInOrder } from './resolve'
import { detects } from './sensing'
import { lock, orders, withShip } from './testSupport'

// Reproducible inputs: seed 20, DUEL_SCENARIO spawns (3,10)/(16,10), positions on the asteroid-free row y=10,500.
const SEED = 20
const HIDDEN_KEYS = ['entityId', 'targetEntityId', 'cloakLatch', 'cloakActive', 'cloakRequested', 'propulsionInterrupted', 'orders', 'seed', 'random', 'internalEvents']
const pulse = (turnIndex: number, cloak = false): TurnOrders => orders(turnIndex, null, cloak, 'activePulse')
const hold = (turnIndex: number, cloak = false): TurnOrders => orders(turnIndex, null, cloak)

/** Uncloaked player at cell (6,10): exactly 10 cells from the patrol spawn. */
function tenCellsApart(rules: Ruleset = DUEL_RULES): SimulationState {
  return withShip(initialiseSession(DUEL_SCENARIO, rules, SEED), 'player', { position: { x: 6500, y: 10_500 }, cloakRequested: false, cloakActive: false })
}
const frame = (result: TurnResolution, side: Side, tick: number): SideObservation => {
  const found = result.presentations[side].frames.find((candidate) => candidate.tick === tick)
  if (found === undefined) throw new Error(`no ${side} frame at ${tick}`)
  return found.observation
}
const eventKinds = (result: TurnResolution, side: Side) => result.presentations[side].assessment.events.map((event) => `${event.tick}:${event.kind}`)
const issueCodes = (state: SimulationState, draft: TurnOrders, rules: Ruleset = DUEL_RULES) =>
  validateOrders(draft, observeSide(state, 'player', rules, DUEL_SCENARIO), rules).issues.map((issue) => `${issue.field}:${issue.severity}:${issue.code}`)

describe('active pulse funding', () => {
  it('pays regeneration → cloak sustain → pulse once on the first tick and breaks cloak for the rest of the turn', () => {
    const s0 = initialiseSession(DUEL_SCENARIO, DUEL_RULES, SEED)
    expect(issueCodes(s0, pulse(0, true))).toEqual(['cloak:warning:activity-breaks-cloak'])
    const result = resolveTurn(s0, lock(s0, pulse(0, true), hold(0)), DUEL_RULES, DUEL_SCENARIO)
    expect(frame(result, 'player', 0).ownShip).toMatchObject({ sensor: 'passive', cloak: { requested: true, actual: true, state: 'active' } })
    // 100,000 capped regen, −300 sustain (not refunded), −12,000 pulse.
    expect(frame(result, 'player', 1).ownShip).toMatchObject({
      energy: { currentMilli: 87_700 }, sensor: 'tracking', cloak: { requested: true, actual: false, state: 'latched-activity' },
      clocks: { trackingUntilTick: 21, exposureUntilTick: 31 }, turnActions: { pulseAttemptSpent: true },
    })
    expect(frame(result, 'player', 1).events).toEqual([
      { id: 't1-000', tick: 1, kind: 'own-energy', deltaMilli: -12_000, reason: 'pulse' },
      { id: 't1-001', tick: 1, kind: 'own-cloak', cloak: { requested: true, actual: false, state: 'latched-activity' } },
    ])
    expect(frame(result, 'player', 2).ownShip.energy.currentMilli).toBe(87_900)
    // Exposure ends at tick 31, but the cloak never resumes in the scanning turn.
    expect(frame(result, 'player', 100).ownShip.cloak).toEqual({ requested: true, actual: false, state: 'latched-activity' })
    const player = result.presentations.player.assessment
    expect(player.sensorAttempt).toEqual({ kind: 'succeeded' })
    expect(player.interruptions).toEqual([])
    expect(eventKinds(result, 'player')).toEqual(['1:own-energy', '1:own-cloak'])
    expect(result.internalEvents.filter((event) => event.kind === 'resource'))
      .toEqual([{ id: 't1-000', tick: 1, kind: 'resource', entityId: 'player-ship', energyDeltaMilli: -12_000, ammunitionDelta: 0, reason: 'pulse' }])
    // 13 cells: neither the exposed (12) nor the tracking (10) threshold reaches the other ship.
    expect(eventKinds(result, 'patrol')).toEqual([])
    expect(result.presentations.patrol.assessment.sensorAttempt).toEqual({ kind: 'not-requested' })
  })

  it('funds sustain before the pulse and the pulse before propulsion, at exact milli boundaries', () => {
    const base = initialiseSession(DUEL_SCENARIO, DUEL_RULES, SEED)
    // 12,100 + 200 − 300 sustain = 12,000 exactly: the pulse is funded and propulsion pauses on tick 1 only.
    const exact = withShip(base, 'player', { energyMilli: 12_100 })
    const east = orders(0, { column: 4, row: 10 }, true, 'activePulse')
    expect(issueCodes(exact, east)).toEqual(['cloak:warning:activity-breaks-cloak', 'movement:conditional:propulsion-funding'])
    const paid = resolveTurn(exact, lock(exact, east, hold(0)), DUEL_RULES, DUEL_SCENARIO)
    expect(frame(paid, 'player', 1).ownShip).toMatchObject({ energy: { currentMilli: 0 }, position: { x: 3500 }, sensor: 'tracking' })
    expect(frame(paid, 'player', 2).ownShip).toMatchObject({ energy: { currentMilli: 100 }, position: { x: 3600 } })
    expect(paid.presentations.player.assessment.interruptions).toEqual([{ tick: 1, reason: 'propulsion-unfunded' }])
    expect(paid.presentations.player.assessment.sensorAttempt).toEqual({ kind: 'succeeded' })
    // One milli short after sustain: the pulse fails without cost, exposure or tracking; cloak stays funded.
    const short = withShip(base, 'player', { energyMilli: 12_099 })
    expect(validateOrders(pulse(0, true), observeSide(short, 'player', DUEL_RULES, DUEL_SCENARIO), DUEL_RULES).issues).toEqual([
      { field: 'cloak', severity: 'warning', code: 'activity-breaks-cloak' },
      { field: 'sensor', severity: 'conditional', code: 'awaiting-energy', details: { requiredEnergyMilli: 12_000, availableEnergyMilli: 11_999 } },
    ])
    const failed = resolveTurn(short, lock(short, pulse(0, true), hold(0)), DUEL_RULES, DUEL_SCENARIO)
    expect(frame(failed, 'player', 1).ownShip).toMatchObject({
      energy: { currentMilli: 11_999 }, sensor: 'passive', cloak: { actual: true, state: 'active' },
      clocks: { trackingUntilTick: 0, exposureUntilTick: 0 }, turnActions: { pulseAttemptSpent: true },
    })
    expect(failed.presentations.player.assessment.sensorAttempt).toEqual({ kind: 'failed', reason: 'insufficient-energy' })
    expect(failed.presentations.player.assessment.interruptions).toEqual([{ tick: 1, reason: 'pulse-unfunded' }])
    expect(eventKinds(failed, 'player')).toEqual(['1:own-interruption'])
    expect(failed.internalEvents.some((event) => event.kind === 'resource')).toBe(false)
    // Without the sustain the same energy funds the pulse, so the sustain really has priority.
    expect(issueCodes(withShip(short, 'player', { cloakRequested: false, cloakActive: false }), pulse(0))).toEqual([])
  })

  it('never retries a failed pulse later in the turn, even once energy recovers', () => {
    const low = withShip(initialiseSession(DUEL_SCENARIO, DUEL_RULES, SEED), 'player', { energyMilli: 11_799, cloakRequested: false, cloakActive: false })
    const result = resolveTurn(low, lock(low, pulse(0), hold(0)), DUEL_RULES, DUEL_SCENARIO)
    expect(frame(result, 'player', 1).ownShip.energy.currentMilli).toBe(11_999)
    expect(frame(result, 'player', 2).ownShip).toMatchObject({ energy: { currentMilli: 12_199 }, sensor: 'passive' })
    expect(frame(result, 'player', 100).ownShip).toMatchObject({ energy: { currentMilli: 11_799 + 100 * 200 }, sensor: 'passive', clocks: { trackingUntilTick: 0, exposureUntilTick: 0 } })
    expect(eventKinds(result, 'player')).toEqual(['1:own-interruption'])
  })

  it('rejects a pulse without active-sensor equipment', () => {
    const frigate = DUEL_CONFIG.ships['patrol-frigate']
    const rules = createRuleset({ ...DUEL_CONFIG, version: 'no-sensor', ships: { ...DUEL_CONFIG.ships, 'patrol-frigate': { ...frigate, equipment: { ...frigate.equipment, activeSensor: false } } } })
    const s0 = initialiseSession(DUEL_SCENARIO, rules, SEED)
    expect(validateOrders(pulse(0), observeSide(s0, 'patrol', rules, DUEL_SCENARIO), rules).issues)
      .toEqual([{ field: 'sensor', severity: 'error', code: 'equipment-unavailable' }])
    expect(() => resolveTurn(s0, lock(s0, hold(0), pulse(0)), rules, DUEL_SCENARIO)).toThrow('sensor:equipment-unavailable')
  })
})

describe('signature thresholds and line of sight', () => {
  const s0 = initialiseSession(DUEL_SCENARIO, DUEL_RULES, SEED)
  const NOW = 50
  const observer = (patch: Partial<ShipState> = {}): ShipState => ({ ...s0.ships.player, position: { x: 3500, y: 10_500 }, cloakActive: false, ...patch })
  const target = (distance: number, patch: Partial<ShipState> = {}): ShipState => ({ ...s0.ships.patrol, position: { x: 3500 + distance, y: 10_500 }, ...patch })
  const range = (observerPatch: Partial<ShipState>, targetPatch: Partial<ShipState>, moved: boolean): number => {
    let units = 0
    while (detects(observer(observerPatch), target(units + 1, targetPatch), moved, DUEL_RULES, DUEL_MAP, NOW)) units += 1
    return units
  }
  it('uses passive 7/3, tracking 10/7, +1 when moved and a flat 12 when exposed (cells × 1000, inclusive)', () => {
    const tracking = { trackingUntilTick: NOW + 1 }
    const cloaked = { cloakActive: true }
    const exposed = { exposureUntilTick: NOW + 1 }
    expect([
      range({}, {}, false), range({}, cloaked, false), range({}, {}, true), range({}, cloaked, true),
      range(tracking, {}, false), range(tracking, cloaked, false), range(tracking, {}, true), range(tracking, cloaked, true),
      range({}, { ...exposed, ...cloaked }, true), range(tracking, exposed, true),
    ]).toEqual([7000, 3000, 8000, 4000, 10_000, 7000, 11_000, 8000, 12_000, 12_000])
  })
  it('treats tracking and exposure clocks as expired when until == now', () => {
    expect(range({ trackingUntilTick: NOW }, {}, false)).toBe(7000)
    expect(range({}, { exposureUntilTick: NOW, cloakActive: true }, false)).toBe(3000)
  })
  it('requires line of sight even for an exposed target, and a live observer and target', () => {
    const blocked = { ...target(0, { exposureUntilTick: NOW + 1 }), position: { x: 9500, y: 4500 } }
    expect(detects(observer({ position: { x: 6500, y: 4500 } }), blocked, false, DUEL_RULES, DUEL_MAP, NOW)).toBe(false)
    expect(detects(observer({ position: { x: 6500, y: 3500 } }), { ...blocked, position: { x: 9500, y: 3500 } }, false, DUEL_RULES, DUEL_MAP, NOW)).toBe(true)
    expect(detects(observer({ alive: false }), target(1000), false, DUEL_RULES, DUEL_MAP, NOW)).toBe(false)
    expect(detects(observer(), target(1000, { alive: false }), false, DUEL_RULES, DUEL_MAP, NOW)).toBe(false)
  })
})

describe('tracking, exposure and contact knowledge through resolved turns', () => {
  it('tracks for exactly 20 ticks and exposes the scanner for exactly 30 ticks', () => {
    const start = tenCellsApart()
    const result = resolveTurn(start, lock(start, pulse(0), hold(0)), DUEL_RULES, DUEL_SCENARIO)
    expect(frame(result, 'player', 0).contacts).toEqual([])
    expect(frame(result, 'player', 1).contacts).toEqual([{ alias: 'contact-1', kind: 'current', ageTicks: 0, uncertaintyRadiusUnits: 0, measurement: { position: { x: 16_500, y: 10_500 }, tick: 1 } }])
    expect(frame(result, 'player', 20).ownShip.sensor).toBe('tracking')
    expect(frame(result, 'player', 20).contacts[0]).toMatchObject({ kind: 'current', measurement: { tick: 20 }, estimatedVelocity: { xUnitsPerTick: 0, yUnitsPerTick: 0 } })
    expect(frame(result, 'player', 21).ownShip.sensor).toBe('passive')
    expect(frame(result, 'player', 21).contacts[0]).toMatchObject({ kind: 'stale', ageTicks: 1, uncertaintyRadiusUnits: 100, measurement: { tick: 20 } })
    // The scanner is exposed (12 cells) to the passive patrol through tick 30.
    expect(frame(result, 'patrol', 30).contacts[0]).toMatchObject({ kind: 'current', measurement: { tick: 30, position: { x: 6500, y: 10_500 } } })
    expect(frame(result, 'patrol', 31).contacts[0]).toMatchObject({ kind: 'stale', ageTicks: 1, measurement: { tick: 30 } })
    expect(eventKinds(result, 'player')).toEqual(['1:own-energy', '1:contact-acquired', '21:contact-lost'])
    expect(eventKinds(result, 'patrol')).toEqual(['1:contact-acquired', '31:contact-lost'])
    expect(frame(result, 'player', 100).contacts[0]).toMatchObject({ kind: 'stale', ageTicks: 80, uncertaintyRadiusUnits: 8000 })
  })

  it('reacquires with the stable alias before expiry and issues a new alias after expiry', () => {
    const start = tenCellsApart()
    const first = resolveTurn(start, lock(start, pulse(0), hold(0)), DUEL_RULES, DUEL_SCENARIO)
    const s1 = first.nextState
    const again = resolveTurn(s1, lock(s1, pulse(1), hold(1)), DUEL_RULES, DUEL_SCENARIO)
    expect(frame(again, 'player', 100).contacts[0]).toMatchObject({ alias: 'contact-1', kind: 'stale', ageTicks: 80 })
    expect(frame(again, 'player', 101).contacts).toEqual([{
      alias: 'contact-1', kind: 'current', ageTicks: 0, uncertaintyRadiusUnits: 0, measurement: { position: { x: 16_500, y: 10_500 }, tick: 101 },
      previousMeasurement: { position: { x: 16_500, y: 10_500 }, tick: 20 }, estimatedVelocity: { xUnitsPerTick: 0, yUnitsPerTick: 0 },
    }])
    // 5 s memory: the tick-20 measurement expires at tick 70; the next pulse acquires contact-2.
    const shortMemory = createRuleset({ ...DUEL_CONFIG, version: 'short-memory', timing: { ...DUEL_CONFIG.timing, contactMemoryMs: 5000 } })
    const m0 = tenCellsApart(shortMemory)
    const forgotten = resolveTurn(m0, lock(m0, pulse(0), hold(0)), shortMemory, DUEL_SCENARIO)
    expect(frame(forgotten, 'player', 69).contacts[0]).toMatchObject({ alias: 'contact-1', kind: 'stale', ageTicks: 49 })
    expect(frame(forgotten, 'player', 70).contacts).toEqual([])
    expect(frame(forgotten, 'player', 70).events).toEqual([{ id: 't70-000', tick: 70, kind: 'contact-expired', alias: 'contact-1' }])
    const m1 = forgotten.nextState
    const fresh = resolveTurn(m1, lock(m1, pulse(1), hold(1)), shortMemory, DUEL_SCENARIO)
    expect(frame(fresh, 'player', 101).contacts).toEqual([{ alias: 'contact-2', kind: 'current', ageTicks: 0, uncertaintyRadiusUnits: 0, measurement: { position: { x: 16_500, y: 10_500 }, tick: 101 } }])
  })

  it('carries tracking/exposure clocks across short configured turns; a later cloak order waits for exposure to end', () => {
    // 1 s turns (10 ticks): tracking spans 2 turns and exposure 3.
    const rules = createRuleset({ ...DUEL_CONFIG, version: 'short-turns', timing: { ...DUEL_CONFIG.timing, turnMs: 1000 } })
    let state = initialiseSession(DUEL_SCENARIO, rules, SEED)
    const turns: TurnResolution[] = []
    const plan: TurnOrders[] = [pulse(0, true), hold(1, true), hold(2, true), hold(3, true)]
    const validations: string[][] = []
    for (const draft of plan) {
      validations.push(issueCodes(state, draft, rules))
      const result = resolveTurn(state, lock(state, draft, hold(draft.turnIndex)), rules, DUEL_SCENARIO)
      turns.push(result)
      state = result.nextState
    }
    expect(validations).toEqual([['cloak:warning:activity-breaks-cloak'], ['cloak:conditional:cloak-exposure'], ['cloak:conditional:cloak-exposure'], []])
    expect(validateOrders(hold(1, true), observeSide(turns[0].nextState, 'player', rules, DUEL_SCENARIO), rules).issues)
      .toEqual([{ field: 'cloak', severity: 'conditional', code: 'cloak-exposure', details: { readyTick: 31 } }])
    const own = (turn: number, tick: number) => frame(turns[turn], 'player', tick).ownShip
    expect(own(0, 10)).toMatchObject({ sensor: 'tracking', cloak: { state: 'latched-activity' }, clocks: { trackingUntilTick: 21, exposureUntilTick: 31 } })
    expect(own(1, 10)).toMatchObject({ sensor: 'tracking', cloak: { requested: true, actual: false, state: 'suppressed-exposure' }, turnActions: { pulseAttemptSpent: false } })
    expect(own(1, 20).sensor).toBe('tracking')
    expect(own(2, 21).sensor).toBe('passive')
    // Suppressed cloak costs nothing: +200/tick from 87,700 at tick 1.
    expect(own(2, 30)).toMatchObject({ energy: { currentMilli: 87_700 + 29 * 200 }, cloak: { state: 'suppressed-exposure' } })
    expect(own(3, 31)).toMatchObject({ energy: { currentMilli: 87_700 + 30 * 200 - 300 }, cloak: { requested: true, actual: true, state: 'active' } })
    expect(frame(turns[3], 'player', 31).events).toEqual([{ id: 't31-000', tick: 31, kind: 'own-cloak', cloak: { requested: true, actual: true, state: 'active' } }])
    expect(turns.map((turn) => turn.presentations.player.assessment.sensorAttempt.kind)).toEqual(['succeeded', 'not-requested', 'not-requested', 'not-requested'])
  })

  it('extends rather than resets clocks when a later short turn pulses again', () => {
    const rules = createRuleset({ ...DUEL_CONFIG, version: 'short-turns', timing: { ...DUEL_CONFIG.timing, turnMs: 1000 } })
    const s0 = initialiseSession(DUEL_SCENARIO, rules, SEED)
    const s1 = resolveTurn(s0, lock(s0, pulse(0), hold(0)), rules, DUEL_SCENARIO).nextState
    const second = resolveTurn(s1, lock(s1, pulse(1), hold(1)), rules, DUEL_SCENARIO)
    expect(frame(second, 'player', 11).ownShip.clocks).toMatchObject({ trackingUntilTick: 31, exposureUntilTick: 41 })
    expect(frame(second, 'player', 11).events.map((event) => event.kind)).toEqual(['own-energy'])
  })
})

describe('observer safety, determinism and evaluation order', () => {
  it('gives the player identical frames, events, assessment, validation and previews whatever the unseen patrol scans', () => {
    const s0 = initialiseSession(DUEL_SCENARIO, DUEL_RULES, SEED)
    const drained = withShip(s0, 'patrol', { energyMilli: 1000 })
    const worlds = [
      resolveTurn(s0, lock(s0, hold(0, true), hold(0)), DUEL_RULES, DUEL_SCENARIO),
      resolveTurn(s0, lock(s0, hold(0, true), pulse(0)), DUEL_RULES, DUEL_SCENARIO),
      resolveTurn(drained, lock(drained, hold(0, true), pulse(0)), DUEL_RULES, DUEL_SCENARIO),
    ]
    expect(worlds.map((world) => world.presentations.patrol.assessment.sensorAttempt.kind)).toEqual(['not-requested', 'succeeded', 'failed'])
    for (const world of worlds.slice(1)) {
      expect(world.presentations.player).toEqual(worlds[0].presentations.player)
      const view = observeSide(world.nextState, 'player', DUEL_RULES, DUEL_SCENARIO)
      expect(view).toEqual(observeSide(worlds[0].nextState, 'player', DUEL_RULES, DUEL_SCENARIO))
      const draft = orders(1, { column: 10, row: 10 }, true, 'activePulse')
      expect(validateOrders(draft, view, DUEL_RULES)).toEqual(validateOrders(draft, observeSide(worlds[0].nextState, 'player', DUEL_RULES, DUEL_SCENARIO), DUEL_RULES))
      expect(previewRoute(draft.movement, view.ownShip, view.map, DUEL_RULES)).toEqual(previewRoute(draft.movement, observeSide(worlds[0].nextState, 'player', DUEL_RULES, DUEL_SCENARIO).ownShip, view.map, DUEL_RULES))
    }
  })

  it('publishes no private keys while both sides scan and detect each other', () => {
    const start = tenCellsApart()
    const result = resolveTurn(start, lock(start, pulse(0), pulse(0)), DUEL_RULES, DUEL_SCENARIO)
    expect(eventKinds(result, 'patrol')).toEqual(['1:own-energy', '1:contact-acquired', '31:contact-lost'])
    for (const side of ['player', 'patrol'] as const) {
      const json = JSON.stringify([result.presentations[side], observeSide(result.nextState, side, DUEL_RULES, DUEL_SCENARIO)])
      for (const key of HIDDEN_KEYS) expect(json).not.toContain(`"${key}"`)
      expect(json).not.toContain('-ship')
    }
  })

  it('is reproducible, draws no random numbers and is independent of side evaluation order', () => {
    const start = tenCellsApart()
    const turn = lock(start, pulse(0), orders(0, { column: 13, row: 10 }, false, 'activePulse'))
    const result = resolveTurn(start, turn, DUEL_RULES, DUEL_SCENARIO)
    expect(resolveTurn(start, turn, DUEL_RULES, DUEL_SCENARIO)).toEqual(result)
    expect(JSON.stringify(resolveTurnInOrder(start, turn, DUEL_RULES, DUEL_SCENARIO, ['patrol', 'player']))).toBe(JSON.stringify(result))
    expect(result.nextState.random).toEqual(start.random)
    expect(Object.isFrozen(result.presentations.player.frames[1].events[0])).toBe(true)
  })
})
