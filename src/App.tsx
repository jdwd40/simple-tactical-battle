import { useCallback, useEffect, useState } from 'react'
import { planOpponent } from './ai'
import { DUEL_RULES } from './contracts'
import { createGameController, randomSeed, seedFromSearch } from './game'
import { rendererDiagnostics } from './rendering/BattlefieldRenderer'
import { GameConsole } from './ui/game/GameConsole'
import { MissionBriefing } from './ui/game/MissionBriefing'

// Development-only drawn-plot summary for browser checks; stripped from production builds.
if (import.meta.env.DEV) (window as unknown as { __plotDiagnostics: typeof rendererDiagnostics }).__plotDiagnostics = rendererDiagnostics

/**
 * Application composition root: owns the private controller, with the observation-only patrol
 * planner (TSB-40), and hands the console only its public GameController surface, capability
 * booleans and the current seed as a primitive.
 */
export default function App() {
  const [controller] = useState(() => createGameController({
    seed: seedFromSearch(window.location.search) ?? randomSeed(), newSeed: randomSeed, planOpponent,
  }))
  const [briefing, setBriefing] = useState<'first' | 'again' | null>('first')
  const [encounterId, setEncounterId] = useState(() => controller.getView().encounterId)
  useEffect(() => controller.subscribe(() => setEncounterId(controller.getView().encounterId)), [controller])
  useEffect(() => () => controller.dispose(), [controller])

  const seedOf = useCallback((id: string) => controller.seedOf(id), [controller])
  const openBriefing = useCallback(() => {
    // Reading the briefing never changes the encounter; it only stops a running playback.
    controller.playback({ kind: 'pause' })
    setBriefing('again')
  }, [controller])
  const closeBriefing = useCallback(() => {
    // After the opening briefing, start at the orders; a reopened one returns focus where it was.
    if (briefing === 'first') document.getElementById('command-rail')?.focus()
    setBriefing(null)
  }, [briefing])

  return (
    <>
      <GameConsole controller={controller} capabilities={controller.capabilities} seedOf={seedOf} onBriefing={openBriefing} />
      <MissionBriefing open={briefing !== null} first={briefing === 'first'} seed={controller.seedOf(encounterId)} rules={DUEL_RULES} onClose={closeBriefing} />
    </>
  )
}
