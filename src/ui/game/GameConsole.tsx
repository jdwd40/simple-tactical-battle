import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Cell, GameController, GameView, MovementOrder, SensorOrder, WeaponOrder } from '../../contracts'
import { buildScene } from '../../rendering/plotScene'
import { ConsoleButton } from '../components/ConsoleButton'
import { Panel } from '../components/Panel'
import { PhaseTrack } from '../components/PhaseTrack'
import { StatusTag } from '../components/StatusTag'
import { ConsoleLayout } from '../layout/ConsoleLayout'
import { Battlefield } from '../gameplay/Battlefield'
import { MovementOrders } from '../gameplay/MovementOrders'
import { PlaybackControls } from '../gameplay/PlaybackControls'
import { PlotReadout } from '../gameplay/PlotReadout'
import { presentGameView } from '../gameplay/viewAdapters'
import { assessmentLines, OUTCOME_TEXT } from './consoleText'
import { EventLog } from './EventLog'
import { OwnShipStatus } from './OwnShipStatus'
import { SeedControl } from './SeedControl'
import { SystemOrders } from './SystemOrders'
import type { OrderCapabilities } from './systemsText'
import { WeaponOrders } from './WeaponOrders'
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
    case 'execution':
      if (view.replayOf) return `Replaying turn ${turn}`
      return view.automatic ? `Automatic turn ${turn} playing` : `Turn ${turn} playing`
    case 'assessment': return `Turn ${turn} assessment ready`
    case 'terminal': return view.result.kind === 'combat' ? `Encounter over: ${OUTCOME_TEXT[view.result.outcome.outcome].title}` : 'Encounter abandoned'
  }
}


export interface GameConsoleProps {
  readonly controller: GameController
  /** Order kinds the running engine performs, as plain booleans from the composition root. */
  readonly capabilities: OrderCapabilities
  /** Test pages describe their scripted opponent here; the main game shows no such note. */
  readonly opponentNote?: string
  /** Header tag naming a test or fixture page; the main game has none. */
  readonly modeLabel?: string
  /** Seed of the current encounter as plain reproduction data, from the composition root. */
  readonly seedOf?: (encounterId: string) => number | null
  /** Reopens the mission briefing; the briefing never changes the encounter. */
  readonly onBriefing?: () => void
}

/**
 * The playable console. It sees only the public GameController: published immutable views
 * in, typed commands out. No engine, private state or future frames are reachable here.
 */
