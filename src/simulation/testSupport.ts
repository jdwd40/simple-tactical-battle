/** Test-only helpers for scripting both sides' orders; not imported by application code. */
import type { AcceptedTurn, ShipState, SimulationState } from '../contracts/private'
import type { Cell, SensorOrder, Side, TurnOrders } from '../contracts/public'

export function orders(turnIndex: number, destination: Cell | null, cloak = false, sensor: SensorOrder = 'passive'): TurnOrders {
  return {
    turnIndex, movement: destination === null ? { kind: 'hold' } : { kind: 'destination', cell: destination },
    sensor, cloak, weapon: { kind: 'hold' },
  }
}
export function lock(state: SimulationState, player: TurnOrders | null, patrol: TurnOrders | null): AcceptedTurn {
  return { turnIndex: state.turnIndex, startTick: state.tick, automatic: false, orders: { player, patrol } }
}
export function withShip(state: SimulationState, side: Side, patch: Partial<ShipState>): SimulationState {
  return { ...state, ships: { ...state.ships, [side]: { ...state.ships[side], ...patch } } }
}
