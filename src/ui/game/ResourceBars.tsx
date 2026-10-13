import type { OwnShipObservation } from '../../contracts'
import { energyText } from './consoleText'

export interface RecentDamage {
  readonly shieldsLost: number
  readonly hullLost: number
}

/** Own energy, shields and hull as bars at the shown frame, with the latest damage marked. */
export function ResourceBars({ ship, damage, compact = false }: { ship: OwnShipObservation; damage: RecentDamage | null; compact?: boolean }) {
  const rows = [
    { key: 'energy', label: 'Energy', current: ship.energy.currentMilli / 1000, max: ship.energy.maxMilli / 1000, text: `${energyText(ship.energy.currentMilli)} / ${energyText(ship.energy.maxMilli)}`, lost: 0 },
    { key: 'shields', label: 'Shields', current: ship.shields.current, max: ship.shields.max, text: `${ship.shields.current} / ${ship.shields.max}`, lost: damage?.shieldsLost ?? 0 },
    { key: 'hull', label: 'Hull', current: ship.hull.current, max: ship.hull.max, text: `${ship.hull.current} / ${ship.hull.max}`, lost: damage?.hullLost ?? 0 },
  ]
  return (
    <div className={compact ? 'resource-bars compact' : 'resource-bars'}>
      {rows.map((row) => {
        const share = row.max > 0 ? Math.max(0, Math.min(1, row.current / row.max)) : 0
        const lostShare = row.max > 0 ? Math.min(1 - share, row.lost / row.max) : 0
        return (
          <div key={row.key} className="resource-row" data-resource={row.key} data-hit={row.lost > 0 || undefined}>
            <span className="resource-label">{row.label}</span>
            <span className="resource-track" aria-hidden="true">
              <span className="resource-fill" style={{ width: `${share * 100}%` }} />
              {lostShare > 0 && <span className="resource-lost" style={{ left: `${share * 100}%`, width: `${lostShare * 100}%` }} />}
            </span>
            <span className="resource-value">
              {row.text}
              {row.lost > 0 && <span className="resource-delta" data-testid={`lost-${row.key}`}> −{row.lost}</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}
