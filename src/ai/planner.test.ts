import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ContactMemory, HostileOrdnanceMemory, PlannerMemory, SideObservation, TurnOrders } from '../contracts'
import { DUEL_RULES } from '../contracts'
// Test-only verification through the real engine; the planner itself imports public contracts only.
import { DUEL_SCENARIO } from '../scenarios/private'
import { initialiseSession, observeSide, resolveTurn, validateOrders } from '../simulation'
import { lock, orders, withShip } from '../simulation/testSupport'
import { createOpponentPlanner, planOpponent } from './index'
import { segmentClear } from './navigation'
import { nextRandom } from './random'

const SEED = 40
const start = initialiseSession(DUEL_SCENARIO, DUEL_RULES, SEED)
const patrolView = observeSide(start, 'patrol', DUEL_RULES, DUEL_SCENARIO)
const freshMemory = start.plannerMemory.patrol
const rng = start.random.planners.patrol

/** Public-shape observation of the patrol at its spawn (16,10), with chosen own facts and knowledge. */
function view(patch: { tick?: number; contacts?: ContactMemory[]; hostileMissiles?: HostileOrdnanceMemory[]; own?: Partial<SideObservation['ownShip']>; destroyedTick?: number } = {}): SideObservation {
  return {
    ...patrolView, tick: patch.tick ?? patrolView.tick, contacts: patch.contacts ?? [], hostileMissiles: patch.hostileMissiles ?? [],
    ownShip: { ...patrolView.ownShip, ...patch.own },
    ...(patch.destroyedTick === undefined ? {} : { observedOpponentDestructionTick: patch.destroyedTick }),
  }
}
const current = (x: number, y: number, velocity?: { xUnitsPerTick: number; yUnitsPerTick: number }): ContactMemory => ({
  alias: 'contact-1', kind: 'current', ageTicks: 0, uncertaintyRadiusUnits: 0, measurement: { position: { x, y }, tick: 0 },
  ...(velocity === undefined ? {} : { previousMeasurement: { position: { x: x - velocity.xUnitsPerTick, y: y - velocity.yUnitsPerTick }, tick: -1 }, estimatedVelocity: velocity }),
})
/** A stale contact at observation tick `now`, measured `ageTicks` earlier. */
const stale = (x: number, y: number, ageTicks: number, now = 0): ContactMemory => ({
  alias: 'contact-1', kind: 'stale', ageTicks, uncertaintyRadiusUnits: ageTicks * 100, measurement: { position: { x, y }, tick: now - ageTicks },
})
const memoryWith = (patch: Partial<PlannerMemory>): PlannerMemory => ({ ...freshMemory, ...patch })
const legal = (observation: SideObservation, planned: TurnOrders) => validateOrders(planned, observation, DUEL_RULES)

