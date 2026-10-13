import type { CloakObservation, OwnShipObservation, Ruleset, SensorOrder, Tick, TurnOrders } from '../../contracts'
import { energyText } from './consoleText'

/** What the console may offer, handed in by the composition root from the engine facade. */
export interface OrderCapabilities {
  readonly activePulse: boolean
}

export const secondsText = (ticks: number, rules: Ruleset) => `${((Math.max(0, ticks) * rules.timing.tickMs) / 1000).toFixed(1)} s`
export const cellsText = (units: number, rules: Ruleset) => {
  const cells = units / rules.geometry.unitsPerCell
  return `${Number.isInteger(cells) ? cells : cells.toFixed(1)} cells`
}

/** Short actual cloak state; "requested" marks a cloak ordered on but not running. */
const CLOAK_SHORT: Record<CloakObservation['state'], string> = {
  off: 'Off',
  active: 'On',
  'suppressed-exposure': 'Off, requested: exposed',
  'latched-activity': 'Off, requested: broken',
  'latched-unfunded': 'Off, requested: no energy',
}
export const cloakShortText = (cloak: CloakObservation) => CLOAK_SHORT[cloak.state]

/** One sentence on the actual cloak at this frame, including why a requested cloak is off. */
export function cloakNowText(own: OwnShipObservation, tick: Tick, rules: Ruleset): string {
  switch (own.cloak.state) {
    case 'active': return 'Cloak is on.'
    case 'off': return 'Cloak is off.'
    case 'suppressed-exposure': {
      const left = own.clocks.exposureUntilTick - tick
      return `Cloak requested but held off while your ship is exposed${left > 0 ? ` (${secondsText(left, rules)} left)` : ''}.`
    }
    case 'latched-activity': return 'Cloak requested but broken by your scan or shot; it stays off this turn.'
    case 'latched-unfunded': return 'Cloak requested but upkeep ran out of energy; it stays off this turn.'
  }
}

/** Planning hint when the carried-over draft leaves a broken or failed cloak off. */
export function cloakRequestHint(own: OwnShipObservation, draftCloak: boolean): string | null {
  if (draftCloak || !own.equipment.cloak) return null
  if (own.cloak.state === 'latched-activity') return 'Last turn your scan or shot broke cloak. Select On to request it again.'
  if (own.cloak.state === 'latched-unfunded') return 'Last turn cloak upkeep ran out of energy. Select On to request it again.'
  return null
}

export function sensorStatusText(own: OwnShipObservation, tick: Tick, rules: Ruleset): string {
  if (own.sensor !== 'tracking') return 'Passive'
  return `Tracking, ${secondsText(own.clocks.trackingUntilTick - tick, rules)} left`
}

export function exposureStatusText(own: OwnShipObservation, tick: Tick, rules: Ruleset): string {
  const left = own.clocks.exposureUntilTick - tick
  return left > 0 ? `Exposed, ${secondsText(left, rules)} left` : 'Not exposed'
}

/**
 * Outcome of the committed turn's pulse so far, from the own observation at the shown frame.
 * Turn flags describe the previous turn until a tick of this one has resolved, so before
 * that (commit, or the turn's starting frame) the pulse is simply still to come.
 */
export function pulseProgressText(own: OwnShipObservation, tick: Tick, ticksResolved: number, rules: Ruleset): string {
  if (ticksResolved < 1) return 'Pulse fires on the first tick of the turn.'
  if (own.interruptions.some((interruption) => interruption.reason === 'pulse-unfunded')) {
    return 'Pulse failed: not enough energy. No scan and no exposure.'
  }
  if (!own.turnActions.pulseAttemptSpent) return 'Pulse fires on the first tick of the turn.'
  if (own.sensor === 'tracking') return `Pulse succeeded: tracking for ${secondsText(own.clocks.trackingUntilTick - tick, rules)} more.`
  return 'Pulse succeeded; tracking has ended.'
}

export interface Effect {
  readonly label: string
  readonly value: string
}

