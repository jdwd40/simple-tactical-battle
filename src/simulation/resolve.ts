import type {
  AcceptedTurn, InternalEvent, PrivateKnowledge, ResolveTurn, Scenario, ShipState, SimulationState, TurnPresentation, TurnResolution,
} from '../contracts/private'
import type {
  InterruptionReason, Outcome, OwnAssessment, OwnInterruption, PublicMap, PublicReplayFrame, Ruleset, Side, Tick, TurnOrders, UnfiredReason, VisibleEvent,
} from '../contracts/public'
import { freezeData } from '../scenarios/freeze'
import { cellCentre } from '../scenarios/geometry'
import { publicScenario } from '../scenarios/private'
import { samePosition } from './geometry'
import { assertSessionMatches, cloakObservation, observeSide, projectObservation } from './observation'
import { advanceRoute, idleRoute, planMovement, routeHeading, routePosition } from './route'
import { detects, fundTick, recordObservedDestruction, updateContacts } from './sensing'
import { validateOrders } from './validation'
import { applyDamage, classifyOutcome, dischargeLaser, proposeLaser, UNFIRED_ORDER, withActivity } from './weapons'

/** Canonical serialization order. It is never combat initiative. */
export const SIDES: readonly Side[] = ['player', 'patrol']

type BySide<T> = Readonly<Record<Side, T>>
type Body<T> = T extends unknown ? Omit<T, 'id' | 'tick'> : never
const opponent = (side: Side): Side => (side === 'player' ? 'patrol' : 'player')

/** Evaluates `order`, then returns a record in canonical key order. */
function bySide<T>(order: readonly Side[], compute: (side: Side) => T): BySide<T> {
  const values = new Map<Side, T>()
  for (const side of order) values.set(side, compute(side))
  if (values.size !== 2) throw new Error('Side evaluation order must name both sides once')
  return { player: values.get('player') as T, patrol: values.get('patrol') as T }
}
const eventId = (tick: Tick, index: number) => `t${tick}-${String(index).padStart(3, '0')}`

/** Locks one side's validated envelope: hold/retained/new route, cloak request, fresh turn intents. */
function commitOrders(state: SimulationState, side: Side, orders: TurnOrders | null, rules: Ruleset, scenario: Scenario, map: PublicMap): ShipState {
  const ship = structuredClone(state.ships[side])
  if (!ship.alive) {
    if (orders !== null) throw new Error(`Destroyed ${side} ship cannot receive orders`)
    return { ...ship, orders: null }
  }
  if (orders === null) throw new Error(`Living ${side} ship requires locked orders`)
  const validation = validateOrders(orders, observeSide(state, side, rules, scenario), rules)
  if (!validation.structurallyValid) {
    const errors = validation.issues.filter((issue) => issue.severity === 'error').map((issue) => `${issue.field}:${issue.code}`)
    throw new Error(`Locked ${side} orders are invalid: ${errors.join(', ')}`)
  }
  const plan = planMovement(ship, orders.movement, map, rules)
  if ('error' in plan) throw new Error(`Locked ${side} movement is invalid: ${plan.error}`)
  return {
    ...ship, orders: structuredClone(orders), destination: plan.destination, route: plan.route,
    cloakRequested: orders.cloak, cloakLatch: 'none', pulseAttemptSpent: false, weaponIntentSpent: false, propulsionInterrupted: false,
  }
}

type PulseOutcome = 'succeeded' | 'failed' | null
interface Funded { readonly ship: ShipState; readonly propulsionPaid: boolean; readonly pulse: PulseOutcome; readonly interruptions: InterruptionReason[] }

/**
 * Stages 1–2: clock expiry is the absolute `until > now` comparison, then regeneration and the
 * cloak sustain → first-tick pulse → propulsion grants. The single pulse attempt is spent whether
 * or not it is funded. A funded pulse starts tracking and exposure and latches cloak off for the
 * rest of the turn (an already-paid sustain is not refunded). Interruptions once per transition.
 */
