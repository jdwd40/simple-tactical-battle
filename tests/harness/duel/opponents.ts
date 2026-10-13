/**
 * Test-only scripted opponents for real-engine combat scenes (TSB-31). Each plans from its own
 * observation, memory and stream only, like any PlanOpponent; they exist so browser and
 * controller tests can reach defeat and mutual destruction before the reactive patrol (TSB-40).
 * They are not part of the application.
 */
import type { PlanOpponent } from '../../../src/contracts'
import { scriptedPatrol } from '../../../src/game'

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

export const OPPONENTS = { scripted: scriptedPatrol, firing: firingPatrol, retaliating: retaliatingPatrol } as const
export const OPPONENT_NOTES: Readonly<Record<keyof typeof OPPONENTS, string>> = {
  scripted: 'Test opponent: the interim drill script. It follows a set route and does not fire.',
  firing: 'Test opponent: follows the drill route and lasers its first contact every turn.',
  retaliating: 'Test opponent: holds fire until it is hit, then lasers its first contact every turn.',
}
export type OpponentName = keyof typeof OPPONENTS
