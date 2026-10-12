import type {
  OrderValidation, OwnShipObservation, RouteProgress, Ruleset, Tick, ValidateOrders, ValidationField, ValidationIssue,
} from '../contracts/public'
import { freezeData } from '../scenarios/freeze'
import { planMovement } from './route'
import { fundTick } from './sensing'

/**
 * Engine capabilities of this increment. Equipped but unimplemented intents are rejected
 * as `equipment-unavailable` rather than accepted and silently not performed.
 */
export const ENGINE_CAPABILITIES = freezeData({ activePulse: false, laser: false, missile: false })

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

/** Same stage order as the engine: does propulsion pause before this turn's movement completes? */
function propulsionShortfall(own: OwnShipObservation, route: RouteProgress, cloak: boolean, tick: Tick, rules: Ruleset): boolean {
  const spec = rules.ships[own.shipClass]
  let energy = own.energy.currentMilli
  let remaining = route.remainingDistanceUnits
  let cloakDue = cloak
  for (let now = tick + 1; now <= tick + rules.timing.turnTicks && remaining > 0; now++) {
    const sustain = cloakDue && own.clocks.exposureUntilTick <= now
    const grant = fundTick(energy, { cloak: sustain, propulsion: true }, spec)
    if (sustain && !grant.cloakPaid) cloakDue = false
    if (!grant.propulsionPaid) return true
    energy = grant.energyMilli
    remaining -= spec.speedUnitsPerTick
  }
  return false
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
  if (orders.sensor === 'activePulse' && !(own.equipment.activeSensor && ENGINE_CAPABILITIES.activePulse)) {
    issues.push(error('sensor', 'equipment-unavailable'))
  }
  if (orders.cloak && !own.equipment.cloak) issues.push(error('cloak', 'equipment-unavailable'))
  if (orders.weapon.kind !== 'hold') {
    const equipped = orders.weapon.kind === 'laser' ? own.equipment.laser : own.equipment.missileLauncher
    if (!(equipped && ENGINE_CAPABILITIES[orders.weapon.kind])) issues.push(error('weapon', 'equipment-unavailable'))
  }
  if (!('error' in plan) && propulsionShortfall(own, plan.route, orders.cloak && own.equipment.cloak, observation.tick, rules)) {
    issues.push({ field: 'movement', severity: 'conditional', code: 'propulsion-funding', details: { availableEnergyMilli: own.energy.currentMilli } })
  }
  return result(issues)
}
