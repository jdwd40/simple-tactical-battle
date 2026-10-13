import type { PrivateKnowledge, ShipState } from '../contracts/private'
import type { ContactMemory, Position, PublicMap, Ruleset, Tick } from '../contracts/public'
import { ceilSqrt, hasLineOfSight, withinRange } from './geometry'

export interface FundingWants { readonly cloak: boolean; readonly pulse: boolean; readonly propulsion: boolean }
export interface FundingGrant { readonly energyMilli: number; readonly cloakPaid: boolean; readonly pulsePaid: boolean; readonly propulsionPaid: boolean }

/**
 * Stages 1–2 energy for one living ship: regeneration (capped), then the fixed grant priority
 * cloak sustain → first-tick pulse → propulsion. Weapons (TSB-30) slot in last. Nothing goes negative.
 */
export function fundTick(
  energyMilli: number, wants: FundingWants, pulseCostMilli: number,
  spec: { readonly maxEnergyMilli: number; readonly regenerationMilliPerTick: number; readonly cloakMilliPerTick: number; readonly propulsionMilliPerTick: number },
): FundingGrant {
  let energy = Math.min(spec.maxEnergyMilli, energyMilli + spec.regenerationMilliPerTick)
  const pay = (wanted: boolean, cost: number): boolean => {
    if (!wanted || energy < cost) return false
    energy -= cost
    return true
  }
  const cloakPaid = pay(wants.cloak, spec.cloakMilliPerTick)
  const pulsePaid = pay(wants.pulse, pulseCostMilli)
  const propulsionPaid = pay(wants.propulsion, spec.propulsionMilliPerTick)
  return { energyMilli: energy, cloakPaid, pulsePaid, propulsionPaid }
}

/** Detection threshold for a target at absolute tick `now`. */
export function signatureRangeUnits(target: ShipState, moved: boolean, observerTracking: boolean, rules: Ruleset, now: Tick): number {
  const s = rules.sensors
  if (target.exposureUntilTick > now) return s.exposedRangeUnits
  const base = observerTracking
    ? (target.cloakActive ? s.activeCloakedRangeUnits : s.activeUncloakedRangeUnits)
    : (target.cloakActive ? s.passiveCloakedRangeUnits : s.passiveUncloakedRangeUnits)
  return moved ? base + s.movingSignatureBonusUnits : base
}
export function detects(observer: ShipState, target: ShipState, targetMoved: boolean, rules: Ruleset, map: PublicMap, now: Tick): boolean {
  if (!observer.alive || !target.alive) return false
  const range = signatureRangeUnits(target, targetMoved, observer.trackingUntilTick > now, rules, now)
  return withinRange(observer.position, target.position, range) && hasLineOfSight(observer.position, target.position, map, rules)
}

export type ContactEvent =
  | { readonly kind: 'contact-acquired' | 'contact-lost'; readonly contact: ContactMemory }
  | { readonly kind: 'contact-expired'; readonly alias: string }

/** Growth at a public speed, capped where the circle already covers the whole map. */
export function uncertaintyUnits(at: Position, ageTicks: number, speedUnitsPerTick: number, rules: Ruleset, map: PublicMap): number {
  const units = rules.geometry.unitsPerCell
  const dx = Math.max(at.x, map.columns * units - at.x)
  const dy = Math.max(at.y, map.rows * units - at.y)
  return Math.min(ageTicks * speedUnitsPerTick, ceilSqrt(dx * dx + dy * dy))
}
function currentContact(alias: string, position: Position, now: Tick, previous?: ContactMemory): ContactMemory {
  const measurement = { position: { x: position.x, y: position.y }, tick: now }
  if (previous === undefined) return { alias, measurement, kind: 'current', ageTicks: 0, uncertaintyRadiusUnits: 0 }
  const elapsed = now - previous.measurement.tick
  return {
    alias, measurement, previousMeasurement: previous.measurement,
    estimatedVelocity: {
      xUnitsPerTick: (position.x - previous.measurement.position.x) / elapsed,
      yUnitsPerTick: (position.y - previous.measurement.position.y) / elapsed,
    },
    ...(previous.observedDestructionTick === undefined ? {} : { observedDestructionTick: previous.observedDestructionTick }),
    kind: 'current', ageTicks: 0, uncertaintyRadiusUnits: 0,
  }
}

/**
 * One stage-7 contact update per tick. Aliases persist through loss/reacquisition until
 * memory expiry; velocity comes only from the preceding distinct-tick measurement.
 */
export function updateContacts(
  knowledge: PrivateKnowledge, sightings: readonly { readonly entityId: string; readonly position: Position }[],
  now: Tick, rules: Ruleset, map: PublicMap,
): { readonly knowledge: PrivateKnowledge; readonly events: readonly ContactEvent[] } {
  const unseen = new Map(sightings.map((sighting) => [sighting.entityId, sighting.position]))
  const contacts: { entityId: string; contact: ContactMemory }[] = []
  const events: ContactEvent[] = []
  for (const { entityId, contact: previous } of knowledge.contacts) {
    const position = unseen.get(entityId)
    if (position !== undefined) {
      unseen.delete(entityId)
      const contact = currentContact(previous.alias, position, now, previous)
      contacts.push({ entityId, contact })
      if (previous.kind === 'stale') events.push({ kind: 'contact-acquired', contact })
      continue
    }
    const ageTicks = now - previous.measurement.tick
    if (ageTicks >= rules.timing.contactMemoryTicks) {
      events.push({ kind: 'contact-expired', alias: previous.alias })
      continue
    }
    const contact: ContactMemory = {
      alias: previous.alias, measurement: previous.measurement,
      ...(previous.previousMeasurement === undefined ? {} : { previousMeasurement: previous.previousMeasurement }),
      ...(previous.estimatedVelocity === undefined ? {} : { estimatedVelocity: previous.estimatedVelocity }),
      ...(previous.observedDestructionTick === undefined ? {} : { observedDestructionTick: previous.observedDestructionTick }),
      kind: 'stale', ageTicks, uncertaintyRadiusUnits: uncertaintyUnits(previous.measurement.position, ageTicks, rules.maxShipSpeedUnitsPerTick, rules, map),
    }
    contacts.push({ entityId, contact })
    if (previous.kind === 'current') events.push({ kind: 'contact-lost', contact })
  }
  let nextContactAlias = knowledge.nextContactAlias
  for (const [entityId, position] of unseen) {
    const contact = currentContact(`contact-${nextContactAlias}`, position, now)
    nextContactAlias += 1
    contacts.push({ entityId, contact })
    events.push({ kind: 'contact-acquired', contact })
  }
  return { knowledge: { ...knowledge, contacts, nextContactAlias }, events }
}

/** Stage 7: the observer saw this entity in the tick it was destroyed. Memory is kept, never deleted. */
export function recordObservedDestruction(knowledge: PrivateKnowledge, entityId: string, now: Tick): PrivateKnowledge {
  return {
    ...knowledge, observedOpponentDestructionTick: now,
    contacts: knowledge.contacts.map((entry) => (entry.entityId === entityId ? { entityId, contact: { ...entry.contact, observedDestructionTick: now } } : entry)),
  }
}
