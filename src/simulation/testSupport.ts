/** Test-only helpers for scripting both sides' orders; not imported by application code. */
import type { AcceptedTurn, SimulationState } from '../contracts/private'
import type { Cell, SensorOrder, TurnOrders } from '../contracts/public'

export function orders(turnIndex: number, destination: Cell | null, cloak = false, sensor: SensorOrder = 'passive'): TurnOrders {
  return {
    turnIndex, movement: destination === null ? { kind: 'hold' } : { kind: 'destination', cell: destination },
    sensor, cloak, weapon: { kind: 'hold' },
  }
}
export function lock(state: SimulationState, player: TurnOrders | null, patrol: TurnOrders | null): AcceptedTurn {
  return { turnIndex: state.turnIndex, startTick: state.tick, automatic: false, orders: { player, patrol } }
}
