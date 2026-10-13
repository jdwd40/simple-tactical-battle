import { SAMPLE_PLAYER_OBSERVATION, type ContactMemory, type Position, type PublicReplayFrame } from '../contracts'

/** Minimal public frames for unit tests, derived from the contract sample observation. */
export function frameAt(tick: number, position: Position, contacts: readonly ContactMemory[] = [], extra: Partial<PublicReplayFrame['observation']['ownShip']> = {}): PublicReplayFrame {
  const observation = {
    ...SAMPLE_PLAYER_OBSERVATION,
    tick,
    ownShip: { ...SAMPLE_PLAYER_OBSERVATION.ownShip, position, ...extra },
    contacts,
  }
  return { tick, observation, events: [] }
}

export function current(alias: string, position: Position, tick: number): ContactMemory {
  return { alias, kind: 'current', measurement: { position, tick }, ageTicks: 0, uncertaintyRadiusUnits: 0 }
}

export function stale(alias: string, position: Position, tick: number, ageTicks: number, radius: number): ContactMemory {
  return { alias, kind: 'stale', measurement: { position, tick }, ageTicks, uncertaintyRadiusUnits: radius }
}