function fundShip(ship: ShipState, rules: Ruleset, now: Tick): Funded {
  if (!ship.alive) return { ship, propulsionPaid: false, pulse: null, interruptions: [] }
  const sustainDue = ship.cloakRequested && ship.cloakLatch === 'none' && ship.exposureUntilTick <= now
  const pulseDue = ship.orders?.sensor === 'activePulse' && !ship.pulseAttemptSpent
  const wantsPropulsion = ship.route.remainingDistanceUnits > 0
  const grant = fundTick(ship.energyMilli, { cloak: sustainDue, pulse: pulseDue, propulsion: wantsPropulsion }, rules.sensors.pulseCostMilli, rules.ships[ship.shipClass])
  const interruptions: InterruptionReason[] = []
  const cloakFailed = sustainDue && !grant.cloakPaid
  if (cloakFailed) interruptions.push('cloak-unfunded')
  if (pulseDue && !grant.pulsePaid) interruptions.push('pulse-unfunded')
  const propulsionFailed = wantsPropulsion && !grant.propulsionPaid
  if (propulsionFailed && !ship.propulsionInterrupted) interruptions.push('propulsion-unfunded')
  const paid: ShipState = {
    ...ship, energyMilli: grant.energyMilli, cloakActive: grant.cloakPaid, cloakLatch: cloakFailed ? 'unfunded' : ship.cloakLatch,
    pulseAttemptSpent: ship.pulseAttemptSpent || pulseDue, propulsionInterrupted: propulsionFailed,
    trackingUntilTick: grant.pulsePaid ? Math.max(ship.trackingUntilTick, now + rules.timing.trackingTicks) : ship.trackingUntilTick,
  }
  return {
    ship: grant.pulsePaid ? withActivity(paid, now, rules) : paid,
    propulsionPaid: grant.propulsionPaid, pulse: pulseDue ? (grant.pulsePaid ? 'succeeded' : 'failed') : null, interruptions,
  }
}

/** Stage 3 for one ship from its own funded state; the caller applies both results together. */
function moveShip(ship: ShipState, propulsionPaid: boolean, rules: Ruleset): ShipState {
  if (!propulsionPaid) return ship
  const route = advanceRoute(ship.route, rules.ships[ship.shipClass].speedUnitsPerTick)
  const position = routePosition(route) ?? ship.position
  return {
    ...ship, position: { x: position.x, y: position.y }, headingMilliDegrees: routeHeading(route) ?? ship.headingMilliDegrees,
    route: route.remainingDistanceUnits === 0 ? idleRoute() : route,
  }
}

interface LaserRecord { firedTick: Tick | null; readonly reasons: Set<UnfiredReason> }

function weaponAttempt(startShip: ShipState, laser: LaserRecord): OwnAssessment['weaponAttempt'] {
  if (startShip.orders?.weapon.kind !== 'laser') return { kind: 'not-requested' }
  if (laser.firedTick !== null) return { kind: 'fired', tick: laser.firedTick, weapon: 'laser' }
  return { kind: 'unfired', weapon: 'laser', reasons: UNFIRED_ORDER.filter((reason) => laser.reasons.has(reason)) }
}

function assess(
  startShip: ShipState, endShip: ShipState, turnIndex: number, endTick: Tick, rules: Ruleset, pulse: PulseOutcome, laser: LaserRecord,
  interruptions: readonly OwnInterruption[], events: readonly VisibleEvent[], knowledge: PrivateKnowledge,
): OwnAssessment {
  const destination = endShip.destination
  return {
    turnIndex, revealTick: endTick,
    startPosition: { ...startShip.position }, endPosition: { ...endShip.position },
    destination: destination === null ? null : { ...destination },
    destinationReached: destination !== null && endShip.route.remainingDistanceUnits === 0
      && samePosition(endShip.position, cellCentre(destination, rules)),
    deltas: {
      energyMilli: endShip.energyMilli - startShip.energyMilli, hull: endShip.hull - startShip.hull,
      shields: endShip.shields - startShip.shields, ammunition: endShip.ammunition - startShip.ammunition,
    },
    interruptions: interruptions.map((interruption) => ({ ...interruption })),
    sensorAttempt: pulse === null ? { kind: 'not-requested' } : pulse === 'succeeded' ? { kind: 'succeeded' } : { kind: 'failed', reason: 'insufficient-energy' },
    weaponAttempt: weaponAttempt(startShip, laser),
    contacts: knowledge.contacts.map(({ contact }) => structuredClone(contact)),
    events: [...events], ordnancePending: null,
  }
}

/**
 * Resolves one committed turn of exactly `turnTicks` ticks. Each stage reads the same
 * snapshot for both sides; `order` only chooses evaluation order and cannot change output.
 */
