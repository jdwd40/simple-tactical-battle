import type { OwnShipObservation, Ruleset, Tick } from '../../contracts'
import { Readouts } from '../components/Readouts'
import { ResourceBars, type RecentDamage } from './ResourceBars'
import { cloakShortText, exposureStatusText, readinessText, sensorStatusText } from './systemsText'

/** Own gauges and actual sensor/cloak/exposure at the frame being shown (the playback cursor during execution). */
export function OwnShipStatus({ ship, tick, rules, damage = null }: { ship: OwnShipObservation; tick: Tick; rules: Ruleset; damage?: RecentDamage | null }) {
  return (
    <>
    <ResourceBars ship={ship} damage={damage} />
    <Readouts items={[
      { label: 'Missiles', value: `${ship.ammunition.current} / ${ship.ammunition.max}` },
      ...(ship.equipment.laser ? [{ label: 'Laser', value: <span data-testid="own-laser">{readinessText(ship.clocks.laserReadyTick, tick, rules)}</span> }] : []),
      ...(ship.equipment.missileLauncher ? [{ label: 'Launcher', value: <span data-testid="own-launcher">{readinessText(ship.clocks.missileReadyTick, tick, rules)}</span> }] : []),
      { label: 'Sensor', value: <span data-testid="own-sensor">{sensorStatusText(ship, tick, rules)}</span> },
      { label: 'Cloak', value: <span data-testid="own-cloak" data-state={ship.cloak.state}>{cloakShortText(ship.cloak)}</span> },
      { label: 'Exposure', value: <span data-testid="own-exposure">{exposureStatusText(ship, tick, rules)}</span> },
      ...(ship.status === 'destroyed' ? [{ label: 'Status', value: 'Destroyed' }] : []),
    ]} />
    </>
  )
}
