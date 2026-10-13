import { useEffect, useState } from 'react'
import { createGameController, randomSeed, seedFromSearch } from './game'
import { rendererDiagnostics } from './rendering/BattlefieldRenderer'
import { GameConsole } from './ui/game/GameConsole'

// Development-only drawn-plot summary for browser checks; stripped from production builds.
if (import.meta.env.DEV) (window as unknown as { __plotDiagnostics: typeof rendererDiagnostics }).__plotDiagnostics = rendererDiagnostics

/**
 * Application composition root: owns the private controller and hands the console only its
 * public GameController surface.
 */
export default function App() {
  const [controller] = useState(() => createGameController({ seed: seedFromSearch(window.location.search) ?? randomSeed(), newSeed: randomSeed }))
  useEffect(() => () => controller.dispose(), [controller])
  return <GameConsole controller={controller} />
}
