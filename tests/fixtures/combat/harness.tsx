/**
 * Browser harness for the TSB-31 combat components. A fixture GameController publishes typed
 * views over the static public frames in ./fixtures and records the console's commands. It
 * is test scaffolding, not a second game: there is no simulation, validation or combat here,
 * and it is never part of the production build.
 */
import { StrictMode, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { GameController, GameView, PlaybackCommand, TurnOrders } from '../../../src/contracts'
import { rendererDiagnostics } from '../../../src/rendering/BattlefieldRenderer'
import { GameConsole } from '../../../src/ui/game/GameConsole'
import { OWN_POSITION, PLANNING_FRAME, TURN_END, TURN_FRAMES, TURN_START, rules } from './fixtures'
import '../../../src/styles.css'

type Speed = 0.5 | 1 | 2 | 4
const initialDraft: TurnOrders = { turnIndex: 0, movement: { kind: 'hold' }, sensor: 'passive', cloak: false, weapon: { kind: 'hold' } }

function createFixtureController() {
  const listeners = new Set<() => void>()
  const commands: string[] = []
  let phase: 'planning' | 'execution' = 'planning'
  let draft = initialDraft
  let cursor = TURN_START
  let playing = false
  let speed: Speed = 1
  let revision = 1
  let encounter = 1
  let timer = 0

  const build = (): GameView => {
    const base = { encounterId: `fixture-${encounter}`, revision, rules }
    if (phase === 'planning') {
      return { ...base, phase, frame: PLANNING_FRAME, draft, validation: { structurallyValid: true, issues: [] }, routePreview: { kind: 'hold', position: OWN_POSITION }, replay: null }
    }
    const frames = TURN_FRAMES.slice(0, cursor + 1)
    return {
      ...base, phase, frame: frames[frames.length - 1], replayOf: null, automatic: false, lockedOwnOrders: draft,
      replay: { scope: 'latest-player-turn-with-aftermath', startTick: TURN_START, endTick: TURN_END, cursorTick: cursor, frames, events: frames.flatMap((frame) => frame.events), playback: { playing, speed } },
    }
  }
  let view = build()
  const publish = () => {
    revision += 1
    view = build()
    for (const listener of [...listeners]) listener()
  }
  const record = (entry: string) => {
    commands.unshift(entry)
    commands.length = Math.min(commands.length, 12)
  }
  const schedule = () => {
    window.clearTimeout(timer)
    if (!playing || phase !== 'execution') return
    timer = window.setTimeout(() => {
      cursor = Math.min(TURN_END, cursor + 1)
      if (cursor >= TURN_END) playing = false
      publish()
      schedule()
    }, rules.timing.tickMs / speed)
  }
  const move = (tick: number) => { cursor = Math.min(TURN_END, Math.max(TURN_START, Math.trunc(tick))) }

  const controller: GameController = {
    getView: () => view,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setDraft(orders) {
      if (phase !== 'planning') return
      record(`setDraft ${JSON.stringify({ movement: orders.movement, weapon: orders.weapon })}`)
      draft = orders
      publish()
    },
    commit() {
      if (phase !== 'planning') return { kind: 'ignored', reason: 'wrong-phase' }
      record('commit')
      phase = 'execution'
      cursor = TURN_START
      playing = true
      publish()
      schedule()
      return { kind: 'accepted', turnIndex: 0, revision }
    },
    playback(command: PlaybackCommand) {
      if (phase !== 'execution') return
      record(`playback ${JSON.stringify(command)}`)
      switch (command.kind) {
        case 'play': playing = true; break
        case 'pause': playing = false; break
        case 'speed': speed = command.speed; break
        case 'seek': playing = false; move(command.tick); break
        case 'step': playing = false; move(cursor + command.direction); break
        case 'skipToEnd': playing = false; move(TURN_END); break
      }
      publish()
      schedule()
    },
    finishAssessment() {},
    abandon() {},
    restart() {
      window.clearTimeout(timer)
      encounter += 1
      phase = 'planning'
      draft = initialDraft
      cursor = TURN_START
      playing = false
      publish()
    },
  }
  return { controller, commands, subscribe: controller.subscribe }
}

const fixture = createFixtureController()

function CommandLog() {
  useSyncExternalStore(fixture.subscribe, () => fixture.controller.getView())
  return <ol className="sr-only" data-testid="harness-log">{fixture.commands.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ol>
}

declare global {
  interface Window { __plotDiagnostics: typeof rendererDiagnostics }
}
window.__plotDiagnostics = rendererDiagnostics

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GameConsole controller={fixture.controller} capabilities={{ activePulse: true, laser: true, missile: true }} opponentNote="Fixture frames only: no opponent or engine runs here." />
    <CommandLog />
  </StrictMode>,
)
