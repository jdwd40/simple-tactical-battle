import type { Ruleset, ShipClass, ShipSpec } from '../contracts/public'
import { freezeData } from './freeze'

export type ShipConfig = Omit<ShipSpec, 'speedUnitsPerTick' | 'regenerationMilliPerTick' | 'propulsionMilliPerTick' | 'cloakMilliPerTick'>
export interface RulesConfig {
  readonly version: string
  readonly timing: {
    readonly tickMs: number; readonly turnMs: number; readonly trackingMs: number
    readonly exposureMs: number; readonly contactMemoryMs: number
    readonly laserCooldownMs: number; readonly missileCooldownMs: number; readonly missileLifetimeMs: number
  }
  readonly geometry: Ruleset['geometry']
  readonly sensors: Ruleset['sensors']
  readonly laser: Ruleset['laser']
  readonly missile: Omit<Ruleset['missile'], 'speedUnitsPerTick'>
  readonly ships: Readonly<Record<ShipClass, ShipConfig>>
  readonly diagnosticTurnLimit: number
}

function integer(value: number, name: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be a safe integer >= ${minimum}`)
}
function validateNumbers(value: object, prefix: string): void {
  for (const [key, child] of Object.entries(value)) {
    const name = `${prefix}.${key}`
    if (typeof child === 'number') integer(child, name)
    else if (child !== null && typeof child === 'object') validateNumbers(child, name)
  }
}
function ratePerTick(rate: number, tickMs: number, name: string): number {
  const product = rate * tickMs
  integer(product, `${name} * tickMs`)
  const result = product / 1000
  integer(result, `${name} per tick`)
  return result
}

/** Copies, validates and freezes configuration. Derived clocks/rates have one source. */
export function createRuleset(config: RulesConfig): Ruleset {
  validateNumbers(config, 'rules')
  if (!config.version.trim()) throw new Error('rules.version must not be empty')
  const t = config.timing
  integer(t.tickMs, 'tickMs', 1)
  const ticks = (ms: number, name: string): number => {
    integer(ms, name, 1)
    if (ms % t.tickMs !== 0) throw new Error(`${name} must be an integral tick multiple`)
    return ms / t.tickMs
  }
  const timing: Ruleset['timing'] = {
    tickMs: t.tickMs, turnMs: t.turnMs, turnTicks: ticks(t.turnMs, 'turnMs'),
    trackingTicks: ticks(t.trackingMs, 'trackingMs'), exposureTicks: ticks(t.exposureMs, 'exposureMs'),
    contactMemoryTicks: ticks(t.contactMemoryMs, 'contactMemoryMs'),
    laserCooldownTicks: ticks(t.laserCooldownMs, 'laserCooldownMs'),
    missileCooldownTicks: ticks(t.missileCooldownMs, 'missileCooldownMs'),
    missileLifetimeTicks: ticks(t.missileLifetimeMs, 'missileLifetimeMs'),
  }
  const g = config.geometry
  for (const [name, value] of Object.entries(g)) integer(value, name, 1)
  if (g.unitsPerCell % 2 !== 0) throw new Error('unitsPerCell must have an integral centre')
  if (g.shipRadiusUnits * 2 > g.unitsPerCell) throw new Error('Ship diameter must fit a cell')
  if (g.cardinalRouteCost !== g.unitsPerCell || g.diagonalRouteCost <= g.cardinalRouteCost) {
    throw new Error('Route costs must match cardinal geometry and a longer diagonal')
  }
  integer(config.diagnosticTurnLimit, 'diagnosticTurnLimit', 1)
  integer(config.laser.damage, 'laser.damage', 1)
  integer(config.laser.rangeUnits, 'laser.rangeUnits', 1)
  integer(config.missile.damage, 'missile.damage', 1)
  integer(config.missile.speedUnitsPerSecond, 'missile.speedUnitsPerSecond', 1)
  const ship = (c: ShipConfig): ShipSpec => {
    if (!c.name.trim()) throw new Error('Ship name must not be empty')
    integer(c.speedUnitsPerSecond, `${c.name}.speed`, 1)
    integer(c.maxHull, `${c.name}.maxHull`, 1)
    integer(c.maxEnergyMilli, `${c.name}.maxEnergyMilli`, 1)
    if (c.startingEnergyMilli > c.maxEnergyMilli) throw new Error('Starting energy exceeds capacity')
    if (!c.equipment.cloak && c.cloakMilliPerSecond !== 0) throw new Error('Unequipped cloak cannot have a sustain cost')
    return {
      ...structuredClone(c),
      speedUnitsPerTick: ratePerTick(c.speedUnitsPerSecond, t.tickMs, 'ship speed'),
      regenerationMilliPerTick: ratePerTick(c.regenerationMilliPerSecond, t.tickMs, 'regeneration'),
      propulsionMilliPerTick: ratePerTick(c.propulsionMilliPerSecond, t.tickMs, 'propulsion'),
      cloakMilliPerTick: ratePerTick(c.cloakMilliPerSecond, t.tickMs, 'cloak'),
    }
  }
  const ships = { 'shadow-dancer': ship(config.ships['shadow-dancer']), 'patrol-frigate': ship(config.ships['patrol-frigate']) }
  return freezeData({
    version: config.version, timing, geometry: structuredClone(g), sensors: structuredClone(config.sensors),
    laser: structuredClone(config.laser),
    missile: { ...structuredClone(config.missile), speedUnitsPerTick: ratePerTick(config.missile.speedUnitsPerSecond, t.tickMs, 'missile speed') },
    ships, maxShipSpeedUnitsPerTick: Math.max(ships['shadow-dancer'].speedUnitsPerTick, ships['patrol-frigate'].speedUnitsPerTick),
    aftermathWindowsPerLaunch: Math.ceil(timing.missileLifetimeTicks / timing.turnTicks),
    diagnosticTurnLimit: config.diagnosticTurnLimit,
  })
}

export function aftermathWindowBound(rules: Ruleset, remainingSurvivorAmmunition: number): number {
  integer(remainingSurvivorAmmunition, 'remainingSurvivorAmmunition')
  const bound = rules.aftermathWindowsPerLaunch * (remainingSurvivorAmmunition + 1)
  integer(bound, 'aftermath window bound')
  return bound
}

export const DUEL_CONFIG: RulesConfig = freezeData({
  version: 'duel-v1',
  timing: { tickMs: 100, turnMs: 10_000, trackingMs: 2_000, exposureMs: 3_000, contactMemoryMs: 60_000, laserCooldownMs: 5_000, missileCooldownMs: 10_000, missileLifetimeMs: 15_000 },
  geometry: { unitsPerCell: 1000, shipRadiusUnits: 250, missileRadiusUnits: 100, cardinalRouteCost: 1000, diagonalRouteCost: 1414 },
  sensors: {
    passiveUncloakedRangeUnits: 7000, passiveCloakedRangeUnits: 3000,
    activeUncloakedRangeUnits: 10_000, activeCloakedRangeUnits: 7000,
    movingSignatureBonusUnits: 1000, exposedRangeUnits: 12_000,
    passiveMissileRangeUnits: 7000, activeMissileRangeUnits: 10_000, pulseCostMilli: 12_000,
  },
  laser: { costMilli: 18_000, damage: 35, rangeUnits: 6000 },
  missile: { costMilli: 10_000, damage: 45, speedUnitsPerSecond: 2000, blastRadiusUnits: 750 },
  ships: {
    'shadow-dancer': {
      name: 'Shadow-Dancer', speedUnitsPerSecond: 1000, maxHull: 100, maxShields: 40,
      startingEnergyMilli: 100_000, maxEnergyMilli: 100_000,
      regenerationMilliPerSecond: 2000, propulsionMilliPerSecond: 1000, cloakMilliPerSecond: 3000,
      missileAmmunition: 6, equipment: { cloak: true, activeSensor: true, laser: true, missileLauncher: true },
    },
    'patrol-frigate': {
      name: 'Federation Patrol Frigate', speedUnitsPerSecond: 800, maxHull: 100, maxShields: 60,
      startingEnergyMilli: 100_000, maxEnergyMilli: 100_000,
      regenerationMilliPerSecond: 2000, propulsionMilliPerSecond: 1000, cloakMilliPerSecond: 0,
      missileAmmunition: 4, equipment: { cloak: false, activeSensor: true, laser: true, missileLauncher: true },
    },
  },
  diagnosticTurnLimit: 200,
})
