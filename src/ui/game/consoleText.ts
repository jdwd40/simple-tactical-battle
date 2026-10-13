import type { CloakObservation, OwnAssessment, PublicMap, Ruleset, Tick, VisibleEvent } from '../../contracts'
import { cellOfPosition } from '../../rendering/plotGeometry'

export interface TextContext {
  readonly rules: Ruleset
  readonly map: PublicMap
}

export const cellText = ({ x, y }: { x: number; y: number }, { rules, map }: TextContext) => {
  const cell = cellOfPosition({ x, y }, rules.geometry.unitsPerCell, map)
  return `column ${cell.column}, row ${cell.row}`
}

export const energyText = (milli: number) => (Math.round(milli / 100) / 10).toFixed(1)

export const elapsedText = (tick: Tick, startTick: Tick, rules: Ruleset) => `${(((tick - startTick) * rules.timing.tickMs) / 1000).toFixed(1)} s`

const CLOAK_STATE: Record<CloakObservation['state'], string> = {
  off: 'Off',
  active: 'On',
  'suppressed-exposure': 'Suppressed while exposed',
  'latched-activity': 'Off until a later turn',
  'latched-unfunded': 'Off: not enough energy',
}
export const cloakText = (cloak: CloakObservation) => CLOAK_STATE[cloak.state]

/** Cloak transitions as the log reports them, saying how a requested cloak comes back. */
const CLOAK_EVENT: Record<CloakObservation['state'], string> = {
  off: 'Cloak off.',
  active: 'Cloak engaged.',
  'suppressed-exposure': 'Cloak held off while your ship is exposed.',
  'latched-activity': 'Cloak broken by your scan or shot; it stays off until you request it again.',
  'latched-unfunded': 'Cloak upkeep ran out of energy; it stays off until you request it again.',
}

const ENERGY_REASON: Record<Extract<VisibleEvent, { kind: 'own-energy' }>['reason'], string> = {
  regeneration: 'recharge', cloak: 'cloak upkeep', pulse: 'active pulse', propulsion: 'propulsion', laser: 'laser', missile: 'missile',
}

const INTERRUPTION: Record<Extract<VisibleEvent, { kind: 'own-interruption' }>['reason'], string> = {
  'propulsion-unfunded': 'Propulsion paused: not enough energy',
  'cloak-unfunded': 'Cloak failed: not enough energy',
  'pulse-unfunded': 'Active pulse failed: not enough energy, so no scan and no exposure',
}
export const interruptionText = (reason: keyof typeof INTERRUPTION) => INTERRUPTION[reason]

/** One plain sentence per observed event, from its explicit observer-safe payload only. */
export function eventText(event: VisibleEvent, context: TextContext): string {
  switch (event.kind) {
    case 'contact-acquired': return `${event.contact.alias} detected at ${cellText(event.contact.measurement.position, context)}.`
    case 'contact-updated': return `${event.contact.alias} measured at ${cellText(event.contact.measurement.position, context)}.`
    case 'contact-lost': return `Lost ${event.contact.alias}; last seen at ${cellText(event.contact.measurement.position, context)}.`
    case 'contact-expired': return `Memory of ${event.alias} expired after ${context.rules.timing.contactMemoryTicks * context.rules.timing.tickMs / 1000} s unseen.`
    case 'own-interruption': return `${interruptionText(event.reason)}.`
    case 'own-cloak': return CLOAK_EVENT[event.cloak.state]
    case 'own-energy': return `Energy ${event.deltaMilli >= 0 ? '+' : '−'}${energyText(Math.abs(event.deltaMilli))} (${ENERGY_REASON[event.reason]}).`
    case 'own-ammunition': return `Missiles ${event.delta >= 0 ? '+' : '−'}${Math.abs(event.delta)}.`
    case 'own-shot': return `Fired ${event.weapon.kind} from ${cellText(event.position, context)}.`
    case 'observed-shot': return `${event.sourceAlias} fired a ${event.weapon} from ${cellText(event.position, context)}.`
    case 'observed-impact': return `${event.weapon === 'laser' ? 'Laser' : 'Missile'} impact observed at ${cellText(event.position, context)}.`
    case 'own-damage': return `Hit: ${event.shieldsLost} shields and ${event.hullLost} hull lost.`
    case 'observed-destruction': return `${event.contactAlias} observed destroyed at ${cellText(event.position, context)}.`
    case 'own-destruction': return 'Shadow-Dancer destroyed.'
    case 'own-missile': return `Own missile ${event.missile.status} at ${cellText(event.missile.position, context)}.`
    case 'hostile-missile-sighted': return `Hostile missile sighted at ${cellText(event.missile.measurement.position, context)}.`
    case 'hostile-missile-lost': return `Lost track of a hostile missile near ${cellText(event.missile.measurement.position, context)}.`
    case 'hostile-missile-expired': return 'Hostile missile track expired.'
    case 'outcome': return `Encounter result: ${event.outcome.replace('-', ' ')}.`
  }
}

