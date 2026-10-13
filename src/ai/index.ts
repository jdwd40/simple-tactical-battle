/** Opponent planner entry point: public contracts only (see README.md). */
import { DUEL_RULES } from '../contracts'
import { createOpponentPlanner } from './planner'

export { createOpponentPlanner, PLANNER_TUNING } from './planner'
/** Ready-made planner for the duel ruleset. */
export const planOpponent = createOpponentPlanner(DUEL_RULES)