describe('policy state machine from own knowledge', () => {
  it('patrols seeded waypoints, engages a current contact, investigates its loss, searches, then patrols again', () => {
    const patrol = planOpponent(view(), freshMemory, rng)
    expect(patrol.memory).toMatchObject({ policy: 'PATROL', patrolIndex: 0, searchDestination: null })
    expect(patrol.memory.patrolOrder).toHaveLength(8)
    expect(patrol.orders.movement).toEqual({ kind: 'destination', cell: patrol.memory.patrolOrder[0] })
    const engage = planOpponent(view({ contacts: [current(10_500, 10_500)] }), patrol.memory, patrol.plannerRandomState)
    expect(engage.memory.policy).toBe('ENGAGE')
    expect(engage.orders.weapon).toEqual({ kind: 'laser', contactAlias: 'contact-1' })
    // Lost: investigate the last measurement (no velocity known), keeping a conditional laser on the stale alias.
    const lost = view({ contacts: [stale(10_500, 10_500, 20)] })
    const investigate = planOpponent(lost, engage.memory, engage.plannerRandomState)
    expect(investigate.memory).toMatchObject({ policy: 'INVESTIGATE', searchDestination: { column: 10, row: 10 } })
    expect(investigate.orders).toMatchObject({ movement: { kind: 'destination', cell: { column: 10, row: 10 } }, weapon: { kind: 'laser', contactAlias: 'contact-1' } })
    expect(validateOrders(investigate.orders, lost, DUEL_RULES).issues.map((issue) => issue.code)).toContain('awaiting-current-lock')
    // A turn later, arrived without reacquiring (the same measurement, now older): search a seeded point inside the uncertainty disc.
    const arrived = view({ tick: 100, contacts: [stale(10_500, 10_500, 120, 100)], own: { position: { x: 10_500, y: 10_500 } } })
    const search = planOpponent(arrived, investigate.memory, investigate.plannerRandomState)
    expect(search.memory.policy).toBe('SEARCH')
    expect(search.memory.searchDestination).not.toBeNull()
    expect(Math.max(Math.abs((search.memory.searchDestination?.column ?? 0) - 10), Math.abs((search.memory.searchDestination?.row ?? 0) - 10))).toBeGreaterThan(1)
    expect(legal(arrived, search.orders).structurallyValid).toBe(true)
    // Memory expired: back to the seeded patrol.
    const forgotten = planOpponent(view({ own: { position: { x: 10_500, y: 10_500 } } }), search.memory, search.plannerRandomState)
    expect(forgotten.memory).toMatchObject({ policy: 'PATROL', searchDestination: null, patrolOrder: patrol.memory.patrolOrder })
  })

  it('re-investigates a newer sighting of a stale contact instead of finishing an outdated route (TSB-51 D2)', () => {
    // Remembered at tick -60 near (10,13) heading south; seen briefly again at tick -40 at (8,10), stale again at planning.
    const south = { estimatedVelocity: { xUnitsPerTick: 0, yUnitsPerTick: 100 } }
    const old = { ...stale(10_500, 13_700, 60), ...south }
    for (const policy of ['INVESTIGATE', 'SEARCH'] as const) {
      const memory = memoryWith({ policy, searchDestination: { column: 10, row: 19 }, rememberedContacts: [old] })
      const unchanged = planOpponent(view({ tick: 100, contacts: [{ ...stale(10_500, 13_700, 160, 100), ...south }] }), memory, rng)
      expect(unchanged.memory).toMatchObject({ policy, searchDestination: { column: 10, row: 19 } })
      const newer = planOpponent(view({ tick: 100, contacts: [stale(8500, 10_500, 140, 100)] }), memory, rng)
      expect(newer.memory).toMatchObject({ policy: 'INVESTIGATE', searchDestination: { column: 8, row: 10 } })
      expect(newer.orders.movement).toEqual({ kind: 'destination', cell: { column: 8, row: 10 } })
    }
  })

  it('reacquires honestly: a stale contact seen again returns to ENGAGE under the same alias', () => {
    const investigating = memoryWith({ policy: 'INVESTIGATE', searchDestination: { column: 12, row: 10 } })
    const again = planOpponent(view({ contacts: [current(12_500, 10_500)] }), investigating, rng)
    expect(again.memory.policy).toBe('ENGAGE')
    expect(again.orders.weapon).toEqual({ kind: 'laser', contactAlias: 'contact-1' })
  })

  it('seeds patrol order, search points and scans from the explicit random state only', () => {
    const a = planOpponent(view(), freshMemory, rng)
    expect(planOpponent(view(), freshMemory, rng)).toEqual(a)
    const orders = new Set([0, 1, 2, 3, 4, 5].map((offset) => JSON.stringify(planOpponent(view(), freshMemory, (rng + offset * 7919) >>> 0).memory.patrolOrder)))
    expect(orders.size).toBeGreaterThan(1)
    expect(a.plannerRandomState).not.toBe(rng)
    expect(Number.isInteger(a.plannerRandomState) && a.plannerRandomState >= 0 && a.plannerRandomState <= 0xffff_ffff).toBe(true)
    expect(() => planOpponent(view(), freshMemory, -1)).toThrow('uint32')
    expect(nextRandom(7)).toEqual(nextRandom(7))
  })
})

