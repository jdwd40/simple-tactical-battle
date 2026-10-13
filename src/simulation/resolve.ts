import type {
  AcceptedTurn, InternalEvent, MissileState, PrivateKnowledge, ResolveTurn, Scenario, ShipState, SimulationState, TurnPresentation, TurnResolution,
} from '../contracts/private'
import type {
  InterruptionReason, Outcome, OwnAssessment, OwnInterruption, Position, PublicMap, PublicReplayFrame, Ruleset, Side, Tick, TurnOrders, UnfiredReason, VisibleEvent,
} from '../contracts/public'
import { freezeData } from '../scenarios/freeze'
import { cellCentre } from '../scenarios/geometry'
import { publicScenario } from '../scenarios/private'
import { hasLineOfSight, samePosition, withinRange } from './geometry'
import { roundedPosition, stepMissile, updateHostileMissiles, updateOwnTelemetry, type ShipMotion } from './missiles'
import { assertSessionMatches, cloakObservation, observeSide, projectObservation } from './observation'
import { advanceRoute, idleRoute, planMovement, routeHeading, routePosition } from './route'
import { detects, fundTick, recordObservedDestruction, updateContacts } from './sensing'
import { validateOrders } from './validation'
import { applyDamage, classifyOutcome, dischargeLaser, launchMissile, proposeLaser, proposeMissile, UNFIRED_ORDER, withActivity } from './weapons'

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

interface WeaponRecord { firedTick: Tick | null; readonly reasons: Set<UnfiredReason> }

function weaponAttempt(startShip: ShipState, record: WeaponRecord): OwnAssessment['weaponAttempt'] {
  const weapon = startShip.orders?.weapon.kind
  if (weapon !== 'laser' && weapon !== 'missile') return { kind: 'not-requested' }
  if (record.firedTick !== null) return { kind: 'fired', tick: record.firedTick, weapon }
  return { kind: 'unfired', weapon, reasons: UNFIRED_ORDER.filter((reason) => record.reasons.has(reason)) }
}

/**
 * Safe explanation of a continuing encounter after a destruction this observer knows of (its own,
 * or an observed opponent's): own flying missiles first, else the observed destruction. Built from
 * own knowledge only; an unobserved enemy death therefore never produces one.
 */
function ordnancePending(ship: ShipState, knowledge: PrivateKnowledge, ended: boolean): OwnAssessment['ordnancePending'] {
  const observedKill = knowledge.observedOpponentDestructionTick !== undefined
  if (ended || (ship.alive && !observedKill)) return null
  const missileIds = knowledge.ownMissiles.filter((missile) => missile.status === 'flying').map((missile) => missile.id)
  if (missileIds.length > 0) return { reason: 'known-own-missiles', missileIds }
  return observedKill ? { reason: 'observed-opponent-destroyed' } : null
}

function assess(
  startShip: ShipState, endShip: ShipState, turnIndex: number, endTick: Tick, rules: Ruleset, pulse: PulseOutcome, weapon: WeaponRecord,
  interruptions: readonly OwnInterruption[], events: readonly VisibleEvent[], knowledge: PrivateKnowledge, ended: boolean,
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
    weaponAttempt: weaponAttempt(startShip, weapon),
    contacts: knowledge.contacts.map(({ contact }) => structuredClone(contact)),
    events: [...events], ordnancePending: ordnancePending(endShip, knowledge, ended),
  }
}

/**
 * Resolves one committed window of exactly `turnTicks` ticks. Each stage reads the same snapshot
 * for both sides; `order` only chooses evaluation order and cannot change output. A window is
 * `automatic` exactly while the player ship is destroyed; destroyed ships take `null` orders.
 */
