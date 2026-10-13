import type { MissileState, PrivateKnowledge, ShipState } from '../contracts/private'
import type { Outcome, PublicMap, Ruleset, Side, Tick, UnfiredReason } from '../contracts/public'
import { cellCentre } from '../scenarios/geometry'
import { hasLineOfSight, withinRange } from './geometry'

/** Canonical reporting order for unfired reasons; never an evaluation priority. */
export const UNFIRED_ORDER: readonly UnfiredReason[] = ['no-current-lock', 'out-of-range', 'line-of-sight-blocked', 'cooldown', 'insufficient-energy', 'own-destroyed']

/** A successful scan or discharge: exposure from `now`, cloak off and latched for the rest of the turn. */
export function withActivity(ship: ShipState, now: Tick, rules: Ruleset): ShipState {
  return {
    ...ship, cloakActive: false, cloakLatch: ship.cloakLatch === 'none' ? 'activity' : ship.cloakLatch,
    exposureUntilTick: Math.max(ship.exposureUntilTick, now + rules.timing.exposureTicks),
  }
}

export type WeaponProposal =
  | { readonly fire: true; readonly weapon: 'laser'; readonly target: ShipState }
  | { readonly fire: true; readonly weapon: 'missile' }
  | { readonly fire: false; readonly reasons: readonly UnfiredReason[] }

/**
 * Stage 5 for one unspent laser intent, from the pre-damage snapshot. The alias resolves through
 * the shooter's own memory and locks only on a target in this tick's fresh pre-fire sightings, so a
 * stale contact waits and never reaches an unseen true position. `null`: no pending laser intent.
 */
export function proposeLaser(
  shooter: ShipState, knowledge: PrivateKnowledge, freshTargets: readonly ShipState[], now: Tick, rules: Ruleset, map: PublicMap,
): WeaponProposal | null {
  const weapon = shooter.orders?.weapon
  if (!shooter.alive || weapon?.kind !== 'laser' || shooter.weaponIntentSpent) return null
  const entityId = knowledge.contacts.find(({ contact }) => contact.alias === weapon.contactAlias)?.entityId
  const target = freshTargets.find((ship) => ship.entityId === entityId)
  const reasons: UnfiredReason[] = []
  if (target === undefined) reasons.push('no-current-lock')
  else {
    if (!withinRange(shooter.position, target.position, rules.laser.rangeUnits)) reasons.push('out-of-range')
    if (!hasLineOfSight(shooter.position, target.position, map, rules)) reasons.push('line-of-sight-blocked')
  }
  if (shooter.laserReadyTick > now) reasons.push('cooldown')
  // Weapon energy is what remains after the stage-2 grants (regen → cloak → pulse → propulsion).
  if (shooter.energyMilli < rules.laser.costMilli) reasons.push('insufficient-energy')
  return target !== undefined && reasons.length === 0 ? { fire: true, weapon: 'laser', target } : { fire: false, reasons }
}

/**
 * Stage 5 for one unspent missile intent: a plotted cell needs no lock, range or sightline, only
 * the absolute cooldown and the energy left after the stage-2 grants. Ammunition was checked at commit.
 */
export function proposeMissile(shooter: ShipState, now: Tick, rules: Ruleset): WeaponProposal | null {
  if (!shooter.alive || shooter.orders?.weapon.kind !== 'missile' || shooter.weaponIntentSpent) return null
  const reasons: UnfiredReason[] = []
  if (shooter.missileReadyTick > now) reasons.push('cooldown')
  if (shooter.energyMilli < rules.missile.costMilli) reasons.push('insufficient-energy')
  return reasons.length === 0 ? { fire: true, weapon: 'missile' } : { fire: false, reasons }
}

/** Collected stage-5 launch: cost, one round, spent intent, cooldown, activity; travel begins next tick. */
export function launchMissile(ship: ShipState, now: Tick, rules: Ruleset): { readonly ship: ShipState; readonly missile: MissileState } {
  const weapon = ship.orders?.weapon
  if (weapon?.kind !== 'missile' || ship.ammunition <= 0) throw new Error(`${ship.side} cannot launch without a committed missile and ammunition`)
  const position = { x: ship.position.x, y: ship.position.y }
  const missile: MissileState = {
    id: `${ship.side}-missile-${rules.ships[ship.shipClass].missileAmmunition - ship.ammunition + 1}`,
    launcherEntityId: ship.entityId, launcherSide: ship.side, position, aim: { column: weapon.aim.column, row: weapon.aim.row },
    aimPosition: cellCentre(weapon.aim, rules), launchPosition: { ...position }, distanceTravelledUnits: 0,
    launchTick: now, expiresAtTick: now + rules.timing.missileLifetimeTicks,
  }
  return {
    ship: {
      ...withActivity(ship, now, rules), energyMilli: ship.energyMilli - rules.missile.costMilli, ammunition: ship.ammunition - 1,
      weaponIntentSpent: true, missileReadyTick: now + rules.timing.missileCooldownTicks,
    },
    missile,
  }
}

/** Collected stage-5 consequences of one discharge: cost, spent intent, cooldown, exposure and cloak latch. */
export function dischargeLaser(ship: ShipState, now: Tick, rules: Ruleset): ShipState {
  return {
    ...withActivity(ship, now, rules), energyMilli: ship.energyMilli - rules.laser.costMilli,
    weaponIntentSpent: true, laserReadyTick: now + rules.timing.laserCooldownTicks,
  }
}

export interface Hit { readonly ship: ShipState; readonly shieldsLost: number; readonly hullLost: number; readonly destroyed: boolean }
/** Stage 6 for one ship: summed batch damage, shields before hull; destroyed when hull reaches zero. */
export function applyDamage(ship: ShipState, damage: number, now: Tick): Hit {
  if (damage === 0 || !ship.alive) return { ship, shieldsLost: 0, hullLost: 0, destroyed: false }
  const shieldsLost = Math.min(ship.shields, damage)
  const hullLost = Math.min(ship.hull, damage - shieldsLost)
  const hull = ship.hull - hullLost
  const destroyed = hull === 0
  return {
    ship: { ...ship, shields: ship.shields - shieldsLost, hull, ...(destroyed ? { alive: false, destructionTick: now, cloakActive: false } : {}) },
    shieldsLost, hullLost, destroyed,
  }
}

/** Completed-boundary classification: a destroyed ship and no live missiles. */
export function classifyOutcome(ships: Readonly<Record<Side, ShipState>>, liveMissiles: number): Outcome | null {
  if (liveMissiles > 0) return null
  if (!ships.player.alive && !ships.patrol.alive) return 'mutual-destruction'
  if (!ships.patrol.alive) return 'victory'
  return ships.player.alive ? null : 'defeat'
}