export function resolveTurnInOrder(
  state: SimulationState, locked: AcceptedTurn, rules: Ruleset, scenario: Scenario, order: readonly Side[] = SIDES,
): TurnResolution {
  assertSessionMatches(state, rules, scenario)
  if (state.outcome !== null) throw new Error('The encounter already has a final outcome')
  if (state.missiles.length > 0) throw new Error('Missile resolution is not implemented in this increment')
  if (locked.turnIndex !== state.turnIndex || locked.startTick !== state.tick) throw new Error('Locked turn does not match the session turn/tick')
  const map = publicScenario(scenario).map
  const lockedTurn: AcceptedTurn = structuredClone(locked)
  const startTick = state.tick
  const endTick = startTick + rules.timing.turnTicks
  const startShips = bySide(order, (side) => commitOrders(state, side, lockedTurn.orders[side], rules, scenario, map))
  let ships = startShips
  let knowledge = bySide(order, (side) => structuredClone(state.knowledge[side]))
  const interruptions = bySide(order, (): OwnInterruption[] => [])
  const pulses = bySide(order, (): { outcome: PulseOutcome } => ({ outcome: null }))
  const lasers = bySide(order, (): LaserRecord => ({ firedTick: null, reasons: new Set() }))
  let outcome: Outcome | null = null
  const turnEvents = bySide(order, (): VisibleEvent[] => [])
  const internalEvents: InternalEvent[] = []
  const project = (side: Side, tick: Tick, events: readonly VisibleEvent[]) => projectObservation({
    side, turnIndex: lockedTurn.turnIndex, tick, map, ship: ships[side], knowledge: knowledge[side], outcome: outcome === null ? null : { outcome, revealTick: endTick },
  }, rules, events, interruptions[side])
  const frames = bySide(order, (side): PublicReplayFrame[] => [{ tick: startTick, observation: project(side, startTick, []), events: [] }])

  for (let tick = startTick; tick < endTick; tick++) {
    const now = tick + 1
    const before = ships
    // Stages 1–2: clocks, regeneration and resource grants (incl. the first-tick pulse) per ship.
    const funded = bySide(order, (side) => fundShip(before[side], rules, now))
    // Stage 3: both movements from the same prior snapshot, applied together.
    ships = bySide(order, (side) => moveShip(funded[side].ship, funded[side].propulsionPaid, rules))
    const moved = bySide(order, (side) => !samePosition(before[side].position, ships[side].position))
    // Stage 4: pre-fire sensing from the moved state with this tick's tracking/exposure clocks.
    const preFire = bySide(order, (side) => detects(ships[side], ships[opponent(side)], moved[opponent(side)], rules, map, now))
    // Stage 5: every unspent intent against the same pre-damage snapshot and its own fresh sightings.
    const snapshot = ships
    const proposals = bySide(order, (side) => proposeLaser(snapshot[side], knowledge[side], preFire[side] ? [snapshot[opponent(side)]] : [], now, rules, map))
    const fired = bySide(order, (side) => {
      const proposal = proposals[side]
      return proposal !== null && proposal.fire ? proposal.target : null
    })
    const armed = bySide(order, (side) => (fired[side] === null ? snapshot[side] : dischargeLaser(snapshot[side], now, rules)))
    // Stage 6: one damage batch built from the pre-damage alive set; enumeration cannot cancel a shot.
    const shooters = (ship: ShipState) => SIDES.filter((side) => fired[side]?.entityId === ship.entityId)
    const hits = bySide(order, (side) => applyDamage(armed[side], shooters(armed[side]).length * rules.laser.damage, now))
    // Stage 7: emissions are sensed against the pre-damage state (no second weapon pass this tick)
    // and coalesce with pre-fire sightings into one measurement per tick.
    const sightings = bySide(order, (side) => {
      const target = armed[opponent(side)]
      return preFire[side] || detects(armed[side], target, moved[opponent(side)], rules, map, now)
        ? [{ entityId: target.entityId, position: target.position }] : []
    })
    ships = bySide(order, (side) => hits[side].ship)
    const updates = bySide(order, (side) => {
      const update = updateContacts(knowledge[side], sightings[side], now, rules, map)
      const target = sightings[side][0]
      return target !== undefined && hits[opponent(side)].destroyed
        ? { ...update, knowledge: recordObservedDestruction(update.knowledge, target.entityId, now) } : update
    })
    knowledge = bySide(order, (side) => updates[side].knowledge)
    if (now === endTick) outcome = classifyOutcome(ships, 0)
    const internal: Body<InternalEvent>[] = []
    for (const side of SIDES) {
      const ship = ships[side]
      const visible: Body<VisibleEvent>[] = []
      if (funded[side].pulse !== null) pulses[side].outcome = funded[side].pulse
      if (funded[side].pulse === 'succeeded') {
        const deltaMilli = -rules.sensors.pulseCostMilli
        visible.push({ kind: 'own-energy', deltaMilli, reason: 'pulse' })
        internal.push({ kind: 'resource', entityId: ship.entityId, energyDeltaMilli: deltaMilli, ammunitionDelta: 0, reason: 'pulse' })
      }
      for (const reason of funded[side].interruptions) {
        interruptions[side].push({ tick: now, reason })
        visible.push({ kind: 'own-interruption', reason })
        internal.push({ kind: 'interruption', entityId: ship.entityId, reason })
      }
      const proposal = proposals[side]
      if (proposal?.fire === false) for (const reason of proposal.reasons) lasers[side].reasons.add(reason)
      const target = fired[side]
      const weapon = snapshot[side].orders?.weapon
      if (target !== null && weapon?.kind === 'laser') {
        lasers[side].firedTick = now
        const position = { ...armed[side].position }
        visible.push({ kind: 'own-shot', position, weapon: { kind: 'laser', contactAlias: weapon.contactAlias } })
        visible.push({ kind: 'own-energy', deltaMilli: -rules.laser.costMilli, reason: 'laser' })
        internal.push({ kind: 'shot', entityId: ship.entityId, weapon: 'laser', targetEntityId: target.entityId, position })
        internal.push({ kind: 'resource', entityId: ship.entityId, energyDeltaMilli: -rules.laser.costMilli, ammunitionDelta: 0, reason: 'laser' })
      }
      const cloakBefore = cloakObservation(before[side], tick)
      const cloakAfter = cloakObservation(ship, now)
      if (cloakBefore.state !== cloakAfter.state || cloakBefore.actual !== cloakAfter.actual) {
        visible.push({ kind: 'own-cloak', cloak: cloakAfter })
        internal.push({ kind: 'cloak', entityId: ship.entityId, active: ship.cloakActive, latch: ship.cloakLatch })
      }
      if (moved[side]) internal.push({ kind: 'movement', entityId: ship.entityId, start: before[side].position, end: ship.position })
      for (const event of updates[side].events) {
        visible.push(structuredClone(event))
        if (event.kind === 'contact-acquired') {
          internal.push({ kind: 'detection', observer: side, entityId: ships[opponent(side)].entityId, position: event.contact.measurement.position })
        }
      }
      // Observed consequences: built only from this side's own sightings and aliases.
      const enemy = armed[opponent(side)]
      const seenAlias = sightings[side].length === 0 ? undefined
        : knowledge[side].contacts.find((entry) => entry.entityId === enemy.entityId)?.contact.alias
      if (fired[opponent(side)] !== null && seenAlias !== undefined) {
        visible.push({ kind: 'observed-shot', sourceAlias: seenAlias, position: { ...enemy.position }, weapon: 'laser' })
      }
      if (target !== null && seenAlias !== undefined) {
        visible.push({ kind: 'observed-impact', position: { ...target.position }, weapon: 'laser', contactAlias: seenAlias })
      }
      const hit = hits[side]
      if (hit.shieldsLost + hit.hullLost > 0) {
        visible.push({ kind: 'own-damage', shieldsLost: hit.shieldsLost, hullLost: hit.hullLost })
        internal.push({ kind: 'damage', targetEntityId: ship.entityId, sourceIds: shooters(armed[side]).map((s) => snapshot[s].entityId), shieldsLost: hit.shieldsLost, hullLost: hit.hullLost })
      }
      if (hits[opponent(side)].destroyed && seenAlias !== undefined) {
        visible.push({ kind: 'observed-destruction', contactAlias: seenAlias, position: { ...enemy.position } })
      }
      if (hit.destroyed) {
        if (weapon?.kind === 'laser' && lasers[side].firedTick === null) lasers[side].reasons.add('own-destroyed')
        visible.push({ kind: 'own-destruction', position: { ...ship.position } })
        internal.push({ kind: 'destruction', entityId: ship.entityId, position: { ...ship.position } })
      }
      if (now === endTick && outcome !== null) visible.push({ kind: 'outcome', outcome })
      const events = visible.map((body, index) => ({ ...body, id: eventId(now, index), tick: now }) as VisibleEvent)
      turnEvents[side].push(...events)
      frames[side].push({ tick: now, observation: project(side, now, events), events })
    }
    if (now === endTick && outcome !== null) internal.push({ kind: 'outcome', outcome })
    internalEvents.push(...internal.map((body, index) => ({ ...body, id: eventId(now, index), tick: now }) as InternalEvent))
  }

  const nextState: SimulationState = {
    rulesVersion: state.rulesVersion, scenarioId: state.scenarioId, scenarioVersion: state.scenarioVersion, seed: state.seed,
    random: structuredClone(state.random), tick: endTick, turnIndex: state.turnIndex + 1,
    ships, missiles: [], knowledge, plannerMemory: structuredClone(state.plannerMemory),
    acceptedTurns: [...structuredClone(state.acceptedTurns), lockedTurn],
    terminalPending: state.terminalPending, outcome: outcome === null ? null : { outcome, revealTick: endTick },
  }
  const presentations = bySide(order, (side): TurnPresentation => ({
    side, startTick, endTick, automatic: lockedTurn.automatic, frames: frames[side],
    assessment: assess(startShips[side], ships[side], lockedTurn.turnIndex, endTick, rules, pulses[side].outcome, lasers[side], interruptions[side], turnEvents[side], knowledge[side]),
  }))
  return freezeData({ locked: lockedTurn, nextState, internalEvents, presentations })
}

export const resolveTurn: ResolveTurn = (state, locked, rules, scenario) => resolveTurnInOrder(state, locked, rules, scenario)
