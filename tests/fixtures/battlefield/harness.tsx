/**
 * Browser harness for the TSB-11B gameplay components. It publishes typed GameView values
 * built from static fixture frames and applies the components' typed commands to its own
 * cursor. It is test scaffolding, not a second game: there is no simulation here.
 */
import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Cell, GameView, MovementOrder, OwnRoutePreview, PlaybackCommand, TurnOrders, ValidationIssue } from '../../../src/contracts'
import { buildScene } from '../../../src/rendering/plotScene'
import { rendererDiagnostics } from '../../../src/rendering/BattlefieldRenderer'
import { Panel } from '../../../src/ui/components/Panel'
import { StatusTag } from '../../../src/ui/components/StatusTag'
import { ConsoleLayout } from '../../../src/ui/layout/ConsoleLayout'
import { Battlefield } from '../../../src/ui/gameplay/Battlefield'
import { MovementOrders } from '../../../src/ui/gameplay/MovementOrders'
import { PlaybackControls } from '../../../src/ui/gameplay/PlaybackControls'
import { PlotReadout } from '../../../src/ui/gameplay/PlotReadout'
import { presentGameView } from '../../../src/ui/gameplay/viewAdapters'
import { DESTINATION, PLANNING_FRAME, TURN_END, TURN_FRAMES, TURN_START, fixturePreview, map, rules } from './fixtures'
import '../../../src/styles.css'

type Mode = 'planning' | 'execution'
type Speed = 0.5 | 1 | 2 | 4
type LogEntry = { readonly source: 'movement' | 'plot' | 'playback'; readonly value: MovementOrder | PlaybackCommand }

const initialDraft: TurnOrders = { turnIndex: 1, movement: { kind: 'destination', cell: DESTINATION }, sensor: 'passive', cloak: true, weapon: { kind: 'hold' } }
const initialPlan = fixturePreview(PLANNING_FRAME.observation.ownShip.position, DESTINATION)

