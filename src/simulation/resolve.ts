import type {
  AcceptedTurn, InternalEvent, PrivateKnowledge, ResolveTurn, Scenario, ShipState, SimulationState, TurnPresentation, TurnResolution,
} from '../contracts/private'
import type {
  InterruptionReason, OwnAssessment, OwnInterruption, PublicMap, PublicReplayFrame, Ruleset, Side, Tick, TurnOrders, VisibleEvent,
} from '../contracts/public'
import { freezeData } from '../scenarios/freeze'
import { cellCentre } from '../scenarios/geometry'
import { publicScenario } from '../scenarios/private'
import { samePosition } from './geometry'
import { assertSessionMatches, cloakObservation, observeSide, projectObservation } from './observation'
import { advanceRoute, idleRoute, planMovement, routeHeading, routePosition } from './route'
import { detects, fundTick, updateContacts } from './sensing'
import { validateOrders } from './validation'

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

/** Stages 1–2: regeneration, then cloak sustain → propulsion grants. Interruptions once per transition. */
function fundShip(ship: ShipState, rules: Ruleset, now: Tick): { ship: ShipState; propulsionPaid: boolean; interruptions: InterruptionReason[] } {
  if (!ship.alive) return { ship, propulsionPaid: false, interruptions: [] }
  const sustainDue = ship.cloakRequested && ship.cloakLatch === 'none' && ship.exposureUntilTick <= now
  const wantsPropulsion = ship.route.remainingDistanceUnits > 0
  const grant = fundTick(ship.energyMilli, { cloak: sustainDue, propulsion: wantsPropulsion }, rules.ships[ship.shipClass])
  const interruptions: InterruptionReason[] = []
  const cloakFailed = sustainDue && !grant.cloakPaid
  if (cloakFailed) interruptions.push('cloak-unfunded')
  const propulsionFailed = wantsPropulsion && !grant.propulsionPaid
  if (propulsionFailed && !ship.propulsionInterrupted) interruptions.push('propulsion-unfunded')
  return {
    ship: {
      ...ship, energyMilli: grant.energyMilli, cloakActive: grant.cloakPaid,
      cloakLatch: cloakFailed ? 'unfunded' : ship.cloakLatch, propulsionInterrupted: propulsionFailed,
    },
    propulsionPaid: grant.propulsionPaid, interruptions,
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

function assess(
  startShip: ShipState, endShip: ShipState, turnIndex: number, endTick: Tick, rules: Ruleset,
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
    // Pulse and weapon intents are rejected at validation in this increment, so none were requested.
    sensorAttempt: { kind: 'not-requested' }, weaponAttempt: { kind: 'not-requested' },
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
  const turnEvents = bySide(order, (): VisibleEvent[] => [])
  const internalEvents: InternalEvent[] = []
  const project = (side: Side, tick: Tick, events: readonly VisibleEvent[]) => projectObservation({
    side, turnIndex: lockedTurn.turnIndex, tick, map, ship: ships[side], knowledge: knowledge[side], outcome: state.outcome,
  }, rules, events, interruptions[side])
  const frames = bySide(order, (side): PublicReplayFrame[] => [{ tick: startTick, observation: project(side, startTick, []), events: [] }])

  for (let tick = startTick; tick < endTick; tick++) {
    const now = tick + 1
    const before = ships
    // Stages 1–2: clocks, regeneration and resource grants per ship.
    const funded = bySide(order, (side) => fundShip(before[side], rules, now))
    // Stage 3: both movements from the same prior snapshot, applied together.
    ships = bySide(order, (side) => moveShip(funded[side].ship, funded[side].propulsionPaid, rules))
    const moved = bySide(order, (side) => !samePosition(before[side].position, ships[side].position))
    // Stage 4: pre-fire sensing from the moved state. Stages 5–6 (weapons/projectiles) arrive in TSB-30.
    const sightings = bySide(order, (side) => {
      const target = ships[opponent(side)]
      return detects(ships[side], target, moved[opponent(side)], rules, map, now)
        ? [{ entityId: target.entityId, position: target.position }] : []
    })
    // Stage 7: one knowledge update per side, filtered events and recorded frames.
    const updates = bySide(order, (side) => updateContacts(knowledge[side], sightings[side], now, rules, map))
    knowledge = bySide(order, (side) => updates[side].knowledge)
    const internal: Body<InternalEvent>[] = []
    for (const side of SIDES) {
      const ship = ships[side]
      const visible: Body<VisibleEvent>[] = []
      for (const reason of funded[side].interruptions) {
        interruptions[side].push({ tick: now, reason })
        visible.push({ kind: 'own-interruption', reason })
        internal.push({ kind: 'interruption', entityId: ship.entityId, reason })
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
      const events = visible.map((body, index) => ({ ...body, id: eventId(now, index), tick: now }) as VisibleEvent)
      turnEvents[side].push(...events)
      frames[side].push({ tick: now, observation: project(side, now, events), events })
    }
    internalEvents.push(...internal.map((body, index) => ({ ...body, id: eventId(now, index), tick: now }) as InternalEvent))
  }

  const nextState: SimulationState = {
    rulesVersion: state.rulesVersion, scenarioId: state.scenarioId, scenarioVersion: state.scenarioVersion, seed: state.seed,
    random: structuredClone(state.random), tick: endTick, turnIndex: state.turnIndex + 1,
    ships, missiles: [], knowledge, plannerMemory: structuredClone(state.plannerMemory),
    acceptedTurns: [...structuredClone(state.acceptedTurns), lockedTurn],
    terminalPending: state.terminalPending, outcome: null,
  }
  const presentations = bySide(order, (side): TurnPresentation => ({
    side, startTick, endTick, automatic: lockedTurn.automatic, frames: frames[side],
    assessment: assess(startShips[side], ships[side], lockedTurn.turnIndex, endTick, rules, interruptions[side], turnEvents[side], knowledge[side]),
  }))
  return freezeData({ locked: lockedTurn, nextState, internalEvents, presentations })
}

export const resolveTurn: ResolveTurn = (state, locked, rules, scenario) => resolveTurnInOrder(state, locked, rules, scenario)
