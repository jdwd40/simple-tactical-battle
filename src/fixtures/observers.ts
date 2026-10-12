import {
  DUEL_RULES, cellCentre, type ContactMemory, type SideObservation,
} from '../contracts/index'
import { STARTUP_PRESENTATION } from './startup'

/** Isolated schema examples, not successive frames of a simulated encounter. */
const measurement = Object.freeze({ position: Object.freeze(cellCentre({ column: 10, row: 10 }, DUEL_RULES)), tick: 300 })
const previousMeasurement = Object.freeze({ position: Object.freeze({ x: 10_420, y: 10_500 }), tick: 299 })
const estimatedVelocity = Object.freeze({ xUnitsPerTick: 80, yUnitsPerTick: 0 })
const current: ContactMemory = Object.freeze({
  alias: 'contact-1', kind: 'current', measurement, previousMeasurement, estimatedVelocity,
  ageTicks: 0, uncertaintyRadiusUnits: 0,
})
const stale: ContactMemory = Object.freeze({
  alias: current.alias, kind: 'stale', measurement, previousMeasurement, estimatedVelocity,
  ageTicks: 10, uncertaintyRadiusUnits: 10 * DUEL_RULES.maxShipSpeedUnitsPerTick,
})

export const OBSERVER_FIXTURES: Readonly<Record<'none' | 'current' | 'stale', SideObservation>> = Object.freeze({
  none: STARTUP_PRESENTATION.observation,
  current: Object.freeze({ ...STARTUP_PRESENTATION.observation, turnIndex: 3, tick: 300, contacts: Object.freeze([current]) }),
  stale: Object.freeze({ ...STARTUP_PRESENTATION.observation, turnIndex: 3, tick: 310, contacts: Object.freeze([stale]) }),
})
