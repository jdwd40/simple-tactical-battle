/**
 * Deterministic main-game mission against the REAL patrol AI (TSB-40) on seed 17 (TSB-41).
 * Same seed and orders always give the same encounter. On the accepted engine and planner:
 * the frigate scans while patrolling, engages and hits at 101 and 217, loses Shadow-Dancer
 * after it cloaks and withdraws (contact lost at 246, planner INVESTIGATE then SEARCH),
 * reacquires it, and destroys it at 837; defeat is revealed at 900.
 */
import type { Cell } from '../../src/contracts'

export interface MissionTurn {
  readonly destination: Cell | null
  readonly cloak: boolean
  /** Laser at the first known contact. */
  readonly laser: boolean
}

export const MISSION_SEED = 17
export const HIDE_AND_SEEK: readonly MissionTurn[] = [
  { destination: { column: 10, row: 9 }, cloak: false, laser: false },
  { destination: { column: 10, row: 9 }, cloak: false, laser: true },
  { destination: { column: 2, row: 17 }, cloak: true, laser: false },
  { destination: { column: 2, row: 17 }, cloak: true, laser: false },
  { destination: { column: 2, row: 17 }, cloak: true, laser: false },
  { destination: { column: 2, row: 17 }, cloak: true, laser: false },
  { destination: { column: 2, row: 17 }, cloak: true, laser: false },
  { destination: null, cloak: false, laser: true },
  { destination: null, cloak: false, laser: true },
]
export const HIDE_AND_SEEK_ENDING = { outcome: 'defeat', revealTick: 900 } as const
