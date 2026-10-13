/**
 * Test-only composition root (TSB-31): the real controller and engine with a chosen scripted
 * opponent, so browser tests can reach every combat ending. Served by the dev server only and
 * never built for production. Like App.tsx it hands the console only the public controller and
 * capability booleans; no world state is exposed on window.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createGameController, randomSeed, seedFromSearch } from '../../../src/game'
import { rendererDiagnostics } from '../../../src/rendering/BattlefieldRenderer'
import { GameConsole } from '../../../src/ui/game/GameConsole'
import { OPPONENT_NOTES, OPPONENTS, type OpponentName } from './opponents'
import '../../../src/styles.css'

const search = new URLSearchParams(window.location.search)
const name = search.get('opponent')
const opponent = (name && name in OPPONENTS ? name : 'scripted') as OpponentName
const planOpponent = OPPONENTS[opponent]
const controller = createGameController({ seed: seedFromSearch(window.location.search) ?? randomSeed(), newSeed: randomSeed, planOpponent })

// Drawn-plot summary only, as in the development app.
;(window as unknown as { __plotDiagnostics: typeof rendererDiagnostics }).__plotDiagnostics = rendererDiagnostics

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GameConsole
      controller={controller} capabilities={controller.capabilities} opponentNote={OPPONENT_NOTES[opponent]}
      modeLabel="Test page: scripted opponent" seedOf={(id) => controller.seedOf(id)}
    />
  </StrictMode>,
)
