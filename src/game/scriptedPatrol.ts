import type { Cell, PlanOpponent } from '../contracts/public'

/**
 * INTERIM movement-drill opponent, replaced by the TSB-40 planner. The patrol cycles a
 * fixed loop of public cells. It reads only its own observation and planner memory, never
 * the player's orders or position, and consumes no randomness.
 */
export const DRILL_PATROL_LOOP: readonly Cell[] = Object.freeze([
  { column: 16, row: 4 }, { column: 10, row: 9 }, { column: 16, row: 16 }, { column: 17, row: 10 },
].map((cell) => Object.freeze(cell)))

export const scriptedPatrol: PlanOpponent = (observation, memory, plannerRandomState) => {
  // Contract world units: 1000 per cell (src/contracts/README.md).
  const units = 1000
  const position = observation.ownShip.position
  const here = { column: Math.floor(position.x / units), row: Math.floor(position.y / units) }
  const { map } = observation
  const open = (cell: Cell) => cell.column < map.columns && cell.row < map.rows
    && !map.asteroidCells.some((rock) => rock.column === cell.column && rock.row === cell.row)
  const loop = DRILL_PATROL_LOOP.filter(open)
  const hold = { turnIndex: observation.turnIndex, movement: { kind: 'hold' }, sensor: 'passive', cloak: false, weapon: { kind: 'hold' } } as const
  if (loop.length === 0) return { orders: hold, memory, plannerRandomState }
  // Keep heading for the current waypoint; at it, replan to the next one.
  let index = memory.patrolIndex % loop.length
  if (loop[index].column === here.column && loop[index].row === here.row) index = (index + 1) % loop.length
  const cell = loop[index]
  return {
    orders: {
      turnIndex: observation.turnIndex,
      movement: { kind: 'destination', cell: { column: cell.column, row: cell.row } },
      sensor: 'passive',
      cloak: false,
      weapon: { kind: 'hold' },
    },
    memory: { ...memory, patrolOrder: loop, patrolIndex: index },
    plannerRandomState,
  }
}
