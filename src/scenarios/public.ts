import type { PublicMap, PublicScenario, Ruleset } from '../contracts/public'
import { freezeData } from './freeze'
import { createRuleset, DUEL_CONFIG } from './rules'

export const DUEL_RULES: Ruleset = createRuleset(DUEL_CONFIG)
export const DUEL_MAP: PublicMap = freezeData({
  columns: 20, rows: 20,
  asteroidCells: [
    { column: 7, row: 4 }, { column: 7, row: 5 }, { column: 8, row: 5 },
    { column: 12, row: 5 }, { column: 13, row: 5 }, { column: 13, row: 6 },
    { column: 6, row: 13 }, { column: 7, row: 13 }, { column: 7, row: 14 },
    { column: 12, row: 13 }, { column: 12, row: 14 }, { column: 13, row: 14 },
  ],
})
export const DUEL_PUBLIC_SCENARIO: PublicScenario = freezeData({
  id: 'shadow-dancer-duel', version: '1', title: 'Shadow-Dancer patrol encounter', map: DUEL_MAP,
})
