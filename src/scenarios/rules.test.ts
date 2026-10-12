import { describe, expect, it } from 'vitest'
import { createRuleset, DUEL_CONFIG, aftermathWindowBound } from './rules'
import { DUEL_RULES } from './public'

describe('duel-v1 approved numeric defaults', () => {
  it('derives every clock from milliseconds', () => {
    expect(DUEL_RULES.timing).toEqual({
      tickMs: 100, turnMs: 10_000, turnTicks: 100, trackingTicks: 20, exposureTicks: 30,
      contactMemoryTicks: 600, laserCooldownTicks: 50, missileCooldownTicks: 100, missileLifetimeTicks: 150,
    })
    const rules = createRuleset({ ...DUEL_CONFIG, timing: { ...DUEL_CONFIG.timing, tickMs: 50 } })
    expect(rules.timing.turnTicks).toBe(200)
    expect(rules.timing.trackingTicks).toBe(40)
    expect(rules.timing.missileLifetimeTicks).toBe(300)
    expect(rules.ships['shadow-dancer'].speedUnitsPerTick).toBe(50)
    expect(rules.ships['patrol-frigate'].speedUnitsPerTick).toBe(40)
    expect(rules.ships['shadow-dancer'].regenerationMilliPerTick).toBe(100)
    expect(rules.ships['shadow-dancer'].cloakMilliPerTick).toBe(150)
    expect(rules.missile.speedUnitsPerTick).toBe(100)
  })
  it('matches geometry, ranges, activity costs and weapons', () => {
    expect(DUEL_RULES.geometry).toEqual({ unitsPerCell: 1000, shipRadiusUnits: 250, missileRadiusUnits: 100, cardinalRouteCost: 1000, diagonalRouteCost: 1414 })
    expect(DUEL_RULES.sensors).toEqual({
      passiveUncloakedRangeUnits: 7000, passiveCloakedRangeUnits: 3000,
      activeUncloakedRangeUnits: 10_000, activeCloakedRangeUnits: 7000,
      movingSignatureBonusUnits: 1000, exposedRangeUnits: 12_000,
      passiveMissileRangeUnits: 7000, activeMissileRangeUnits: 10_000, pulseCostMilli: 12_000,
    })
    expect(DUEL_RULES.laser).toEqual({ costMilli: 18_000, damage: 35, rangeUnits: 6000 })
    expect(DUEL_RULES.missile).toEqual({ costMilli: 10_000, damage: 45, speedUnitsPerSecond: 2000, speedUnitsPerTick: 200, blastRadiusUnits: 750 })
    expect(DUEL_RULES.maxShipSpeedUnitsPerTick).toBe(100)
    expect(DUEL_RULES.diagnosticTurnLimit).toBe(200)
  })
  it('matches both ship loadouts, milli-energy rates and display gauges', () => {
    expect(DUEL_RULES.ships['shadow-dancer']).toEqual({
      name: 'Shadow-Dancer', speedUnitsPerSecond: 1000, speedUnitsPerTick: 100,
      maxHull: 100, maxShields: 40, startingEnergyMilli: 100_000, maxEnergyMilli: 100_000,
      regenerationMilliPerSecond: 2000, regenerationMilliPerTick: 200,
      propulsionMilliPerSecond: 1000, propulsionMilliPerTick: 100,
      cloakMilliPerSecond: 3000, cloakMilliPerTick: 300, missileAmmunition: 6,
      equipment: { cloak: true, activeSensor: true, laser: true, missileLauncher: true },
    })
    expect(DUEL_RULES.ships['patrol-frigate']).toEqual({
      name: 'Federation Patrol Frigate', speedUnitsPerSecond: 800, speedUnitsPerTick: 80,
      maxHull: 100, maxShields: 60, startingEnergyMilli: 100_000, maxEnergyMilli: 100_000,
      regenerationMilliPerSecond: 2000, regenerationMilliPerTick: 200,
      propulsionMilliPerSecond: 1000, propulsionMilliPerTick: 100,
      cloakMilliPerSecond: 0, cloakMilliPerTick: 0, missileAmmunition: 4,
      equipment: { cloak: false, activeSensor: true, laser: true, missileLauncher: true },
    })
  })
  it('bounds automatic windows from lifetime, turn duration and finite remaining ammo', () => {
    expect(aftermathWindowBound(DUEL_RULES, 0)).toBe(2)
    expect(aftermathWindowBound(DUEL_RULES, 4)).toBe(10)
    expect(aftermathWindowBound(DUEL_RULES, 6)).toBe(14)
    const shorter = createRuleset({ ...DUEL_CONFIG, timing: { ...DUEL_CONFIG.timing, turnMs: 5000 } })
    expect(aftermathWindowBound(shorter, 4)).toBe(15)
    expect(() => aftermathWindowBound(DUEL_RULES, -1)).toThrow()
    expect(() => aftermathWindowBound(DUEL_RULES, 0.5)).toThrow()
  })
})

