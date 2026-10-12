/** Presentation/AI entry point. No private state, whole future turns or spawns. */
export type * from './public'
export { DUEL_RULES, DUEL_MAP, DUEL_PUBLIC_SCENARIO } from '../scenarios/public'
export { SAMPLE_PLAYER_OBSERVATION } from '../scenarios/sample'
export { cellCentre, isMapCell, isAsteroidCell } from '../scenarios/geometry'
export { aftermathWindowBound } from '../scenarios/rules'
