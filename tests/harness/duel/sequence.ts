/**
 * Seed 17 laser duel used by the real-engine controller and browser tests (TSB-31). The same
 * legal player orders end, on the real engine, in victory against the drill patrol (revealed
 * at 700), defeat against firingPatrol (own destruction at 501, revealed at 600) and mutual
 * destruction against retaliatingPatrol (both at 601, revealed at 700).
 */
import type { Cell } from '../../../src/contracts'

export interface DuelTurn {
  /** Destination for the turn, or null to hold. */
  readonly destination: Cell | null
  /** Laser at contact-1, the only contact. */
  readonly laser: boolean
}

export const DUEL_SEED = 17
export const LASER_DUEL: readonly DuelTurn[] = [
  { destination: { column: 10, row: 9 }, laser: false },
  { destination: { column: 10, row: 9 }, laser: false },
  { destination: null, laser: true },
  { destination: null, laser: true },
  { destination: { column: 16, row: 15 }, laser: true },
  { destination: null, laser: true },
  { destination: { column: 17, row: 10 }, laser: true },
]

/** Missile scenes on seed 17 (real engine). Moves are cells or null (hold); aim is a cell or null. */
export interface MissileTurn {
  readonly destination: Cell | null
  readonly laser?: boolean
  readonly missileAim?: Cell | null
}

/** Against the drill patrol: a missile aimed at column 6, row 4 hits the asteroid face at tick 223. */
export const ASTEROID_SHOT: readonly MissileTurn[] = [
  { destination: { column: 10, row: 9 } },
  { destination: { column: 10, row: 9 } },
  { destination: null, missileAim: { column: 6, row: 4 } },
]

/** Against missilePatrol: hit at 204 holding near it, then a missile launched at 301 lands harmlessly at 327 after the move away. */
export const EVASION: readonly MissileTurn[] = [
  { destination: { column: 10, row: 9 } },
  { destination: { column: 10, row: 9 } },
  { destination: { column: 6, row: 12 } },
  { destination: { column: 3, row: 15 } },
]

/** Against missilePatrol: the turn-4 missile is lost behind cover at 320, kept as a last sighting until 469. */
export const STALE_TRACK: readonly MissileTurn[] = [...EVASION.slice(0, 3), { destination: { column: 6, row: 17 } }, { destination: null }]

/**
 * Against firingPatrol: LASER_DUEL's first five turns, then a missile at column 0, row 0. The
 * player is destroyed at 501 as it launches; the missile flies on into one automatic window and
 * arrives harmlessly at 611; defeat is revealed at 700.
 */
export const DEAD_LAUNCHER: readonly MissileTurn[] = [
  ...LASER_DUEL.slice(0, 5),
  { destination: null, missileAim: { column: 0, row: 0 } },
]
