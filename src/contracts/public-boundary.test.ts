import { describe, expect, it } from 'vitest'
import * as publicApi from './index'
import { DUEL_SCENARIO, publicScenario } from '../scenarios/private'
import type { ContactMemory, HostileOrdnanceMemory, TurnOrders } from './index'

// Compile-time regression: the public barrel must not acquire these exports/fields.
// @ts-expect-error SimulationState is engine/application-only
export type HiddenState = import('./index').SimulationState
// @ts-expect-error Scenario includes hidden spawns
export type HiddenScenario = import('./index').Scenario
// @ts-expect-error Whole presentations contain future frames
export type FuturePresentation = import('./index').TurnPresentation
// @ts-expect-error No plotted aim in hostile memory
export type HiddenAim = HostileOrdnanceMemory['aim']
// @ts-expect-error Observer contacts have no authoritative entity ID
export type HiddenEntityId = ContactMemory['entityId']

describe('public boundary and JSON examples', () => {
  it('exports only safe constants and geometry/config helpers at runtime', () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      'DUEL_MAP', 'DUEL_PUBLIC_SCENARIO', 'DUEL_RULES', 'SAMPLE_PLAYER_OBSERVATION',
      'aftermathWindowBound', 'cellCentre', 'isAsteroidCell', 'isMapCell',
    ].sort())
  })
  it('public serialization stays identical when the hidden opposing spawn changes', () => {
    const changed = {
      ...DUEL_SCENARIO,
      spawns: { ...DUEL_SCENARIO.spawns, patrol: { ...DUEL_SCENARIO.spawns.patrol, cell: { column: 19, row: 19 } } },
    }
    expect(JSON.stringify(publicScenario(changed))).toBe(JSON.stringify(publicScenario(DUEL_SCENARIO)))
    expect(JSON.stringify(publicScenario(changed))).not.toContain('spawns')
    expect(publicScenario(changed).map).not.toBe(changed.map)
  })
  it('whitelists public fields instead of copying extra diagnostic data through nested spreads', () => {
    const augmented = {
      ...DUEL_SCENARIO, privateDiagnostic: 'hidden',
      map: {
        ...DUEL_SCENARIO.map, hiddenTrack: { x: 16_500, y: 10_500 },
        asteroidCells: DUEL_SCENARIO.map.asteroidCells.map((cell) => ({ ...cell, entityId: 'hidden' })),
      },
    }
    expect(publicScenario(augmented)).toEqual(publicApi.DUEL_PUBLIC_SCENARIO)
    expect(JSON.stringify(publicScenario(augmented))).not.toContain('hidden')
  })
  it('sample starts with only own gauges and no enemy contact, orders, coordinates or seed', () => {
    const observation = publicApi.SAMPLE_PLAYER_OBSERVATION
    expect(observation.contacts).toEqual([])
    expect(observation.hostileMissiles).toEqual([])
    expect(observation.ownMissiles).toEqual([])
    expect(observation.ownShip.position).toEqual({ x: 3500, y: 10_500 })
    expect(observation.ownShip.hull).toEqual({ current: 100, max: 100 })
    expect(observation.ownShip.shields).toEqual({ current: 40, max: 40 })
    expect(observation.ownShip.energy).toEqual({ currentMilli: 100_000, maxMilli: 100_000 })
    expect(observation.outcome).toBeUndefined()
    const json = JSON.stringify(observation)
    for (const key of ['spawns', 'entityId', 'targetEntityId', 'launcherEntityId', 'seed', 'random', 'plannerMemory', 'internalEvents', 'terminalPending', 'acceptedTurns', 'presentations']) {
      expect(json).not.toContain(`"${key}"`)
    }
    expect(json).not.toContain('16500')
    expect(JSON.parse(json)).toEqual(observation)
    expect(Object.isFrozen(observation.ownShip.route.waypoints)).toBe(true)
  })
  it('represents observer-local stale contact velocity, age and uncertainty without a hidden track', () => {
    const contact: ContactMemory = {
      alias: 'contact-1', kind: 'stale', measurement: { position: { x: 8500, y: 10_500 }, tick: 10 },
      previousMeasurement: { position: { x: 8400, y: 10_500 }, tick: 9 },
      estimatedVelocity: { xUnitsPerTick: 100, yUnitsPerTick: 0 }, ageTicks: 10, uncertaintyRadiusUnits: 1000,
    }
    expect(JSON.parse(JSON.stringify(contact))).toEqual(contact)
    expect(Object.keys(contact)).not.toContain('entityId')
    expect(contact.measurement.tick + contact.ageTicks).toBe(20)
    const orders: TurnOrders = { turnIndex: 2, movement: { kind: 'hold' }, sensor: 'passive', cloak: true, weapon: { kind: 'laser', contactAlias: contact.alias } }
    expect(orders.weapon).toEqual({ kind: 'laser', contactAlias: 'contact-1' })
  })
})