/** Concise own-ship consequences of the assessed turn, for the assessment panel. */
export function assessmentLines(assessment: OwnAssessment, context: TextContext, turnStartTick = assessment.revealTick - context.rules.timing.turnTicks): string[] {
  const lines: string[] = []
  const start = cellText(assessment.startPosition, context)
  const end = cellText(assessment.endPosition, context)
  const moved = assessment.startPosition.x !== assessment.endPosition.x || assessment.startPosition.y !== assessment.endPosition.y
  lines.push(moved ? `Moved from ${start} to ${end}.` : `Held position at ${end}.`)
  if (assessment.destination) {
    const destination = `column ${assessment.destination.column}, row ${assessment.destination.row}`
    lines.push(assessment.destinationReached
      ? `Reached the destination at ${destination}.`
      : `Destination ${destination} not reached yet; the course carries into your next plan.`)
  }
  const energy = assessment.deltas.energyMilli
  lines.push(`Energy ${energy >= 0 ? '+' : '−'}${energyText(Math.abs(energy))} over the turn.`)
  if (assessment.deltas.hull !== 0 || assessment.deltas.shields !== 0) {
    lines.push(`Shields ${assessment.deltas.shields}, hull ${assessment.deltas.hull}.`)
  }
  for (const reason of new Set(assessment.interruptions.map((interruption) => interruption.reason))) {
    const count = assessment.interruptions.filter((interruption) => interruption.reason === reason).length
    lines.push(`${interruptionText(reason)} (${count} time${count === 1 ? '' : 's'}).`)
  }
  const { rules } = context
  const seconds = (ticks: number) => `${((ticks * rules.timing.tickMs) / 1000).toFixed(1)} s`
  const sensor = assessment.sensorAttempt
  if (sensor.kind === 'succeeded') {
    lines.push(`Active pulse succeeded: tracking for ${seconds(rules.timing.trackingTicks)}, and your ship was exposed for ${seconds(rules.timing.exposureTicks)}.`)
  } else if (sensor.kind === 'failed') {
    lines.push(sensor.reason === 'insufficient-energy'
      ? 'Active pulse failed on the first tick for lack of energy. It did not retry and did not expose you.'
      : 'Active pulse not made: your ship was destroyed.')
  }
  const latched = assessment.events.filter((event) => event.kind === 'own-cloak').map((event) => event.cloak.state)
  if (latched.includes('latched-activity')) lines.push('Your scan or shot broke cloak for the rest of the turn. Request it again when planning.')
  else if (latched.includes('latched-unfunded')) lines.push('Cloak stays off until you request it again when planning.')
  for (const event of assessment.events) {
    const at = seconds(event.tick - turnStartTick)
    if (event.kind === 'contact-acquired') lines.push(`${event.contact.alias} detected at ${at}.`)
    else if (event.kind === 'contact-lost') lines.push(`${event.contact.alias} lost at ${at}; now a last-known position.`)
    else if (event.kind === 'contact-expired') lines.push(`Memory of ${event.alias} expired at ${at}.`)
  }
  const current = assessment.contacts.filter((contact) => contact.kind === 'current').length
  const stale = assessment.contacts.length - current
  lines.push(assessment.contacts.length === 0
    ? 'No contacts known at the end of the turn.'
    : `Contacts at the end of the turn: ${current} current, ${stale} last known.`)
  return lines
}
