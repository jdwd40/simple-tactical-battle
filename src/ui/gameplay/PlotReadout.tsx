import type { Cell, PublicMap, Ruleset } from '../../contracts'
import { cellOfPosition, compassName, velocityHeading } from '../../rendering/plotGeometry'
import type { PlotContact, PlotScene } from '../../rendering/plotScene'

export interface PlotReadoutProps {
  readonly id?: string
  readonly scene: PlotScene
  readonly map: PublicMap
  readonly rules: Ruleset
  /** Cell under the pointer while selecting on the plot, if any. */
  readonly pointerCell?: Cell | null
  /** Choose a contact to mark on the plot; selecting it again clears the choice. */
  readonly onSelectContact?: (alias: string) => void
}

/** Text equivalent of the plot: own ship, course and every contact the ship knows about. */
export function PlotReadout({ id, scene, map, rules, pointerCell = null, onSelectContact }: PlotReadoutProps) {
  const units = rules.geometry.unitsPerCell
  const tickMs = rules.timing.tickMs
  const cellText = (position: { x: number; y: number }) => {
    const cell = cellOfPosition(position, units, map)
    return `column ${cell.column}, row ${cell.row}`
  }
  const own = scene.ownShip
  const plan = scene.plan
  const reach = scene.sensorRings.find((ring) => ring.kind !== 'pulse-preview')
  const sameCell = (contact: PlotContact, cell: Cell) => {
    const at = cellOfPosition(contact.position, units, map)
    return at.column === cell.column && at.row === cell.row
  }
  const pointerContacts = pointerCell ? scene.contacts.filter((contact) => sameCell(contact, pointerCell)) : []
  /** Range and bearing from own ship to the measured (current) or last-known position. */
  const rangeOf = (position: { x: number; y: number }) => {
    const dx = position.x - own.position.x
    const dy = position.y - own.position.y
    const heading = velocityHeading(dx, dy)
    if (heading === null) return 'at your position'
    return `${(Math.hypot(dx, dy) / units).toFixed(1)} cells away on bearing ${String(Math.round(heading / 1000) % 360).padStart(3, '0')}°`
  }
  const rangeBearing = (contact: PlotContact) => rangeOf(contact.position)

  return (
    <div id={id} className="plot-readout">
      <dl className="readouts">
        <dt>Position</dt>
        <dd>{cellText(own.position)}</dd>
        <dt>Heading</dt>
        <dd>{Math.round(own.headingMilliDegrees / 1000)}° {compassName(own.headingMilliDegrees)}</dd>
        {own.destroyed && (<><dt>Status</dt><dd>Destroyed</dd></>)}
        <dt>Course</dt>
        <dd>
          {!plan || plan.kind === 'hold'
            ? 'Holding'
            : `To column ${plan.destination.column}, row ${plan.destination.row}${plan.kind === 'preview' ? ' (draft)' : ''}`}
        </dd>
        {scene.weaponPlan && (
          <>
            <dt>Weapon</dt>
            <dd>
              {scene.weaponPlan.kind === 'laser'
                ? `Laser at ${scene.weaponPlan.alias}${scene.weaponPlan.current ? '' : ' (needs a new lock)'}`
                : `Missile at column ${scene.weaponPlan.aim.column}, row ${scene.weaponPlan.aim.row}`}
            </dd>
          </>
        )}
        {reach && (
          <>
            <dt>Sensor reach</dt>
            <dd>{(reach.radiusUnits / units).toFixed(0)} cells {reach.kind === 'tracking' ? '(tracking)' : '(passive)'}</dd>
          </>
        )}
        {pointerCell && (
          <>
            <dt>Pointer</dt>
            <dd>
              column {pointerCell.column}, row {pointerCell.row}
              {pointerContacts.map((contact) => `, ${contact.alias} ${contact.kind === 'current' ? 'here now' : 'last known here'}`).join('')}
            </dd>
          </>
        )}
      </dl>
      {reach && (
        <p className="order-note">
          Nominal reach for an uncloaked, stationary ship in clear line of sight. Cloaked ships must be closer; moving or exposed ships are seen further. It does not show where anything is.
        </p>
      )}
      <h3 className="readout-subtitle">Contacts</h3>
      {scene.contacts.length === 0 ? (
        <p className="pending-note">No contacts. Nothing has been detected yet, or memory of earlier contacts has expired.</p>
      ) : (
        <ul className="contact-list" aria-label="Known contacts">
          {scene.contacts.map((contact) => {
            const heading = contact.velocity ? velocityHeading(contact.velocity.xUnitsPerTick, contact.velocity.yUnitsPerTick) : null
            const speed = contact.velocity
              ? (Math.hypot(contact.velocity.xUnitsPerTick, contact.velocity.yUnitsPerTick) * (1000 / tickMs)) / units
              : 0
            const current = contact.kind === 'current'
            const details = (
              <span className="contact-details">
                {current ? 'At ' : `Seen ${((contact.ageTicks * tickMs) / 1000).toFixed(1)} s ago at `}
                {cellText(contact.position)}
                {`, ${rangeBearing(contact)}`}
                {!current && `; now anywhere within ${(contact.uncertaintyRadiusUnits / units).toFixed(1)} cells of that point`}
                {current && heading !== null && `, moving ${compassName(heading)} at ${speed.toFixed(1)} cells/s`}
                {contact.destroyed && '. Observed destroyed'}
                .
              </span>
            )
            const name = (
              <span className="contact-name">
                <span aria-hidden="true" className="contact-glyph" />
                {contact.alias}
                <span className="contact-state">{current ? 'Current' : 'Last known'}</span>
              </span>
            )
            return (
              <li key={contact.alias} className="contact-item" data-kind={contact.kind} data-alias={contact.alias} data-selected={contact.selected || undefined}>
                {onSelectContact ? (
                  <button type="button" className="contact-select" aria-pressed={contact.selected} onClick={() => onSelectContact(contact.alias)}>
                    {name}
                    {details}
                  </button>
                ) : (
                  <>
                    {name}
                    {details}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {(scene.ownMissiles.length > 0 || scene.hostileMissiles.length > 0) && (
        <>
          <h3 className="readout-subtitle ordnance-title">Ordnance</h3>
          <ul className="contact-list" aria-label="Known ordnance">
            {scene.ownMissiles.map((missile) => (
              <li key={missile.id} className="ordnance-item" data-kind="own">
                Own missile at {cellText(missile.position)}, aimed at column {missile.aim.column}, row {missile.aim.row}.
              </li>
            ))}
            {scene.hostileMissiles.map((missile) => (
              <li key={missile.alias} className="ordnance-item" data-kind={missile.kind} data-alias={missile.alias}>
                {missile.kind === 'current'
                  ? `Hostile ${missile.alias} at ${cellText(missile.position)}, ${rangeOf(missile.position)}.`
                  : `Hostile ${missile.alias} last seen ${((missile.ageTicks * tickMs) / 1000).toFixed(1)} s ago at ${cellText(missile.position)}; now anywhere within ${(missile.uncertaintyRadiusUnits / units).toFixed(1)} cells. Its aim is unknown.`}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
