/**
 * Test-only scripted opponents for real-engine combat scenes (TSB-31). Each plans from its own
 * observation, memory and stream only, like any PlanOpponent; they exist so browser and
 * controller tests can reach defeat and mutual destruction before the reactive patrol (TSB-40).
 * They are not part of the application. The missile opponent aims at the measured cell with no
 * lead, so a target that moves away evades it.
 */
import type { PlanOpponent } from '../../../src/contracts'
import { scriptedPatrol } from '../../../src/game'
import { cellOfPosition } from '../../../src/rendering/plotGeometry'

/** Follows the drill route and lasers its first current (else remembered) contact. */
export const firingPatrol: PlanOpponent = (observation, memory, plannerRandomState) => {
  const planned = scriptedPatrol(observation, memory, plannerRandomState)
  const target = observation.contacts.find((contact) => contact.kind === 'current') ?? observation.contacts[0]
  return target ? { ...planned, orders: { ...planned.orders, weapon: { kind: 'laser', contactAlias: target.alias } } } : planned
}

/** Holds fire until its own observation shows damage, then fires like firingPatrol. */
export const retaliatingPatrol: PlanOpponent = (observation, memory, plannerRandomState) => {
  const own = observation.ownShip
  const hit = own.shields.current < own.shields.max || own.hull.current < own.hull.max
  return hit ? firingPatrol(observation, memory, plannerRandomState) : scriptedPatrol(observation, memory, plannerRandomState)
}

/** Follows the drill route and launches a missile at the cell where it currently measures its contact. */
export const missilePatrol: PlanOpponent = (observation, memory, plannerRandomState) => {
  const planned = scriptedPatrol(observation, memory, plannerRandomState)
  const target = observation.contacts.find((contact) => contact.kind === 'current')
  if (!target || observation.ownShip.ammunition.current === 0) return planned
  const aim = cellOfPosition(target.measurement.position, 1000, observation.map)
  return { ...planned, orders: { ...planned.orders, weapon: { kind: 'missile', aim } } }
}

export const OPPONENTS = { scripted: scriptedPatrol, firing: firingPatrol, retaliating: retaliatingPatrol, missile: missilePatrol } as const
export const OPPONENT_NOTES: Readonly<Record<keyof typeof OPPONENTS, string>> = {
  scripted: 'Test opponent: the interim drill script. It follows a set route and does not fire.',
  firing: 'Test opponent: follows the drill route and lasers its first contact every turn.',
  retaliating: 'Test opponent: holds fire until it is hit, then lasers its first contact every turn.',
  missile: 'Test opponent: follows the drill route and launches a missile at its current contact\'s cell each turn.',
}
export type OpponentName = keyof typeof OPPONENTS
