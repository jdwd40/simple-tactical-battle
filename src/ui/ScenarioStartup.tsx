import type { StartupPresentation } from '../fixtures/startup'
import { ConsoleButton } from './components/ConsoleButton'
import { PlayIcon, SkipToEndIcon, StepBackIcon, StepForwardIcon } from './components/icons'
import { Panel } from './components/Panel'
import { PhaseTrack } from './components/PhaseTrack'
import { NoData, Readouts } from './components/Readouts'
import { StatusTag } from './components/StatusTag'
import { ConsoleLayout } from './layout/ConsoleLayout'

const TURN_PHASES = ['Planning', 'Commit', 'Execution', 'Assessment'] as const
const ORDER_READOUTS = ['Movement', 'Sensor', 'Cloak', 'Weapon'].map((label) => ({ label, value: <NoData /> }))

/** Static public startup data. No controller, enemy state or gameplay handlers. */
export function ScenarioStartup({ presentation }: { presentation: StartupPresentation }) {
  const { scenario, rules, observation } = presentation
  const own = observation.ownShip
  const { map } = scenario
  const units = rules.geometry.unitsPerCell
  const column = Math.floor(own.position.x / units)
  const row = Math.floor(own.position.y / units)
  const cellLabel = `(${column}, ${row})`
  const shipReadouts = [
    { label: 'Energy', value: `${own.energy.currentMilli / 1000} / ${own.energy.maxMilli / 1000}` },
    { label: 'Shields', value: `${own.shields.current} / ${own.shields.max}` },
    { label: 'Hull', value: `${own.hull.current} / ${own.hull.max}` },
    { label: 'Missiles', value: `${own.ammunition.current} / ${own.ammunition.max}` },
    { label: 'Sensor', value: own.sensor === 'passive' ? 'Passive' : 'Tracking' },
    { label: 'Cloak', value: own.cloak.actual ? 'Active' : 'Off' },
  ]

  return (
    <>
      <a className="skip-link" href="#command-rail">Skip to orders</a>
      <ConsoleLayout
        header={
          <>
            <div>
              <h1 className="ship-name">{own.name}</h1>
              <p className="mission-line">Survive the Federation patrol encounter</p>
            </div>
            <dl className="turn-readout m-0"><dt>Turn</dt><dd><NoData /></dd></dl>
            <PhaseTrack phases={TURN_PHASES} />
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <StatusTag>Scenario loaded · M0</StatusTag>
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
            <Panel title="Own ship" status={<StatusTag>Initial data</StatusTag>}>
              <Readouts items={shipReadouts} />
            </Panel>
            <Panel title="Plot readout">
              <Readouts items={[
                { label: 'Own cell', value: cellLabel },
                { label: 'Known contacts', value: observation.contacts.length },
                { label: 'Hostile missiles', value: observation.hostileMissiles.length },
              ]} />
              <p className="pending-note mt-3">No opposing position or resources are known at startup.</p>
            </Panel>
            <Panel title="Scenario">
              <p className="pending-note mb-3">{scenario.title}</p>
              <Readouts items={[
                { label: 'Terrain', value: `${map.columns} × ${map.rows}` },
                { label: 'Asteroid cells', value: map.asteroidCells.length },
              ]} />
            </Panel>
          </>
        }
        battlefield={
          <section aria-labelledby="plot-caption" className="contents">
            <h2 id="plot-caption" className="plot-caption">Tactical plot · public terrain</h2>
            <div className="flex h-full min-h-0 w-full flex-col gap-3 pt-6">
              <svg className="min-h-0 w-full flex-1" viewBox={`0 0 ${map.columns * units} ${map.rows * units}`} role="img" aria-labelledby="terrain-title" aria-describedby="terrain-description">
                <title id="terrain-title">Public scenario terrain</title>
                <desc id="terrain-description">{map.columns} by {map.rows} grid with {map.asteroidCells.length} known asteroid cells. Own ship at cell {cellLabel}. No enemy contacts.</desc>
                <g fill="none" stroke="var(--color-seam)" strokeWidth={30}>
                  {Array.from({ length: map.columns + 1 }, (_, index) => <line key={`column-${index}`} x1={index * units} y1={0} x2={index * units} y2={map.rows * units} />)}
                  {Array.from({ length: map.rows + 1 }, (_, index) => <line key={`row-${index}`} x1={0} y1={index * units} x2={map.columns * units} y2={index * units} />)}
                </g>
                {map.asteroidCells.map((cell) => (
                  <g key={`${cell.column}-${cell.row}`} data-asteroid-cell={`${cell.column},${cell.row}`}>
                    <title>Asteroid ({cell.column}, {cell.row})</title>
                    <rect x={cell.column * units} y={cell.row * units} width={units} height={units} fill="var(--color-raised)" stroke="var(--color-edge)" strokeWidth={40} />
                    <path d={`M ${(cell.column + 0.2) * units} ${(cell.row + 0.2) * units} l ${0.6 * units} ${0.6 * units} m ${-0.6 * units} 0 l ${0.6 * units} ${-0.6 * units}`} stroke="var(--color-edge)" strokeWidth={40} fill="none" />
                  </g>
                ))}
                <circle data-own-cell={`${column},${row}`} cx={own.position.x} cy={own.position.y} r={rules.geometry.shipRadiusUnits} fill="var(--color-command)" stroke="var(--color-ink)" strokeWidth={50} />
              </svg>
              <p className="pending-note text-meta">Static public terrain · own marker {cellLabel}. Movement engine pending; no encounter is running.</p>
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
            <Panel title="Orders" status={<StatusTag>No turn</StatusTag>}><Readouts items={ORDER_READOUTS} /></Panel>
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