describe('central configuration validation', () => {
  it.each(['turnMs', 'trackingMs', 'exposureMs', 'contactMemoryMs', 'laserCooldownMs', 'missileCooldownMs', 'missileLifetimeMs'] as const)('rejects a fractional tick duration in %s', (field) => {
    expect(() => createRuleset({ ...DUEL_CONFIG, timing: { ...DUEL_CONFIG.timing, [field]: DUEL_CONFIG.timing[field] + 1 } })).toThrow('integral tick multiple')
  })
  it.each([0, -100, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects invalid tickMs %s', (tickMs) => {
    expect(() => createRuleset({ ...DUEL_CONFIG, timing: { ...DUEL_CONFIG.timing, tickMs } })).toThrow()
  })
  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid numeric weapon costs %s', (costMilli) => {
    expect(() => createRuleset({ ...DUEL_CONFIG, laser: { ...DUEL_CONFIG.laser, costMilli } })).toThrow()
  })
  it('rejects fractional fixed-point speed and energy grants per tick', () => {
    expect(() => createRuleset({ ...DUEL_CONFIG, missile: { ...DUEL_CONFIG.missile, speedUnitsPerSecond: 2001 } })).toThrow('per tick')
    const ship = DUEL_CONFIG.ships['shadow-dancer']
    expect(() => createRuleset({ ...DUEL_CONFIG, ships: { ...DUEL_CONFIG.ships, 'shadow-dancer': { ...ship, regenerationMilliPerSecond: 2001 } } })).toThrow('per tick')
  })
  it('rejects starting energy exceeding max, fractional ammo and unequipped cloak cost', () => {
    const ship = DUEL_CONFIG.ships['shadow-dancer']
    expect(() => createRuleset({ ...DUEL_CONFIG, ships: { ...DUEL_CONFIG.ships, 'shadow-dancer': { ...ship, startingEnergyMilli: 100_001 } } })).toThrow('capacity')
    expect(() => createRuleset({ ...DUEL_CONFIG, ships: { ...DUEL_CONFIG.ships, 'shadow-dancer': { ...ship, missileAmmunition: 6.5 } } })).toThrow()
    const patrol = DUEL_CONFIG.ships['patrol-frigate']
    expect(() => createRuleset({ ...DUEL_CONFIG, ships: { ...DUEL_CONFIG.ships, 'patrol-frigate': { ...patrol, cloakMilliPerSecond: 3000 } } })).toThrow('Unequipped cloak')
  })
  it('rejects inconsistent geometry', () => {
    expect(() => createRuleset({ ...DUEL_CONFIG, geometry: { ...DUEL_CONFIG.geometry, unitsPerCell: 1001 } })).toThrow('integral centre')
    expect(() => createRuleset({ ...DUEL_CONFIG, geometry: { ...DUEL_CONFIG.geometry, shipRadiusUnits: 501 } })).toThrow('fit a cell')
    expect(() => createRuleset({ ...DUEL_CONFIG, geometry: { ...DUEL_CONFIG.geometry, cardinalRouteCost: 999 } })).toThrow('Route costs')
  })
  it('copies input and recursively freezes the encounter rules', () => {
    const input = structuredClone(DUEL_CONFIG)
    const rules = createRuleset(input)
    expect(rules.ships['shadow-dancer'].equipment).not.toBe(input.ships['shadow-dancer'].equipment)
    expect(Object.isFrozen(rules.ships['shadow-dancer'].equipment)).toBe(true)
    expect(Object.isFrozen(rules.timing)).toBe(true)
    expect(Reflect.set(rules.timing, 'turnTicks', 1)).toBe(false)
    expect(JSON.parse(JSON.stringify(rules))).toEqual(rules)
  })
})