describe('legal, resource-aware tactics', () => {
  it('leads a plotted missile from measured motion, outside its own blast and clear of asteroids', () => {
    // Contact 8 cells west moving north at 80/tick: flight ≈ 41 ticks, lead ≈ 3,280 units north.
    const moving = view({ contacts: [current(8500, 10_500, { xUnitsPerTick: 0, yUnitsPerTick: -80 })], own: { clocks: { ...patrolView.ownShip.clocks, laserReadyTick: 500 } } })
    const plan = planOpponent(moving, memoryWith({ policy: 'ENGAGE' }), rng)
    expect(plan.orders.weapon).toEqual({ kind: 'missile', aim: { column: 8, row: 7 } })
    expect(legal(moving, plan.orders)).toEqual({ structurallyValid: true, issues: [] })
    // The same geometry with an asteroid in the way, or the target too close, plots nothing.
    const behindRock = view({ contacts: [current(6500, 4500)], own: { position: { x: 10_500, y: 4500 }, clocks: { ...patrolView.ownShip.clocks, laserReadyTick: 500 } } })
    expect(planOpponent(behindRock, memoryWith({ policy: 'ENGAGE' }), rng).orders.weapon.kind).not.toBe('missile')
    const close = view({ contacts: [current(14_500, 10_500)], own: { clocks: { ...patrolView.ownShip.clocks, laserReadyTick: 500 } } })
    expect(planOpponent(close, memoryWith({ policy: 'ENGAGE' }), rng).orders.weapon.kind).not.toBe('missile')
  })

  it('respects ammunition, cooldowns, energy reserve and equipment', () => {
    const far = (own: Partial<SideObservation['ownShip']>) => view({ contacts: [current(8500, 10_500)], own })
    const clocks = { ...patrolView.ownShip.clocks, laserReadyTick: 500 }
    expect(planOpponent(far({ clocks, ammunition: { current: 0, max: 4 } }), memoryWith({}), rng).orders.weapon.kind).toBe('hold')
    expect(planOpponent(far({ clocks: { ...clocks, missileReadyTick: 50 } }), memoryWith({}), rng).orders.weapon.kind).toBe('hold')
    expect(planOpponent(far({ clocks, energy: { currentMilli: 29_999, maxMilli: 100_000 } }), memoryWith({}), rng).orders.weapon.kind).toBe('hold')
    expect(planOpponent(far({ clocks, energy: { currentMilli: 30_000, maxMilli: 100_000 } }), memoryWith({}), rng).orders.weapon.kind).toBe('missile')
    const poor = view({ contacts: [current(12_500, 10_500)], own: { energy: { currentMilli: 37_999, maxMilli: 100_000 } } })
    expect(planOpponent(poor, memoryWith({}), rng).orders.weapon.kind).not.toBe('laser')
    const unarmed = view({ contacts: [current(12_500, 10_500)], own: { equipment: { cloak: false, activeSensor: false, laser: false, missileLauncher: false } } })
    const plan = planOpponent(unarmed, memoryWith({}), rng)
    expect(plan.orders).toMatchObject({ sensor: 'passive', cloak: false, weapon: { kind: 'hold' } })
    // Never pulses without energy for the pulse plus reserve, whatever the random state.
    const drained = view({ contacts: [stale(10_500, 10_500, 30)], own: { energy: { currentMilli: 31_999, maxMilli: 100_000 } } })
    for (let offset = 0; offset < 20; offset++) expect(planOpponent(drained, memoryWith({ policy: 'SEARCH' }), (rng + offset) >>> 0).orders.sensor).toBe('passive')
  })

  it('scans only where a pulse can help, and sometimes', () => {
    const nearby = view({ contacts: [stale(10_500, 10_500, 30)] })
    const sensors = new Set(Array.from({ length: 16 }, (_, offset) => planOpponent(nearby, memoryWith({ policy: 'SEARCH', searchDestination: { column: 12, row: 12 } }), (rng + offset * 104_729) >>> 0).orders.sensor))
    expect(sensors).toEqual(new Set(['passive', 'activePulse']))
    // A remembered position beyond the active range from here: never worth a first-tick pulse.
    const distant = view({ contacts: [stale(1500, 10_500, 10)] })
    for (let offset = 0; offset < 16; offset++) expect(planOpponent(distant, memoryWith({ policy: 'SEARCH', searchDestination: { column: 3, row: 10 } }), (rng + offset) >>> 0).orders.sensor).toBe('passive')
  })

  it('disengages when weak, evades known ordnance and holds fire after a confirmed kill', () => {
    const weak = view({ contacts: [current(12_500, 10_500)], own: { hull: { current: 30, max: 100 } } })
    const flee = planOpponent(weak, memoryWith({ policy: 'ENGAGE' }), rng)
    // The uncloakable frigate stays visible to a contact this close, so it returns fire while withdrawing (TSB-51 D1).
    expect(flee.orders.weapon).toEqual({ kind: 'laser', contactAlias: 'contact-1' })
    expect(legal(weak, flee.orders).structurallyValid).toBe(true)
    // A cloak-equipped hull in the same spot holds fire so that it can cloak away instead.
    const cloaker = view({ contacts: [current(12_500, 10_500)], own: { hull: { current: 30, max: 100 }, shipClass: 'shadow-dancer', equipment: { ...patrolView.ownShip.equipment, cloak: true } } })
    expect(planOpponent(cloaker, memoryWith({ policy: 'ENGAGE' }), rng).orders).toMatchObject({ weapon: { kind: 'hold' }, cloak: true })
    expect(flee.orders.movement.kind).toBe('destination')
    if (flee.orders.movement.kind !== 'destination') throw new Error('destination expected')
    // Breaks contact into cover: farther than now (4 cells) and out of the contact's sightline.
    const refuge = { x: flee.orders.movement.cell.column * 1000 + 500, y: flee.orders.movement.cell.row * 1000 + 500 }
    expect(Math.hypot(refuge.x - 12_500, refuge.y - 10_500)).toBeGreaterThan(4000)
    expect(segmentClear(refuge, { x: 12_500, y: 10_500 }, patrolView.map, DUEL_RULES)).toBe(false)
    const missile: HostileOrdnanceMemory = { alias: 'missile-1', kind: 'current', ageTicks: 0, uncertaintyRadiusUnits: 0, measurement: { position: { x: 13_500, y: 10_500 }, tick: 0 } }
    const evade = planOpponent(view({ hostileMissiles: [missile], destroyedTick: 0 }), memoryWith({ policy: 'ENGAGE' }), rng)
    expect(evade.orders.weapon).toEqual({ kind: 'hold' })
    expect(evade.orders.sensor).toBe('passive')
    if (evade.orders.movement.kind !== 'destination') throw new Error('evasion expected')
    expect(Math.max(Math.abs(evade.orders.movement.cell.column - 16), Math.abs(evade.orders.movement.cell.row - 10))).toBeGreaterThanOrEqual(3)
    expect(evade.memory.observedOpponentDestructionTick).toBe(0)
    // Remembered kill with no known ordnance: keep station, weapons safe, even with a stale contact.
    const settled = planOpponent(view({ contacts: [stale(10_500, 10_500, 5)] }), evade.memory, evade.plannerRandomState)
    expect(settled.orders).toMatchObject({ movement: { kind: 'hold' }, weapon: { kind: 'hold' }, sensor: 'passive' })
  })

  it('always returns structurally valid, reachable orders across many own-knowledge situations', () => {
    const cases: SideObservation[] = []
    for (let column = 0; column < 20; column += 3) {
      for (let row = 0; row < 20; row += 3) {
        if (patrolView.map.asteroidCells.some((rock) => rock.column === column && rock.row === row)) continue
        const at = { x: column * 1000 + 500, y: row * 1000 + 500 }
        cases.push(view({ contacts: [current(at.x, at.y, { xUnitsPerTick: 60, yUnitsPerTick: -40 })] }), view({ contacts: [stale(at.x, at.y, 90)] }))
      }
    }
    let state = rng
    const chosen = new Set<string>()
    for (const observation of cases) {
      for (const policy of ['PATROL', 'INVESTIGATE', 'ENGAGE', 'SEARCH'] as const) {
        const plan = planOpponent(observation, memoryWith({ policy }), state)
        state = plan.plannerRandomState
        chosen.add(`${plan.orders.weapon.kind}/${plan.orders.sensor}/${plan.orders.movement.kind}`)
        expect(legal(observation, plan.orders).structurallyValid).toBe(true)
      }
    }
    // The sweep covers lasers, plotted missiles, pulses and movement, all accepted by the engine.
    expect([...chosen].some((choice) => choice.startsWith('missile/'))).toBe(true)
    expect([...chosen].some((choice) => choice.startsWith('laser/'))).toBe(true)
    expect([...chosen].some((choice) => choice.includes('/activePulse/'))).toBe(true)
  })
})