export function GameConsole({ controller, capabilities, opponentNote, modeLabel, seedOf, onBriefing }: GameConsoleProps) {
  const view = useSyncExternalStore(controller.subscribe, controller.getView, controller.getView)
  const presentation = useMemo(() => presentGameView(view), [view])
  // Contact choice is encounter-local and only marks aliases the shown frame knows.
  const [selection, setSelection] = useState<{ readonly encounterId: string; readonly alias: string } | null>(null)
  const selectedAlias = selection?.encounterId === view.encounterId ? selection.alias : null
  const draftSensor = view.phase === 'planning' ? view.draft.sensor : null
  // The committed intent stays on the plot only until it fires.
  const fired = presentation.replay?.events.some((event) => event.kind === 'own-shot' && event.tick > presentation.replay!.startTick) ?? false
  const plotWeapon = view.phase === 'planning' ? view.draft.weapon
    : (view.phase === 'commit' || (view.phase === 'execution' && !view.automatic)) && !fired ? view.lockedOwnOrders?.weapon ?? null : null
  const weaponRules = useMemo(() => ({ laserRangeUnits: view.rules.laser.rangeUnits, blastRadiusUnits: view.rules.missile.blastRadiusUnits }), [view.rules])
  const scene = useMemo(
    () => buildScene({ frames: presentation.frames, routePreview: presentation.routePreview, sensors: view.rules.sensors, draftSensor, selectedAlias, weapon: plotWeapon, weaponRules }),
    [presentation.frames, presentation.routePreview, view.rules.sensors, draftSensor, selectedAlias, plotWeapon, weaponRules],
  )
  // Missile aiming is a deliberate, planning-only mode for this turn; any phase change ends it.
  const aimingKey = view.phase === 'planning' ? `${view.encounterId}:${view.draft.turnIndex}` : null
  const [aimingFor, setAimingFor] = useState<string | null>(null)
  const aiming = aimingKey !== null && aimingFor === aimingKey
  const setAiming = (on: boolean) => setAimingFor(on ? aimingKey : null)
  useEffect(() => {
    if (!aiming) return
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') setAimingFor(null) }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [aiming])
  const [pointerCell, setPointerCell] = useState<Cell | null>(null)
  const planNextRef = useRef<HTMLButtonElement>(null)
  const restartRef = useRef<HTMLButtonElement>(null)

  const turn = turnNumber(view)
  const seed = seedOf?.(view.encounterId) ?? null
  const { rules } = view
  const map = view.frame.observation.map
  const own = view.frame.observation.ownShip

  // An assessment or ending opens at the top of the command rail, whatever was scrolled before.
  const railTop = view.phase === 'assessment' || view.phase === 'terminal'
  useEffect(() => {
    if (railTop) document.getElementById('command-rail')?.scrollTo({ top: 0 })
  }, [railTop, view.encounterId])

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
  const setWeapon = (weapon: WeaponOrder) => {
    if (view.phase === 'planning') controller.setDraft({ ...view.draft, weapon })
  }
  const selectPlotCell = (cell: Cell) => {
    if (aiming) {
      setAiming(false)
      setWeapon({ kind: 'missile', aim: cell })
    } else setMovement({ kind: 'destination', cell })
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
  const turnStartTick = presentation.replay?.startTick ?? view.frame.tick
  const ticksResolved = presentation.replay ? view.frame.tick - presentation.replay.startTick : 0
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
          ticksResolved={ticksResolved}
          rules={rules}
          issues={presentation.issues}
          pulseUnavailableReason={pulseUnavailableReason}
          moving={moving}
          lockedReason={presentation.lockedReason}
          onChange={setSystems}
        />
      </div>
      <div className="orders-section">
        <WeaponOrders
          // Per-turn choice state: a new planning turn or encounter starts unaimed.
          key={`${view.encounterId}:${orders.turnIndex}`}
          orders={orders}
          own={own}
          contacts={view.frame.observation.contacts}
          map={map}
          tick={view.frame.tick}
          turnStartTick={turnStartTick}
          ticksResolved={ticksResolved}
          events={presentation.replay?.events ?? []}
          rules={rules}
          issues={presentation.issues}
          capabilities={capabilities}
          aiming={aiming}
          lockedReason={presentation.lockedReason}
          onWeapon={setWeapon}
          onAimingChange={setAiming}
        />
        {opponentNote && <p className="order-note" data-testid="opponent-note">{opponentNote}</p>}
      </div>
    </Panel>
  )

  const endingActions = (
    <>
      <ConsoleButton ref={restartRef} variant="commit" onClick={() => controller.restart({ kind: 'same-seed' })}>Restart encounter</ConsoleButton>
      <ConsoleButton onClick={() => controller.restart({ kind: 'new-seed' })}>New encounter</ConsoleButton>
    </>
  )

  const commandRail = (() => {
    if (view.phase === 'terminal' && view.result.kind === 'combat') {
      const ending = OUTCOME_TEXT[view.result.outcome.outcome]
      return (
        <>
          <Panel title="Encounter over" status={<StatusTag>{ending.title}</StatusTag>}>
            <p className="outcome-title" data-testid="outcome">{ending.title}</p>
            <p className="pending-note">{ending.line}</p>
            <ul className="assessment-lines mt-3">
              {assessmentLines(view.result.assessment, { rules, map }, view.replay?.startTick).map((line) => <li key={line}>{line}</li>)}
            </ul>
            <div className="assessment-actions">
              {endingActions}
              <ConsoleButton variant="quiet" onClick={() => controller.playback({ kind: 'play' })}>Replay final turn</ConsoleButton>
            </div>
          </Panel>
          <Panel title="Event log" className="event-log">
            <EventLog replay={presentation.replay} rules={rules} map={map} />
          </Panel>
        </>
      )
    }
    if (view.phase === 'terminal') {
      return (
        <Panel title="Encounter ended" status={<StatusTag>Abandoned</StatusTag>}>
          <p className="pending-note">You abandoned the encounter. No combat result was recorded.</p>
          <div className="assessment-actions">{endingActions}</div>
        </Panel>
      )
    }
    const assessed = view.phase === 'assessment' || (view.phase === 'execution' && view.replayOf === 'assessment')
    const endedReplay = view.phase === 'execution' && view.replayOf === 'terminal'
    const automatic = view.phase === 'execution' && view.automatic && !endedReplay
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
        {endedReplay && (
          <Panel title="Replaying the final turn" status={<StatusTag>Replay</StatusTag>}>
            <p className="pending-note">The result appears again only when playback reaches it. Nothing is simulated again.</p>
            <div className="assessment-actions">
              <ConsoleButton onClick={() => controller.playback({ kind: 'skipToEnd' })}>Back to result</ConsoleButton>
            </div>
          </Panel>
        )}
        {automatic && (
          <Panel title="Shadow-Dancer destroyed" status={<StatusTag>Automatic</StatusTag>}>
            <p className="pending-note" data-testid="automatic-note">
              Your ship was destroyed, so you give no more orders. Remaining ordnance plays out in automatic turns while the patrol plans from its own observation. The result appears once nothing is left in flight.
            </p>
          </Panel>
        )}
        {ordersPanel}
        {(view.phase === 'planning' || view.phase === 'commit' || (view.phase === 'execution' && !assessed && !endedReplay && !automatic)) && (
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
              {modeLabel && <StatusTag>{modeLabel}</StatusTag>}
              {seed !== null && <SeedControl seed={seed} />}
              <div role="group" aria-label="Encounter" className="flex gap-2">
                {onBriefing && <ConsoleButton variant="quiet" onClick={onBriefing}>Briefing</ConsoleButton>}
                <ConsoleButton
                  variant="quiet" unavailable={view.phase === 'terminal' || (view.phase === 'execution' && view.replayOf === 'terminal')}
                  aria-describedby="encounter-help" onClick={() => controller.abandon()}
                >
                  Abandon
                </ConsoleButton>
                <ConsoleButton variant="quiet" aria-describedby="encounter-help" onClick={() => controller.restart({ kind: 'same-seed' })}>Restart</ConsoleButton>
              </div>
              <span id="encounter-help" className="sr-only">Abandon ends the encounter without a result. Restart begins this encounter again from the start.</span>
            </div>
          </>
        }
        shipRail={
          <>
            <Panel title="Own ship" status={view.phase === 'execution' || view.phase === 'assessment' || (view.phase === 'terminal' && view.replay) ? <StatusTag>At playback time</StatusTag> : undefined}>
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
          <>
            <Battlefield
              encounterId={view.encounterId}
              map={map}
              rules={rules}
              scene={scene}
              playback={presentation.replay?.playback ?? null}
              selectable={presentation.editable}
              pointerMode={aiming ? 'aim' : 'destination'}
              onSelectCell={selectPlotCell}
              onHoverCell={setPointerCell}
              describedBy="plot-readout"
            />
            {aiming && <p className="plot-caption aim-caption" role="status">Aiming the missile: select a cell on the plot. Press Escape to stop.</p>}
          </>
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
