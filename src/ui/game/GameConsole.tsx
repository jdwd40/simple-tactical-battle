import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Cell, GameController, GameView, MovementOrder, SensorOrder } from '../../contracts'
import { buildScene } from '../../rendering/plotScene'
import { ConsoleButton } from '../components/ConsoleButton'
import { Panel } from '../components/Panel'
import { PhaseTrack } from '../components/PhaseTrack'
import { Readouts } from '../components/Readouts'
import { StatusTag } from '../components/StatusTag'
import { ConsoleLayout } from '../layout/ConsoleLayout'
import { Battlefield } from '../gameplay/Battlefield'
import { MovementOrders } from '../gameplay/MovementOrders'
import { PlaybackControls } from '../gameplay/PlaybackControls'
import { PlotReadout } from '../gameplay/PlotReadout'
import { presentGameView } from '../gameplay/viewAdapters'
import { assessmentLines } from './consoleText'
import { EventLog } from './EventLog'
import { OwnShipStatus } from './OwnShipStatus'
import { SystemOrders } from './SystemOrders'
import type { OrderCapabilities } from './systemsText'
import './game.css'

const TURN_PHASES = ['Planning', 'Commit', 'Execution', 'Assessment'] as const
const PHASE_LABEL: Record<GameView['phase'], (typeof TURN_PHASES)[number] | undefined> = {
  planning: 'Planning', commit: 'Commit', execution: 'Execution', assessment: 'Assessment', terminal: undefined,
}

function turnNumber(view: GameView) {
  return (view.phase === 'planning' ? view.draft.turnIndex : view.frame.observation.turnIndex) + 1
}

function announcement(view: GameView, turn: number) {
  switch (view.phase) {
    case 'planning': return `Planning turn ${turn}`
    case 'commit': return `Turn ${turn} committed`
    case 'execution': return view.replayOf ? `Replaying turn ${turn}` : `Turn ${turn} playing`
    case 'assessment': return `Turn ${turn} assessment ready`
    case 'terminal': return 'Encounter abandoned'
  }
}

export interface GameConsoleProps {
  readonly controller: GameController
  /** Order kinds the running engine performs, as plain booleans from the composition root. */
  readonly capabilities: OrderCapabilities
}

/**
 * The playable console. It sees only the public GameController: published immutable views
 * in, typed commands out. No engine, private state or future frames are reachable here.
 */
