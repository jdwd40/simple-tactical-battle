import { describe, expect, it } from 'vitest'
import { DUEL_MAP, DUEL_PUBLIC_SCENARIO, DUEL_RULES, SAMPLE_PLAYER_OBSERVATION } from '../contracts/index'
import { OBSERVER_FIXTURES } from './observers'
import { STARTUP_PRESENTATION } from './startup'

describe('public startup and observer fixtures', () => {
  it('loads the reviewed public scenario and initial own data without copying literals', () => {
    expect(STARTUP_PRESENTATION.scenario).toBe(DUEL_PUBLIC_SCENARIO)
    expect(STARTUP_PRESENTATION.rules).toBe(DUEL_RULES)
    expect(STARTUP_PRESENTATION.observation).toBe(SAMPLE_PLAYER_OBSERVATION)
    expect(STARTUP_PRESENTATION.scenario.map).toBe(DUEL_MAP)
    expect(OBSERVER_FIXTURES.none.contacts).toEqual([])
    expect(OBSERVER_FIXTURES.none.hostileMissiles).toEqual([])
    expect(OBSERVER_FIXTURES.none.events).toEqual([])
    expect(OBSERVER_FIXTURES.none.outcome).toBeUndefined()
  })
  it('keeps stale position at its measurement rather than advancing an unseen track', () => {
    const current = OBSERVER_FIXTURES.current.contacts[0]
    const stale = OBSERVER_FIXTURES.stale.contacts[0]
    expect(current.kind).toBe('current')
    expect(current.ageTicks).toBe(0)
    expect(stale.kind).toBe('stale')
    expect(stale.alias).toBe(current.alias)
    expect(stale.measurement).toBe(current.measurement)
    expect(stale.measurement.position).toEqual({ x: 10_500, y: 10_500 })
    expect(stale.measurement.tick).toBe(300)
    expect(stale.previousMeasurement?.tick).toBe(299)
    expect(stale.estimatedVelocity).toEqual({ xUnitsPerTick: 80, yUnitsPerTick: 0 })
    expect(stale.ageTicks).toBe(10)
    expect(stale.uncertaintyRadiusUnits).toBe(1000)
    expect(OBSERVER_FIXTURES.stale.tick).toBe(310)
  })
  it.each(['none', 'current', 'stale'] as const)('%s example is immutable observer-only JSON', (kind) => {
    const observation = OBSERVER_FIXTURES[kind]
    const json = JSON.stringify(observation)
    expect(JSON.parse(json)).toEqual(observation)
    for (const key of ['spawns', 'entityId', 'targetEntityId', 'launcherEntityId', 'seed', 'random', 'plannerMemory', 'internalEvents', 'terminalPending', 'acceptedTurns', 'presentations']) {
      expect(json).not.toContain(`"${key}"`)
    }
    expect(Object.isFrozen(observation)).toBe(true)
    expect(Object.isFrozen(observation.contacts)).toBe(true)
    if (observation.contacts.length) expect(Object.isFrozen(observation.contacts[0].measurement.position)).toBe(true)
  })
})
