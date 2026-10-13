import type {
  OrderValidation, OwnShipObservation, RouteProgress, Ruleset, Tick, ValidateOrders, ValidationField, ValidationIssue,
} from '../contracts/public'
import { freezeData } from '../scenarios/freeze'
import { planMovement } from './route'
import { hasLineOfSight, withinRange } from './geometry'
import { fundTick } from './sensing'

/**
 * Engine capabilities of this increment. Equipped but unimplemented intents are rejected
 * as `equipment-unavailable` rather than accepted and silently not performed.
 */
export const ENGINE_CAPABILITIES = freezeData({ activePulse: true, laser: true, missile: false })

type ErrorCode = Extract<ValidationIssue, { readonly severity: 'error' }>['code']
function error(field: ValidationField, code: ErrorCode, details?: ValidationIssue['details']): ValidationIssue {
  return details === undefined ? { field, severity: 'error', code } : { field, severity: 'error', code, details }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
function isCell(value: unknown): boolean {
  return isRecord(value) && Number.isSafeInteger(value.column) && Number.isSafeInteger(value.row)
}
/** Runtime shape check: orders may arrive from untyped UI state. */
function shapeIssues(orders: unknown): ValidationIssue[] {
  if (!isRecord(orders)) return [error('orders', 'invalid-shape')]
  const issues: ValidationIssue[] = []
  if (!Number.isSafeInteger(orders.turnIndex) || (orders.turnIndex as number) < 0) issues.push(error('turnIndex', 'invalid-shape'))
  const movement = orders.movement
  if (!isRecord(movement) || !(movement.kind === 'hold' || (movement.kind === 'destination' && isCell(movement.cell)))) {
    issues.push(error('movement', 'invalid-shape'))
  }
  if (orders.sensor !== 'passive' && orders.sensor !== 'activePulse') issues.push(error('sensor', 'invalid-shape'))
  if (typeof orders.cloak !== 'boolean') issues.push(error('cloak', 'invalid-shape'))
  const weapon = orders.weapon
  if (!isRecord(weapon) || !(weapon.kind === 'hold'
    || (weapon.kind === 'laser' && typeof weapon.contactAlias === 'string' && weapon.contactAlias !== '')
    || (weapon.kind === 'missile' && isCell(weapon.aim)))) {
    issues.push(error('weapon', 'invalid-shape'))
  }
  return issues
}

interface FundingForecast {
  readonly pulseShortfall: { readonly availableEnergyMilli: number } | null
  /** Energy left for a weapon on the first tick, after every higher-priority grant. */
  readonly firstTickWeaponEnergyMilli: number
  readonly propulsionPauses: boolean
}

/** Replays the engine's stage-2 grant order on own facts only. A later laser discharge is not forecast. */
function forecastFunding(own: OwnShipObservation, route: RouteProgress, cloak: boolean, pulse: boolean, tick: Tick, rules: Ruleset): FundingForecast {
  const spec = rules.ships[own.shipClass]
  let energy = own.energy.currentMilli
  let remaining = route.remainingDistanceUnits
  let cloakDue = cloak
  let pulseShortfall: FundingForecast['pulseShortfall'] = null
  let firstTickWeaponEnergyMilli = energy
  for (let now = tick + 1; now <= tick + rules.timing.turnTicks && (remaining > 0 || now === tick + 1); now++) {
    const sustain = cloakDue && own.clocks.exposureUntilTick <= now
    const pulseDue = pulse && now === tick + 1
    const grant = fundTick(energy, { cloak: sustain, pulse: pulseDue, propulsion: remaining > 0 }, rules.sensors.pulseCostMilli, spec)
    if (pulseDue && !grant.pulsePaid) {
      // Energy left for the pulse after regeneration and the higher-priority sustain grant.
      pulseShortfall = { availableEnergyMilli: fundTick(energy, { cloak: sustain, pulse: false, propulsion: false }, 0, spec).energyMilli }
    }
    if (now === tick + 1) firstTickWeaponEnergyMilli = grant.energyMilli
    if ((sustain && !grant.cloakPaid) || grant.pulsePaid) cloakDue = false
    if (remaining > 0 && !grant.propulsionPaid) return { pulseShortfall, firstTickWeaponEnergyMilli, propulsionPauses: true }
    energy = grant.energyMilli
    if (remaining > 0) remaining -= spec.speedUnitsPerTick
  }
  return { pulseShortfall, firstTickWeaponEnergyMilli, propulsionPauses: false }
}

/** Inputs are the order envelope, this side's observation and public rules only. */
export const validateOrders: ValidateOrders = (orders, observation, rules) => {
  const result = (issues: ValidationIssue[]): OrderValidation => freezeData({
    structurallyValid: !issues.some((issue) => issue.severity === 'error'), issues,
  })
  const shape = shapeIssues(orders)
  if (shape.length > 0) return result(shape)
  const own = observation.ownShip
  if (own.status === 'destroyed') return result([error('orders', 'invalid-turn')])
  const issues: ValidationIssue[] = []
  if (orders.turnIndex !== observation.turnIndex) issues.push(error('turnIndex', 'invalid-turn'))
  const plan = planMovement(own, orders.movement, observation.map, rules)
  if ('error' in plan && orders.movement.kind === 'destination') {
    issues.push(error('movement', plan.error, { cell: { column: orders.movement.cell.column, row: orders.movement.cell.row } }))
  }
  const pulse = orders.sensor === 'activePulse'
  const pulseAvailable = own.equipment.activeSensor && ENGINE_CAPABILITIES.activePulse
  if (pulse && !pulseAvailable) issues.push(error('sensor', 'equipment-unavailable'))
  if (orders.cloak && !own.equipment.cloak) issues.push(error('cloak', 'equipment-unavailable'))
  if (orders.weapon.kind !== 'hold') {
    const equipped = orders.weapon.kind === 'laser' ? own.equipment.laser : own.equipment.missileLauncher
    if (!(equipped && ENGINE_CAPABILITIES[orders.weapon.kind])) issues.push(error('weapon', 'equipment-unavailable'))
    else if (observation.observedOpponentDestructionTick !== undefined) issues.push(error('weapon', 'observed-opponent-destroyed'))
  }
  // A laser names an own contact alias; the engine resolves it privately and never from an unseen position.
  const laser = orders.weapon.kind === 'laser' && own.equipment.laser && ENGINE_CAPABILITIES.laser
    && observation.observedOpponentDestructionTick === undefined ? orders.weapon : null
  const contact = laser === null ? undefined : observation.contacts.find((candidate) => candidate.alias === laser.contactAlias)
  if (laser !== null && contact === undefined) issues.push(error('weapon', 'unknown-alias', { contactAlias: laser.contactAlias }))
  const cloak = orders.cloak && own.equipment.cloak
  if (cloak && own.clocks.exposureUntilTick > observation.tick + 1) {
    issues.push({ field: 'cloak', severity: 'conditional', code: 'cloak-exposure', details: { readyTick: own.clocks.exposureUntilTick } })
  }
  if (cloak && ((pulse && pulseAvailable) || contact !== undefined)) issues.push({ field: 'cloak', severity: 'warning', code: 'activity-breaks-cloak' })
  // The pulse precedes propulsion, so an invalid destination does not change its forecast.
  const forecast = forecastFunding(own, 'error' in plan ? own.route : plan.route, cloak, pulse && pulseAvailable, observation.tick, rules)
  if (forecast.pulseShortfall !== null) {
    issues.push({
      field: 'sensor', severity: 'conditional', code: 'awaiting-energy',
      details: { requiredEnergyMilli: rules.sensors.pulseCostMilli, availableEnergyMilli: forecast.pulseShortfall.availableEnergyMilli },
    })
  }
  if (laser !== null && contact !== undefined) {
    // Conditional, never errors: the intent waits during the turn. Forecast for the first tick from own knowledge.
    const conditional = (code: 'awaiting-current-lock' | 'awaiting-range' | 'awaiting-line-of-sight' | 'awaiting-cooldown' | 'awaiting-energy', details: ValidationIssue['details']) =>
      issues.push({ field: 'weapon', severity: 'conditional', code, details })
    if (contact.kind === 'stale') conditional('awaiting-current-lock', { contactAlias: contact.alias })
    else {
      if (!withinRange(own.position, contact.measurement.position, rules.laser.rangeUnits)) conditional('awaiting-range', { contactAlias: contact.alias, rangeUnits: rules.laser.rangeUnits })
      if (!hasLineOfSight(own.position, contact.measurement.position, observation.map, rules)) conditional('awaiting-line-of-sight', { contactAlias: contact.alias })
    }
    if (own.clocks.laserReadyTick > observation.tick + 1) conditional('awaiting-cooldown', { readyTick: own.clocks.laserReadyTick })
    if (forecast.firstTickWeaponEnergyMilli < rules.laser.costMilli) {
      conditional('awaiting-energy', { requiredEnergyMilli: rules.laser.costMilli, availableEnergyMilli: forecast.firstTickWeaponEnergyMilli })
    }
  }
  if (!('error' in plan) && forecast.propulsionPauses) {
    issues.push({ field: 'movement', severity: 'conditional', code: 'propulsion-funding', details: { availableEnergyMilli: own.energy.currentMilli } })
  }
  return result(issues)
}
