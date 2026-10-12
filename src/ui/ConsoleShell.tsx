import { ConsoleButton } from './components/ConsoleButton'
import { PlayIcon, SkipToEndIcon, StepBackIcon, StepForwardIcon } from './components/icons'
import { Panel } from './components/Panel'
import { PhaseTrack } from './components/PhaseTrack'
import { NoData, Readouts } from './components/Readouts'
import { StatusTag } from './components/StatusTag'
import { ConsoleLayout } from './layout/ConsoleLayout'

const TURN_PHASES = ['Planning', 'Commit', 'Execution', 'Assessment'] as const

const SHIP_READOUTS = ['Energy', 'Shields', 'Hull', 'Missiles', 'Sensor', 'Cloak'].map((label) => ({ label, value: <NoData /> }))
const ORDER_READOUTS = ['Movement', 'Sensor', 'Cloak', 'Weapon'].map((label) => ({ label, value: <NoData /> }))

/**
 * The console before the simulation engine is connected. Every slot is labelled
 * as pending and every control is unavailable; nothing here simulates combat.
 * TSB-11B replaces these slot contents with controller-bound components.
 */
export function ConsoleShell() {
  return (
    <>
      <a className="skip-link" href="#command-rail">Skip to orders</a>
      <ConsoleLayout
        header={
          <>
            <div>
              <h1 className="ship-name">Shadow-Dancer</h1>
              <p className="mission-line">Survive the Federation patrol encounter</p>
            </div>
            <dl className="turn-readout m-0">
              <dt>Turn</dt>
              <dd><NoData /></dd>
            </dl>
            <PhaseTrack phases={TURN_PHASES} />
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <StatusTag>
                <span aria-hidden="true" className="inline-block size-2 rounded-full border border-current" />
                Engine not connected
              </StatusTag>
              <div role="group" aria-label="Encounter" className="flex gap-2">
                <ConsoleButton variant="quiet" unavailable aria-describedby="encounter-unavailable">Abandon</ConsoleButton>
                <ConsoleButton variant="quiet" unavailable aria-describedby="encounter-unavailable">Restart</ConsoleButton>
              </div>
              <span id="encounter-unavailable" className="sr-only">Available once an encounter is running.</span>
            </div>
          </>
        }
        shipRail={
          <>
            <Panel title="Own ship" status={<StatusTag>No data</StatusTag>}>
              <Readouts items={SHIP_READOUTS} />
            </Panel>
            <Panel title="Plot readout">
              <p className="pending-note">
                Your position, the selected cell and known contacts will be listed here as text, including how old each last-known contact is.
              </p>
            </Panel>
          </>
        }
        battlefield={
          <section aria-labelledby="plot-caption" className="contents">
            <h2 id="plot-caption" className="plot-caption">Tactical plot</h2>
            <div className="plot-offline">
              <p className="plot-offline-title">Plot offline</p>
              <p className="pending-note">
                The battlefield appears here once the simulation engine is connected. No encounter is running.
              </p>
            </div>
          </section>
        }
        transport={
          <div className="transport" role="group" aria-label="Playback" aria-describedby="playback-unavailable">
            <div className="transport-buttons">
              <ConsoleButton unavailable icon={<StepBackIcon />} aria-describedby="playback-unavailable">Back</ConsoleButton>
              <ConsoleButton unavailable icon={<PlayIcon />} aria-describedby="playback-unavailable">Play</ConsoleButton>
              <ConsoleButton unavailable icon={<StepForwardIcon />} aria-describedby="playback-unavailable">Forward</ConsoleButton>
              <ConsoleButton unavailable icon={<SkipToEndIcon />} aria-describedby="playback-unavailable">Skip to end</ConsoleButton>
            </div>
            <div className="timeline">
              <span className="timeline-track" aria-hidden="true" />
              <span id="playback-unavailable" className="timeline-label">Available during execution and replay</span>
            </div>
          </div>
        }
        commandRail={
          <>
            <Panel title="Orders" status={<StatusTag>No turn</StatusTag>}>
              <Readouts items={ORDER_READOUTS} />
            </Panel>
            <div className="commit-station">
              <ConsoleButton variant="commit" unavailable aria-describedby="commit-unavailable">Commit turn</ConsoleButton>
              <p id="commit-unavailable" className="commit-note">Orders can be committed once the simulation engine is connected.</p>
            </div>
            <Panel title="Event log" className="event-log">
              <p className="pending-note">No events yet. What your ship observes during execution is listed here in time order.</p>
            </Panel>
          </>
        }
      />
    </>
  )
}
