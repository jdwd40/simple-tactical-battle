import {
  DUEL_PUBLIC_SCENARIO, DUEL_RULES, SAMPLE_PLAYER_OBSERVATION,
  type PublicScenario, type Ruleset, type SideObservation,
} from '../contracts/index'

export interface StartupPresentation {
  readonly scenario: PublicScenario
  readonly rules: Ruleset
  readonly observation: SideObservation
}

/** Public scenario plus own initial data; not an engine session or a controller. */
export const STARTUP_PRESENTATION: StartupPresentation = Object.freeze({
  scenario: DUEL_PUBLIC_SCENARIO,
  rules: DUEL_RULES,
  observation: SAMPLE_PLAYER_OBSERVATION,
})
