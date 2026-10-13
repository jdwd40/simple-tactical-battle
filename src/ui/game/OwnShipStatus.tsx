import type { OwnShipObservation, Ruleset, Tick } from '../../contracts'
import { Readouts } from '../components/Readouts'
import { energyText } from './consoleText'
import { cloakShortText, exposureStatusText, sensorStatusText } from './systemsText'

/** Own gauges and actual sensor/cloak/exposure at the frame being shown (the playback cursor during execution). */
export function OwnShipStatus({ ship, tick, rules }: { ship: OwnShipObservation; tick: Tick; rules: Ruleset }) {
  return (
    <Readouts items={[
      { label: 'Energy', value: `${energyText(ship.energy.currentMilli)} / ${energyText(ship.energy.maxMilli)}` },
      { label: 'Shields', value: `${ship.shields.current} / ${ship.shields.max}` },
      { label: 'Hull', value: `${ship.hull.current} / ${ship.hull.max}` },
      { label: 'Missiles', value: `${ship.ammunition.current} / ${ship.ammunition.max}` },
      { label: 'Sensor', value: <span data-testid="own-sensor">{sensorStatusText(ship, tick, rules)}</span> },
      { label: 'Cloak', value: <span data-testid="own-cloak" data-state={ship.cloak.state}>{cloakShortText(ship.cloak)}</span> },
      { label: 'Exposure', value: <span data-testid="own-exposure">{exposureStatusText(ship, tick, rules)}</span> },
      ...(ship.status === 'destroyed' ? [{ label: 'Status', value: 'Destroyed' }] : []),
    ]} />
  )
}
