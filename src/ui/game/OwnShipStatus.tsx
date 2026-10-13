import type { OwnShipObservation } from '../../contracts'
import { Readouts } from '../components/Readouts'
import { cloakText, energyText } from './consoleText'

/** Own gauges at the frame being shown (the playback cursor during execution). */
export function OwnShipStatus({ ship }: { ship: OwnShipObservation }) {
  return (
    <Readouts items={[
      { label: 'Energy', value: `${energyText(ship.energy.currentMilli)} / ${energyText(ship.energy.maxMilli)}` },
      { label: 'Shields', value: `${ship.shields.current} / ${ship.shields.max}` },
      { label: 'Hull', value: `${ship.hull.current} / ${ship.hull.max}` },
      { label: 'Missiles', value: `${ship.ammunition.current} / ${ship.ammunition.max}` },
      { label: 'Sensor', value: ship.sensor === 'passive' ? 'Passive' : 'Tracking' },
      { label: 'Cloak', value: cloakText(ship.cloak) },
      ...(ship.status === 'destroyed' ? [{ label: 'Status', value: 'Destroyed' }] : []),
    ]} />
  )
}