export function resolveTurnInOrder(
  state: SimulationState, locked: AcceptedTurn, rules: Ruleset, scenario: Scenario, order: readonly Side[] = SIDES,
): TurnResolution {
  assertSessionMatches(state, rules, scenario)
  if (state.outcome !== null) throw new Error('The encounter already has a final outcome')
  if (locked.turnIndex !== state.turnIndex || locked.startTick !== state.tick) throw new Error('Locked turn does not match the session turn/tick')
  if (locked.automatic !== !state.ships.player.alive) throw new Error('A window is automatic exactly while the player ship is destroyed')
  const map = publicScenario(scenario).map
  const lockedTurn: AcceptedTurn = structuredClone(locked)
  const startTick = state.tick
  const endTick = startTick + rules.timing.turnTicks
  const startShips = bySide(order, (side) => commitOrders(state, side, lockedTurn.orders[side], rules, scenario, map))
  let ships = startShips
  let knowledge = bySide(order, (side) => structuredClone(state.knowledge[side]))
  const interruptions = bySide(order, (): OwnInterruption[] => [])
  const pulses = bySide(order, (): { outcome: PulseOutcome } => ({ outcome: null }))
  const weapons = bySide(order, (): WeaponRecord => ({ firedTick: null, reasons: new Set() }))
  let missiles: readonly MissileState[] = structuredClone(state.missiles)
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
    const proposals = bySide(order, (side) => (snapshot[side].orders?.weapon.kind === 'missile'
      ? proposeMissile(snapshot[side], now, rules)
      : proposeLaser(snapshot[side], knowledge[side], preFire[side] ? [snapshot[opponent(side)]] : [], now, rules, map)))
    const beams = bySide(order, (side) => {
      const proposal = proposals[side]
      return proposal?.fire === true && proposal.weapon === 'laser' ? proposal.target : null
    })
    const launches = bySide(order, (side) => (proposals[side]?.fire === true && beams[side] === null ? launchMissile(snapshot[side], now, rules) : null))
    const armed = bySide(order, (side) => launches[side]?.ship ?? (beams[side] === null ? snapshot[side] : dischargeLaser(snapshot[side], now, rules)))
    const discharged = (side: Side) => (beams[side] !== null ? 'laser' : launches[side] !== null ? 'missile' : null)
    // Stage 6: missiles present at tick start sweep against the pre-damage alive set; new ones wait a tick.
    const motion: ShipMotion[] = SIDES.filter((side) => snapshot[side].alive)
      .map((side) => ({ entityId: snapshot[side].entityId, side, start: before[side].position, end: snapshot[side].position }))
    const steps = missiles.map((missile) => stepMissile(missile, motion, now, rules, map))
    const resolved = steps.flatMap((step) => (step.resolution === null ? [] : [{ missile: step.missile, resolution: step.resolution }]))
    // One damage batch: every beam and every eligible missile victim; enumeration cannot cancel a hit.
    const beamSources = (ship: ShipState) => SIDES.filter((side) => beams[side]?.entityId === ship.entityId).map((side) => snapshot[side].entityId)
    const missileSources = (ship: ShipState) => resolved.filter(({ resolution }) => resolution.victimIds.includes(ship.entityId)).map(({ missile }) => missile.id)
    const hits = bySide(order, (side) => applyDamage(armed[side],
      beamSources(armed[side]).length * rules.laser.damage + missileSources(armed[side]).length * rules.missile.damage, now))
    const launched = SIDES.flatMap((side) => {
      const launch = launches[side]
      return launch === null ? [] : [launch.missile]
    })
    missiles = [...steps.filter((step) => step.resolution === null).map((step) => step.missile), ...launched]
    // Stage 7: emissions are sensed against the pre-damage state (no second weapon pass this tick)
    // and coalesce with pre-fire sightings into one measurement per tick.
    const sightings = bySide(order, (side) => {
      const target = armed[opponent(side)]
      return preFire[side] || detects(armed[side], target, moved[opponent(side)], rules, map, now)
        ? [{ entityId: target.entityId, position: target.position }] : []
    })
    ships = bySide(order, (side) => hits[side].ship)
    // Ordnance is seen by observers alive at tick start, within funded missile range and line of sight.
    const ordnanceInSight = bySide(order, (side) => {
      const observer = armed[side]
      const range = observer.trackingUntilTick > now ? rules.sensors.activeMissileRangeUnits : rules.sensors.passiveMissileRangeUnits
      return (at: Position) => observer.alive && withinRange(observer.position, at, range) && hasLineOfSight(observer.position, at, map, rules)
    })
    const updates = bySide(order, (side) => {
      const contactUpdate = updateContacts(knowledge[side], sightings[side], now, rules, map)
      const target = sightings[side][0]
      const remembered = target !== undefined && hits[opponent(side)].destroyed
        ? recordObservedDestruction(contactUpdate.knowledge, target.entityId, now) : contactUpdate.knowledge
      const seen = ordnanceInSight[side]
      const hostile = missiles.filter((missile) => missile.launcherSide !== side && seen(missile.position))
      const ended = new Set(resolved.filter(({ missile, resolution }) => missile.launcherSide !== side && seen(resolution.point)).map(({ missile }) => missile.id))
      const ordnanceUpdate = updateHostileMissiles(remembered, hostile.map((missile) => ({ missileId: missile.id, position: missile.position })), ended, now, rules, map)
      const ownMissiles = updateOwnTelemetry(remembered.ownMissiles, missiles.filter((missile) => missile.launcherSide === side),
        resolved.filter(({ missile }) => missile.launcherSide === side), now)
      return { knowledge: { ...ordnanceUpdate.knowledge, ownMissiles }, events: contactUpdate.events, ordnanceEvents: ordnanceUpdate.events }
    })
    knowledge = bySide(order, (side) => updates[side].knowledge)
    if (now === endTick) outcome = classifyOutcome(ships, missiles.length)
    const internal: Body<InternalEvent>[] = resolved.map(({ missile, resolution }) => ({
      kind: 'missile-resolved', missileId: missile.id, position: roundedPosition(resolution.point), fraction: resolution.fraction, reason: resolution.reason,
      ...(resolution.directVictimId === undefined ? {} : { directVictimId: resolution.directVictimId }),
    }))
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
      if (proposal?.fire === false) for (const reason of proposal.reasons) weapons[side].reasons.add(reason)
      const target = beams[side]
      const launch = launches[side]
      const weapon = snapshot[side].orders?.weapon
      const position = { ...armed[side].position }
      if (target !== null && weapon?.kind === 'laser') {
        weapons[side].firedTick = now
        visible.push({ kind: 'own-shot', position, weapon: { kind: 'laser', contactAlias: weapon.contactAlias } })
        visible.push({ kind: 'own-energy', deltaMilli: -rules.laser.costMilli, reason: 'laser' })
        internal.push({ kind: 'shot', entityId: ship.entityId, weapon: 'laser', targetEntityId: target.entityId, position })
        internal.push({ kind: 'resource', entityId: ship.entityId, energyDeltaMilli: -rules.laser.costMilli, ammunitionDelta: 0, reason: 'laser' })
      }
      if (launch !== null && weapon?.kind === 'missile') {
        weapons[side].firedTick = now
        const aim = { ...weapon.aim }
        visible.push({ kind: 'own-shot', position, weapon: { kind: 'missile', aim } })
        visible.push({ kind: 'own-energy', deltaMilli: -rules.missile.costMilli, reason: 'missile' })
        visible.push({ kind: 'own-ammunition', delta: -1 })
        const telemetry = knowledge[side].ownMissiles.find((missile) => missile.id === launch.missile.id)
        if (telemetry !== undefined) visible.push({ kind: 'own-missile', missile: structuredClone(telemetry) })
        internal.push({ kind: 'shot', entityId: ship.entityId, weapon: 'missile', missileId: launch.missile.id, aim, position })
        internal.push({ kind: 'resource', entityId: ship.entityId, energyDeltaMilli: -rules.missile.costMilli, ammunitionDelta: -1, reason: 'missile' })
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
      for (const event of updates[side].ordnanceEvents) visible.push(structuredClone(event))
      // Observed consequences: built only from this side's own sightings and aliases.
      const enemy = armed[opponent(side)]
      const seenAlias = sightings[side].length === 0 ? undefined
        : knowledge[side].contacts.find((entry) => entry.entityId === enemy.entityId)?.contact.alias
      const enemyWeapon = discharged(opponent(side))
      if (enemyWeapon !== null && seenAlias !== undefined) {
        visible.push({ kind: 'observed-shot', sourceAlias: seenAlias, position: { ...enemy.position }, weapon: enemyWeapon })
      }
      if (target !== null && seenAlias !== undefined) {
        visible.push({ kind: 'observed-impact', position: { ...target.position }, weapon: 'laser', contactAlias: seenAlias })
      }
      // Detonations this observer saw (not ones that struck it directly: those are own damage).
      for (const { resolution } of resolved) {
        if (resolution.reason === 'expiry' || resolution.reason === 'exit' || resolution.directVictimId === ship.entityId) continue
        if (!ordnanceInSight[side](resolution.point)) continue
        const victimAlias = resolution.directVictimId === enemy.entityId ? seenAlias : undefined
        visible.push({ kind: 'observed-impact', position: roundedPosition(resolution.point), weapon: 'missile', ...(victimAlias === undefined ? {} : { contactAlias: victimAlias }) })
      }
      for (const { missile } of resolved) {
        const telemetry = missile.launcherSide === side ? knowledge[side].ownMissiles.find((own) => own.id === missile.id) : undefined
        if (telemetry !== undefined) visible.push({ kind: 'own-missile', missile: structuredClone(telemetry) })
      }
      const hit = hits[side]
      if (hit.shieldsLost + hit.hullLost > 0) {
        visible.push({ kind: 'own-damage', shieldsLost: hit.shieldsLost, hullLost: hit.hullLost })
        internal.push({ kind: 'damage', targetEntityId: ship.entityId, sourceIds: [...beamSources(armed[side]), ...missileSources(armed[side])], shieldsLost: hit.shieldsLost, hullLost: hit.hullLost })
      }
      if (hits[opponent(side)].destroyed && seenAlias !== undefined) {
        visible.push({ kind: 'observed-destruction', contactAlias: seenAlias, position: { ...enemy.position } })
      }
      if (hit.destroyed) {
        if (weapon !== undefined && weapon.kind !== 'hold' && weapons[side].firedTick === null) weapons[side].reasons.add('own-destroyed')
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
    ships, missiles, knowledge, plannerMemory: structuredClone(state.plannerMemory),
    acceptedTurns: [...structuredClone(state.acceptedTurns), lockedTurn],
    // Private: a ship is destroyed but live ordnance postpones the boundary classification.
    terminalPending: outcome === null && !(ships.player.alive && ships.patrol.alive),
    outcome: outcome === null ? null : { outcome, revealTick: endTick },
  }
  const presentations = bySide(order, (side): TurnPresentation => ({
    side, startTick, endTick, automatic: lockedTurn.automatic, frames: frames[side],
    assessment: assess(startShips[side], ships[side], lockedTurn.turnIndex, endTick, rules, pulses[side].outcome, weapons[side], interruptions[side], turnEvents[side], knowledge[side], outcome !== null),
  }))
  return freezeData({ locked: lockedTurn, nextState, internalEvents, presentations })
}

export const resolveTurn: ResolveTurn = (state, locked, rules, scenario) => resolveTurnInOrder(state, locked, rules, scenario)
