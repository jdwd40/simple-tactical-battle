/** Application composition entry. Imports the private engine; only App.tsx may import this. */
export { createGameController, SIMULATION_ENGINE } from './createGameController'
export type { ApplicationController, EngineApi, EngineCapabilities, GameControllerOptions } from './createGameController'
export { browserClock, createManualClock } from './presentationClock'
export type { ManualClock, PresentationClock } from './presentationClock'
export { randomSeed, seedFromSearch } from './seed'
export { DRILL_PATROL_LOOP, scriptedPatrol } from './scriptedPatrol'