/** Public-rule consequences of each sensor choice, before commitment. */
export function sensorEffects(sensor: SensorOrder, rules: Ruleset): Effect[] {
  const s = rules.sensors
  const moving = s.movingSignatureBonusUnits / rules.geometry.unitsPerCell
  if (sensor === 'passive') {
    return [
      { label: 'Cost', value: 'None' },
      { label: 'Detects', value: `${cellsText(s.passiveUncloakedRangeUnits, rules)}, ${s.passiveCloakedRangeUnits / rules.geometry.unitsPerCell} if cloaked, +${moving} if moving` },
    ]
  }
  return [
    { label: 'Cost', value: `${energyText(s.pulseCostMilli)} energy, first tick only` },
    { label: 'Tracking', value: `${secondsText(rules.timing.trackingTicks, rules)} at ${cellsText(s.activeUncloakedRangeUnits, rules)}, ${s.activeCloakedRangeUnits / rules.geometry.unitsPerCell} if cloaked` },
    { label: 'Exposes you', value: `${secondsText(rules.timing.exposureTicks, rules)}, seen within ${cellsText(s.exposedRangeUnits, rules)}` },
    { label: 'Unfunded', value: 'Fails once; no exposure' },
  ]
}

/** How far the patrol's sensors can see this ship under each cloak choice. */
export function cloakEffects(cloak: boolean, own: OwnShipObservation, rules: Ruleset): Effect[] {
  const s = rules.sensors
  const spec = rules.ships[own.shipClass]
  const cells = (units: number) => units / rules.geometry.unitsPerCell
  if (!cloak) {
    return [{ label: 'Detectable', value: `${cells(s.passiveUncloakedRangeUnits)} cells passive, ${cells(s.activeUncloakedRangeUnits)} by a pulse` }]
  }
  return [
    { label: 'Upkeep', value: `${energyText(spec.cloakMilliPerTick * (1000 / rules.timing.tickMs))} per s, ${energyText(spec.cloakMilliPerTick * rules.timing.turnTicks)} a turn` },
    { label: 'Detectable', value: `${cells(s.passiveCloakedRangeUnits)} cells passive, ${cells(s.activeCloakedRangeUnits)} by a pulse` },
  ]
}

export interface EnergyPlan {
  readonly currentMilli: number
  readonly maxMilli: number
  readonly rechargeMilli: number
  /** Largest upkeep the orders can draw this turn: full cloak, the pulse, and full-turn propulsion. */
  readonly upkeepMilli: number
  readonly parts: readonly string[]
  /** True when the largest upkeep exceeds energy plus recharge; movement pauses first, then cloak fails. */
  readonly mayRunShort: boolean
}

/** Simple public-rule budget for the draft; the engine's validation remains the authority. */
export function energyPlan(orders: TurnOrders, own: OwnShipObservation, moving: boolean, rules: Ruleset): EnergyPlan {
  const spec = rules.ships[own.shipClass]
  const ticks = rules.timing.turnTicks
  const parts: string[] = []
  let upkeep = 0
  if (orders.cloak && own.equipment.cloak) {
    upkeep += spec.cloakMilliPerTick * ticks
    parts.push(`cloak ${energyText(spec.cloakMilliPerTick * ticks)}`)
  }
  if (orders.sensor === 'activePulse') {
    upkeep += rules.sensors.pulseCostMilli
    parts.push(`pulse ${energyText(rules.sensors.pulseCostMilli)}`)
  }
  if (moving) {
    upkeep += spec.propulsionMilliPerTick * ticks
    parts.push(`propulsion ${energyText(spec.propulsionMilliPerTick * ticks)}`)
  }
  const recharge = spec.regenerationMilliPerTick * ticks
  return {
    currentMilli: own.energy.currentMilli, maxMilli: own.energy.maxMilli, rechargeMilli: recharge,
    upkeepMilli: upkeep, parts, mayRunShort: upkeep > own.energy.currentMilli + recharge,
  }
}