describe('information boundaries and purity', () => {
  it('decides identically from identical observations whatever the hidden player does', () => {
    // Same patrol view, different hidden player facts and orders: the player sits cloaked 13 cells away.
    const worldA = withShip(start, 'player', { energyMilli: 40_000 })
    const worldB = withShip(start, 'player', { hull: 5, shields: 0 })
    const a = resolveTurn(worldA, lock(worldA, orders(0, { column: 5, row: 8 }, true), orders(0, null)), DUEL_RULES, DUEL_SCENARIO).nextState
    const b = resolveTurn(worldB, lock(worldB, orders(0, null, true), orders(0, null)), DUEL_RULES, DUEL_SCENARIO).nextState
    const viewA = observeSide(a, 'patrol', DUEL_RULES, DUEL_SCENARIO)
    expect(viewA).toEqual(observeSide(b, 'patrol', DUEL_RULES, DUEL_SCENARIO))
    expect(planOpponent(viewA, a.plannerMemory.patrol, a.random.planners.patrol))
      .toEqual(planOpponent(observeSide(b, 'patrol', DUEL_RULES, DUEL_SCENARIO), b.plannerMemory.patrol, b.random.planners.patrol))
  })

  it('never mutates its frozen inputs and returns a skip-safe hold for a destroyed ship', () => {
    const observation = Object.freeze(view({ contacts: [current(10_500, 10_500)] }))
    const before = JSON.stringify([observation, freshMemory])
    planOpponent(observation, freshMemory, rng)
    expect(JSON.stringify([observation, freshMemory])).toBe(before)
    const dead = planOpponent(view({ own: { status: 'destroyed' } }), freshMemory, rng)
    expect(dead).toEqual({ orders: { turnIndex: 0, movement: { kind: 'hold' }, sensor: 'passive', cloak: false, weapon: { kind: 'hold' } }, memory: freshMemory, plannerRandomState: rng })
    expect(createOpponentPlanner(DUEL_RULES)(observation, freshMemory, rng)).toEqual(planOpponent(observation, freshMemory, rng))
  })

  it('imports only public contracts and local modules, with no clock, global randomness or network', () => {
    const folder = join(process.cwd(), 'src/ai')
    for (const file of readdirSync(folder).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
      const source = readFileSync(join(folder, file), 'utf8')
      const specifiers = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1])
      for (const specifier of specifiers) expect([`${file}:${specifier}`]).toEqual([expect.stringMatching(/:(\.\.\/contracts|\.\/[a-z]+)$/)])
      expect(source).not.toMatch(/Math\.random|Date\.|performance\.|fetch\(|localStorage|globalThis/)
    }
  })
})