export function GameConsole({ controller, capabilities }: GameConsoleProps) {
  const view = useSyncExternalStore(controller.subscribe, controller.getView, controller.getView)
  const presentation = useMemo(() => presentGameView(view), [view])
  // Contact choice is encounter-local and only marks aliases the shown frame knows.
  const [selection, setSelection] = useState<{ readonly encounterId: string; readonly alias: string } | null>(null)
  const selectedAlias = selection?.encounterId === view.encounterId ? selection.alias : null
  const draftSensor = view.phase === 'planning' ? view.draft.sensor : null
  const scene = useMemo(
    () => buildScene({ frames: presentation.frames, routePreview: presentation.routePreview, sensors: view.rules.sensors, draftSensor, selectedAlias }),
    [presentation.frames, presentation.routePreview, view.rules.sensors, draftSensor, selectedAlias],
  )
  const [pointerCell, setPointerCell] = useState<Cell | null>(null)
  const planNextRef = useRef<HTMLButtonElement>(null)
  const restartRef = useRef<HTMLButtonElement>(null)

  const turn = turnNumber(view)
  const { rules } = view
  const map = view.frame.observation.map
  const own = view.frame.observation.ownShip

  // Keep keyboard focus somewhere sensible when the control that held it disappears.
  useEffect(() => {
    if (document.activeElement && document.activeElement !== document.body) return
    if (view.phase === 'assessment') planNextRef.current?.focus()
    else if (view.phase === 'terminal') restartRef.current?.focus()
    else if (view.phase === 'planning' && view.revision > 1) document.getElementById('command-rail')?.focus()
  }, [view.phase, view.encounterId, view.revision])

  const setMovement = (movement: MovementOrder) => {
    if (view.phase === 'planning') controller.setDraft({ ...view.draft, movement })
  }
  const setSystems = (change: { readonly sensor?: SensorOrder; readonly cloak?: boolean }) => {
    if (view.phase === 'planning') controller.setDraft({ ...view.draft, ...change })
  }
  const selectContact = (alias: string) => {
    setSelection(selectedAlias === alias ? null : { encounterId: view.encounterId, alias })
  }
  const pulseUnavailableReason = !own.equipment.activeSensor ? 'This ship has no active sensor.'
    : capabilities.activePulse ? null : 'Active pulse is not available in this version yet; sensors stay passive.'
  const preview = presentation.routePreview
  const moving = preview?.kind === 'destination'
    && (preview.nominalReachablePoint.x !== own.position.x || preview.nominalReachablePoint.y !== own.position.y)

  const orders = view.phase === 'planning' ? view.draft : view.phase === 'terminal' ? null : view.lockedOwnOrders
  const canCommit = view.phase === 'planning' && view.validation.structurallyValid
  const commitNote = view.phase === 'planning'
    ? canCommit ? 'Locks these orders and plays the 10-second turn.' : 'Fix the invalid order before committing.'
    : `Turn ${turn} is committed. Orders unlock when you plan the next turn.`

  const ordersPanel = presentation.movement && orders && (
    <Panel title="Orders" status={<StatusTag>{view.phase === 'planning' ? 'Draft' : 'Locked'}</StatusTag>}>
      <MovementOrders
        // Entry fields are encounter-local: a restart starts them blank.
        key={view.encounterId}
        movement={presentation.movement}
        issues={presentation.issues}
        preview={presentation.routePreview}
        map={map}
        unitsPerCell={rules.geometry.unitsPerCell}
        tickMs={rules.timing.tickMs}
        tick={view.frame.tick}
        lockedReason={presentation.lockedReason}
        onMovementIntent={setMovement}
      />
      <div className="orders-section">
        <SystemOrders
          orders={orders}
          own={own}
          tick={view.frame.tick}
          ticksResolved={presentation.replay ? view.frame.tick - presentation.replay.startTick : 0}
          rules={rules}
          issues={presentation.issues}
          pulseUnavailableReason={pulseUnavailableReason}
          moving={moving}
          lockedReason={presentation.lockedReason}
          onChange={setSystems}
        />
      </div>
      <div className="orders-section">
        <Readouts items={[{ label: 'Weapon', value: 'Hold fire' }]} />
        <p className="order-note">
          {capabilities.activePulse
            ? 'Weapons hold fire in this version; combat and a reactive patrol come later. The patrol follows a set route and cannot fire.'
            : 'Weapons hold fire in this version; active scans, combat and a reactive patrol come later. The patrol follows a set route and cannot fire.'}
        </p>
      </div>
    </Panel>
  )

  const commandRail = (() => {
    if (view.phase === 'terminal') {
      return (
        <Panel title="Encounter ended" status={<StatusTag>Abandoned</StatusTag>}>
          <p className="pending-note">You abandoned the encounter. No combat result was recorded.</p>
          <div className="assessment-actions">
            <ConsoleButton ref={restartRef} variant="commit" onClick={() => controller.restart({ kind: 'same-seed' })}>Restart encounter</ConsoleButton>
            <ConsoleButton onClick={() => controller.restart({ kind: 'new-seed' })}>New encounter</ConsoleButton>
          </div>
        </Panel>
      )
    }
    const assessed = view.phase === 'assessment' || (view.phase === 'execution' && view.replayOf === 'assessment')
    return (
      <>
        {view.phase === 'assessment' && (
          <Panel title={`Turn ${turn} assessment`}>
            <ul className="assessment-lines">
              {assessmentLines(view.assessment, { rules, map }, view.replay.startTick).map((line) => <li key={line}>{line}</li>)}
            </ul>
            <div className="assessment-actions">
              <ConsoleButton ref={planNextRef} variant="commit" onClick={() => controller.finishAssessment()}>Plan turn {turn + 1}</ConsoleButton>
              <ConsoleButton onClick={() => controller.playback({ kind: 'play' })}>Replay turn {turn}</ConsoleButton>
            </div>
          </Panel>
        )}
        {view.phase === 'execution' && assessed && (
          <Panel title={`Replaying turn ${turn}`} status={<StatusTag>Replay</StatusTag>}>
            <p className="pending-note">Replay shows the recorded turn as your ship saw it. Nothing is simulated again.</p>
            <div className="assessment-actions">
              <ConsoleButton onClick={() => controller.playback({ kind: 'skipToEnd' })}>Back to assessment</ConsoleButton>
              <ConsoleButton variant="quiet" onClick={() => controller.finishAssessment()}>Plan turn {turn + 1}</ConsoleButton>
            </div>
          </Panel>
        )}
        {ordersPanel}
        {(view.phase === 'planning' || view.phase === 'commit' || (view.phase === 'execution' && !assessed)) && (
          <div className="commit-station">
            <ConsoleButton
              variant="commit"
              unavailable={!canCommit}
              aria-describedby="commit-note"
              onClick={() => { if (view.phase === 'planning') controller.commit(view.draft.turnIndex) }}
            >
              Commit turn {turn}
            </ConsoleButton>
            <p id="commit-note" className="commit-note">{commitNote}</p>
          </div>
        )}
        <Panel title="Event log" className="event-log">
          <EventLog replay={presentation.replay} rules={rules} map={map} />
        </Panel>
      </>
    )
  })()

  return (
    <>
      <a className="skip-link" href="#command-rail">Skip to orders</a>
      <p className="sr-only" aria-live="polite">{announcement(view, turn)}</p>
      <ConsoleLayout
        header={
          <>
            <div>
              <h1 className="ship-name">{own.name}</h1>
              <p className="mission-line">Survive the Federation patrol encounter</p>
            </div>
            <dl className="turn-readout m-0">
              <dt>Turn</dt>
              <dd data-testid="turn-number">{turn}</dd>
            </dl>
            <PhaseTrack phases={TURN_PHASES} current={PHASE_LABEL[view.phase]} />
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <StatusTag>{capabilities.activePulse ? 'Sensor drill' : 'Movement drill'}</StatusTag>
              <div role="group" aria-label="Encounter" className="flex gap-2">
                <ConsoleButton variant="quiet" unavailable={view.phase === 'terminal'} aria-describedby="encounter-help" onClick={() => controller.abandon()}>Abandon</ConsoleButton>
                <ConsoleButton variant="quiet" aria-describedby="encounter-help" onClick={() => controller.restart({ kind: 'same-seed' })}>Restart</ConsoleButton>
              </div>
              <span id="encounter-help" className="sr-only">Abandon ends the encounter without a result. Restart begins this encounter again from the start.</span>
            </div>
          </>
        }
        shipRail={
          <>
            <Panel title="Own ship" status={view.phase === 'execution' || view.phase === 'assessment' ? <StatusTag>At playback time</StatusTag> : undefined}>
              <OwnShipStatus ship={own} tick={view.frame.tick} rules={rules} />
            </Panel>
            <Panel title="Plot readout">
              <PlotReadout
                id="plot-readout" scene={scene} map={map} rules={rules}
                pointerCell={presentation.editable ? pointerCell : null} onSelectContact={selectContact}
              />
            </Panel>
          </>
        }
        battlefield={
          <Battlefield
            encounterId={view.encounterId}
            map={map}
            rules={rules}
            scene={scene}
            playback={presentation.replay?.playback ?? null}
            selectable={presentation.editable}
            onSelectCell={(cell) => setMovement({ kind: 'destination', cell })}
            onHoverCell={setPointerCell}
            describedBy="plot-readout"
          />
        }
        transport={
          <PlaybackControls
            replay={presentation.replay}
            tickMs={rules.timing.tickMs}
            unavailableReason={presentation.playbackUnavailableReason}
            onCommand={(command) => controller.playback(command)}
          />
        }
        commandRail={commandRail}
      />
    </>
  )
}
