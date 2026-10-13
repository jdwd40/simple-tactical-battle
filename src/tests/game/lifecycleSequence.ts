import type { MovementOrder } from '../../contracts/public'

/** Same legal player input for every seed/schedule; real scripted patrol remains unchanged. */
export const LIFECYCLE_SEQUENCE: readonly MovementOrder[] = [
  { kind: 'destination', cell: { column: 16, row: 10 } },
  { kind: 'destination', cell: { column: 16, row: 10 } },
  { kind: 'destination', cell: { column: 19, row: 19 } },
]
export const LIFECYCLE_SEEDS = [17, 4242] as const