function Harness() {
  const [encounter, setEncounter] = useState(1)
  const [mounted, setMounted] = useState(true)
  const [mode, setMode] = useState<Mode>(() => (new URLSearchParams(location.search).get('mode') === 'execution' ? 'execution' : 'planning'))
  const [cursor, setCursor] = useState(TURN_START)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(1)
  const [draft, setDraft] = useState(initialDraft)
  const [plan, setPlan] = useState<{ preview: OwnRoutePreview; issues: ValidationIssue[] }>(initialPlan)
  const [log, setLog] = useState<LogEntry[]>([])
  const [pointerCell, setPointerCell] = useState<Cell | null>(null)

  // Harness-only presentation clock standing in for the controller's.
  useEffect(() => {
    if (mode !== 'execution' || !playing) return
    if (cursor >= TURN_END) {
      setPlaying(false)
      return
    }
    const timer = window.setTimeout(() => setCursor((tick) => Math.min(TURN_END, tick + 1)), rules.timing.tickMs / speed)
    return () => window.clearTimeout(timer)
  }, [mode, playing, cursor, speed])

  const record = (entry: LogEntry) => setLog((entries) => [entry, ...entries].slice(0, 12))

  const view: GameView = useMemo(() => {
    // Fixture revision only; the real controller increments it on every publish.
    const base = { encounterId: `fixture-${encounter}`, revision: cursor + 1, rules }
    if (mode === 'planning') {
      return { ...base, phase: 'planning', frame: PLANNING_FRAME, draft, validation: { structurallyValid: !plan.issues.some((issue) => issue.severity === 'error'), issues: plan.issues }, routePreview: plan.preview, replay: null }
    }
    const frames = TURN_FRAMES.slice(0, cursor + 1)
    return {
      ...base, phase: 'execution', frame: frames[frames.length - 1], replayOf: null, automatic: false,
      lockedOwnOrders: { ...initialDraft, turnIndex: 0 },
      replay: {
        scope: 'latest-player-turn-with-aftermath', startTick: TURN_START, endTick: TURN_END, cursorTick: cursor,
        frames, events: frames.flatMap((frame) => frame.events), playback: { playing, speed },
      },
    }
  }, [encounter, mode, draft, plan, cursor, playing, speed])

  const presentation = presentGameView(view)
  const scene = useMemo(() => buildScene({ frames: presentation.frames, routePreview: presentation.routePreview }), [presentation.frames, presentation.routePreview])

  const setMovement = (movement: MovementOrder, source: LogEntry['source']) => {
    record({ source, value: movement })
    setDraft((current) => ({ ...current, movement }))
    const ship = PLANNING_FRAME.observation.ownShip.position
    setPlan(movement.kind === 'hold'
      ? { preview: { kind: 'hold', position: ship }, issues: [] }
      : fixturePreview(ship, movement.cell))
  }

  const onPlayback = (command: PlaybackCommand) => {
    record({ source: 'playback', value: command })
    const clamp = (tick: number) => Math.min(TURN_END, Math.max(TURN_START, tick))
    switch (command.kind) {
      case 'play': setPlaying(true); break
      case 'pause': setPlaying(false); break
      case 'speed': setSpeed(command.speed); break
      case 'seek': setPlaying(false); setCursor(clamp(command.tick)); break
      case 'step': setPlaying(false); setCursor((tick) => clamp(tick + command.direction)); break
      case 'skipToEnd': setPlaying(false); setCursor(TURN_END); break
    }
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setPlaying(false)
    setCursor(TURN_START)
  }

  return (
    <ConsoleLayout
      header={
        <>
          <div>
            <h1 className="ship-name">Battlefield harness</h1>
            <p className="mission-line">Static fixture frames for component checks</p>
          </div>
          <StatusTag>Fixture data, not a running game</StatusTag>
          <div className="ml-auto flex flex-wrap gap-2" role="group" aria-label="Harness controls">
            <button type="button" className="console-button" data-variant="quiet" aria-pressed={mode === 'planning'} onClick={() => switchMode('planning')}>Planning view</button>
            <button type="button" className="console-button" data-variant="quiet" aria-pressed={mode === 'execution'} onClick={() => switchMode('execution')}>Execution view</button>
            <button type="button" className="console-button" data-variant="quiet" onClick={() => setMounted((value) => !value)}>{mounted ? 'Unmount plot' : 'Mount plot'}</button>
            <button type="button" className="console-button" data-variant="quiet" onClick={() => { setEncounter((value) => value + 1); switchMode(mode) }}>New encounter</button>
          </div>
        </>
      }
      shipRail={
        <Panel title="Plot readout">
          <PlotReadout id="plot-readout" scene={scene} map={map} rules={rules} pointerCell={presentation.editable ? pointerCell : null} />
        </Panel>
      }
      battlefield={mounted ? (
        <Battlefield
          encounterId={view.encounterId}
          map={view.frame.observation.map}
          rules={view.rules}
          scene={scene}
          playback={presentation.replay?.playback ?? null}
          selectable={presentation.editable}
          onSelectCell={(cell: Cell) => setMovement({ kind: 'destination', cell }, 'plot')}
          onHoverCell={setPointerCell}
          describedBy="plot-readout"
        />
      ) : <p className="pending-note">Plot unmounted</p>}
      transport={
        <PlaybackControls
          replay={presentation.replay}
          tickMs={rules.timing.tickMs}
          unavailableReason={presentation.playbackUnavailableReason}
          onCommand={onPlayback}
        />
      }
      commandRail={
        <>
          <Panel title="Orders" status={<StatusTag>{mode === 'planning' ? 'Draft' : 'Locked'}</StatusTag>}>
            {presentation.movement && (
              <MovementOrders
                movement={presentation.movement}
                issues={presentation.issues}
                preview={presentation.routePreview}
                map={map}
                unitsPerCell={rules.geometry.unitsPerCell}
                tickMs={rules.timing.tickMs}
                tick={view.frame.tick}
                lockedReason={presentation.lockedReason}
                onMovementIntent={(order) => setMovement(order, 'movement')}
              />
            )}
          </Panel>
          <Panel title="Emitted intents and commands">
            <ol className="harness-log" data-testid="harness-log">
              {log.map((entry, index) => <li key={log.length - index}>{entry.source}: {JSON.stringify(entry.value)}</li>)}
            </ol>
          </Panel>
        </>
      }
    />
  )
}

declare global {
  interface Window { __plotDiagnostics: typeof rendererDiagnostics }
}
window.__plotDiagnostics = rendererDiagnostics

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
