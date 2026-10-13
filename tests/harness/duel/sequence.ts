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
