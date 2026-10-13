import type { Tick, ValidationIssue } from '../../contracts'

type Code = ValidationIssue['code']
type Details = NonNullable<ValidationIssue['details']>

const seconds = (ticks: number, tickMs: number) => `${((ticks * tickMs) / 1000).toFixed(1)} s`
const energy = (milli: number) => String(Math.floor(milli / 1000))

export const SEVERITY_LABEL: Record<ValidationIssue['severity'], string> = {
  error: 'Invalid',
  conditional: 'Waits',
  warning: 'Note',
}

/** Plain-language explanation of each contract issue code, using only the supplied safe details. */
const MESSAGES: Record<Code, (details: Details, context: { tickMs: number; tick: Tick }) => string> = {
  'invalid-shape': () => 'These orders are incomplete. Set each order again.',
  'invalid-turn': () => 'These orders belong to a different turn.',
  'out-of-bounds': ({ cell }) => `${cell ? `Column ${cell.column}, row ${cell.row} is` : 'That cell is'} outside the battlefield.`,
  obstacle: ({ cell }) => `${cell ? `Column ${cell.column}, row ${cell.row} is` : 'That cell is'} an asteroid. Choose open space.`,
  unreachable: () => 'No open route reaches that cell.',
  'unknown-alias': ({ contactAlias }) => `${contactAlias ?? 'That contact'} is no longer in your plot.`,
  'equipment-unavailable': () => 'This ship has no equipment for that order.',
  'no-ammunition': () => 'No missiles remain.',
  'observed-opponent-destroyed': () => 'You observed the enemy destroyed, so weapons hold fire.',
  'awaiting-current-lock': ({ contactAlias }) => `Fires only once ${contactAlias ?? 'the contact'} is detected again this turn.`,
  'awaiting-range': ({ rangeUnits }) => `Fires only once the target is within range${rangeUnits ? ` (${rangeUnits / 1000} cells)` : ''}.`,
  'awaiting-line-of-sight': () => 'Fires only once nothing blocks the line of sight.',
  'awaiting-cooldown': ({ readyTick }, { tickMs, tick }) => readyTick !== undefined && readyTick > tick
    ? `Fires once the weapon has cooled down, in ${seconds(readyTick - tick, tickMs)}.`
    : 'Fires once the weapon has cooled down.',
  'awaiting-energy': ({ requiredEnergyMilli, availableEnergyMilli }) => requiredEnergyMilli !== undefined && availableEnergyMilli !== undefined
    ? `Needs ${energy(requiredEnergyMilli)} energy; ${energy(availableEnergyMilli)} available now.`
    : 'Waits until enough energy is available.',
  'propulsion-funding': () => 'Movement pauses on any tick without propulsion energy.',
  'cloak-exposure': () => 'Cloak engages only after the current exposure ends.',
  'activity-breaks-cloak': () => 'A successful scan or shot breaks cloak until a later turn.',
}

export function issueMessage(issue: ValidationIssue, context: { tickMs: number; tick: Tick }): string {
  return MESSAGES[issue.code](issue.details ?? {}, context)
}
