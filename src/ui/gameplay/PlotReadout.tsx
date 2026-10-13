import type { Cell, PublicMap, Ruleset } from '../../contracts'
import { cellOfPosition, compassName, velocityHeading } from '../../rendering/plotGeometry'
import type { PlotScene } from '../../rendering/plotScene'

export interface PlotReadoutProps {
  readonly id?: string
  readonly scene: PlotScene
  readonly map: PublicMap
  readonly rules: Ruleset
  /** Cell under the pointer while selecting on the plot, if any. */
  readonly pointerCell?: Cell | null
}

/** Text equivalent of the plot: own ship, course and every contact the ship knows about. */
export function PlotReadout({ id, scene, map, rules, pointerCell = null }: PlotReadoutProps) {
  const units = rules.geometry.unitsPerCell
  const tickMs = rules.timing.tickMs
  const cellText = (position: { x: number; y: number }) => {
    const cell = cellOfPosition(position, units, map)
    return `column ${cell.column}, row ${cell.row}`
  }
  const own = scene.ownShip
  const plan = scene.plan

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
        {pointerCell && (<><dt>Pointer</dt><dd>column {pointerCell.column}, row {pointerCell.row}</dd></>)}
      </dl>
      <h3 className="readout-subtitle">Contacts</h3>
      {scene.contacts.length === 0 ? (
        <p className="pending-note">No contacts. Nothing has been detected yet, or memory of earlier contacts has expired.</p>
      ) : (
        <ul className="contact-list">
          {scene.contacts.map((contact) => {
            const heading = contact.velocity ? velocityHeading(contact.velocity.xUnitsPerTick, contact.velocity.yUnitsPerTick) : null
            const speed = contact.velocity
              ? (Math.hypot(contact.velocity.xUnitsPerTick, contact.velocity.yUnitsPerTick) * (1000 / tickMs)) / units
              : 0
            return (
              <li key={contact.alias} className="contact-item" data-kind={contact.kind} data-alias={contact.alias}>
                <span className="contact-name">
                  <span aria-hidden="true" className="contact-glyph" />
                  {contact.alias}
                  <span className="contact-state">{contact.kind === 'current' ? 'Current' : 'Last known'}</span>
                </span>
                <span>
                  {contact.kind === 'current' ? 'At ' : `Seen ${((contact.ageTicks * tickMs) / 1000).toFixed(1)} s ago at `}
                  {cellText(contact.position)}
                  {contact.kind === 'stale' && `, now anywhere within ${(contact.uncertaintyRadiusUnits / units).toFixed(1)} cells`}
                  {contact.kind === 'current' && heading !== null && `, moving ${compassName(heading)} at ${speed.toFixed(1)} cells/s`}
                  {contact.destroyed && '. Observed destroyed'}
                  .
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
