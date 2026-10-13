import { describe, expect, it } from 'vitest'
import type { PlannerMemory, SideObservation } from '../contracts/public'
import { DUEL_MAP, DUEL_RULES, SAMPLE_PLAYER_OBSERVATION, cellCentre } from '../contracts'
import { DRILL_PATROL_LOOP, scriptedPatrol } from './scriptedPatrol'

const memory: PlannerMemory = { policy: 'PATROL', patrolOrder: [], patrolIndex: 0, rememberedContacts: [], searchDestination: null }
const patrolAt = (column: number, row: number, turnIndex = 2): SideObservation => ({
  ...SAMPLE_PLAYER_OBSERVATION, side: 'patrol', turnIndex,
  ownShip: { ...SAMPLE_PLAYER_OBSERVATION.ownShip, shipClass: 'patrol-frigate', position: cellCentre({ column, row }, DUEL_RULES) },
})

describe('interim drill patrol', () => {
  it('uses only open public cells for its loop', () => {
    for (const cell of DRILL_PATROL_LOOP) {
      expect(DUEL_MAP.asteroidCells.some((rock) => rock.column === cell.column && rock.row === cell.row)).toBe(false)
    }
  })

  it('heads for its current waypoint and replans to the next one on arrival, passing randomness through', () => {
    const away = scriptedPatrol(patrolAt(16, 10), memory, 1234)
    expect(away.orders).toEqual({ turnIndex: 2, movement: { kind: 'destination', cell: DRILL_PATROL_LOOP[0] }, sensor: 'passive', cloak: false, weapon: { kind: 'hold' } })
    expect(away.memory.patrolIndex).toBe(0)
    expect(away.plannerRandomState).toBe(1234)
    const first = DRILL_PATROL_LOOP[0]
    const arrived = scriptedPatrol(patrolAt(first.column, first.row), away.memory, 1234)
    expect(arrived.memory.patrolIndex).toBe(1)
    expect(arrived.orders.movement).toEqual({ kind: 'destination', cell: DRILL_PATROL_LOOP[1] })
  })

  it('depends only on its own observation: the same input always gives the same orders', () => {
    const observation = patrolAt(12, 9)
    expect(scriptedPatrol(observation, memory, 7)).toEqual(scriptedPatrol(structuredClone(observation), memory, 7))
  })
})
