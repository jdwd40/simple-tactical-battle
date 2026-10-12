/** Headless private-engine fixtures only; never import these from presentation. */
import type { Position, TurnOrders } from '../../contracts/public'

type Policy = Pick<TurnOrders, 'movement' | 'cloak'>
export interface MovementSequence {
  readonly id: string
  readonly seed: number
  readonly turns: readonly { readonly player: Policy; readonly patrol: Policy }[]
  readonly finalPositions: Readonly<Record<'player' | 'patrol', Position>>
}

export const MOVEMENT_SEQUENCES: readonly MovementSequence[] = [
  {
    id: 'cross-separate-reacquire', seed: 17,
    turns: [
      { player: { movement: { kind: 'destination', cell: { column: 16, row: 10 } }, cloak: true }, patrol: { movement: { kind: 'destination', cell: { column: 3, row: 10 } }, cloak: false } },
      { player: { movement: { kind: 'destination', cell: { column: 16, row: 10 } }, cloak: true }, patrol: { movement: { kind: 'destination', cell: { column: 3, row: 10 } }, cloak: false } },
      { player: { movement: { kind: 'hold' }, cloak: false }, patrol: { movement: { kind: 'hold' }, cloak: false } },
      { player: { movement: { kind: 'destination', cell: { column: 2, row: 10 } }, cloak: false }, patrol: { movement: { kind: 'hold' }, cloak: false } },
      { player: { movement: { kind: 'hold' }, cloak: true }, patrol: { movement: { kind: 'hold' }, cloak: false } },
      { player: { movement: { kind: 'destination', cell: { column: 19, row: 10 } }, cloak: true }, patrol: { movement: { kind: 'hold' }, cloak: false } },
      { player: { movement: { kind: 'destination', cell: { column: 19, row: 10 } }, cloak: true }, patrol: { movement: { kind: 'hold' }, cloak: false } },
    ],
    finalPositions: { player: { x: 19_500, y: 10_500 }, patrol: { x: 3500, y: 10_500 } },
  },
  {
    id: 'asteroid-route-revision-hold', seed: 0xdecafbad,
    turns: [
      { player: { movement: { kind: 'destination', cell: { column: 10, row: 0 } }, cloak: true }, patrol: { movement: { kind: 'destination', cell: { column: 4, row: 4 } }, cloak: false } },
      { player: { movement: { kind: 'destination', cell: { column: 10, row: 0 } }, cloak: true }, patrol: { movement: { kind: 'destination', cell: { column: 4, row: 4 } }, cloak: false } },
      { player: { movement: { kind: 'destination', cell: { column: 2, row: 2 } }, cloak: false }, patrol: { movement: { kind: 'destination', cell: { column: 17, row: 3 } }, cloak: false } },
      { player: { movement: { kind: 'destination', cell: { column: 2, row: 2 } }, cloak: false }, patrol: { movement: { kind: 'destination', cell: { column: 17, row: 3 } }, cloak: false } },
      { player: { movement: { kind: 'hold' }, cloak: true }, patrol: { movement: { kind: 'hold' }, cloak: false } },
    ],
    finalPositions: { player: { x: 2500, y: 2500 }, patrol: { x: 17_500, y: 3500 } },
  },
]
