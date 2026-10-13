import { useId, useState, type FormEvent } from 'react'
import { isMapCell, type Cell, type MovementOrder, type OwnRoutePreview, type PublicMap, type Tick, type ValidationIssue } from '../../contracts'
import { ConsoleButton } from '../components/ConsoleButton'
import { ValidationIssues } from './ValidationIssues'
import { cellOfPosition } from '../../rendering/plotGeometry'

export interface MovementOrdersProps {
  readonly movement: MovementOrder
  /** Supplied validation issues; only movement-related ones are shown here. */
  readonly issues: readonly ValidationIssue[]
  /** Supplied engine preview; null outside planning. */
  readonly preview: OwnRoutePreview | null
  readonly map: PublicMap
  readonly unitsPerCell: number
  readonly tickMs: number
  readonly tick: Tick
  /** Reason the order cannot be changed (committed, executing); null while planning. */
  readonly lockedReason: string | null
  readonly onMovementIntent: (order: MovementOrder) => void
}

const MOVEMENT_FIELDS = new Set<ValidationIssue['field']>(['movement', 'orders', 'turnIndex'])

/** Movement order summary with a keyboard alternative to clicking the plot. */
export function MovementOrders({ movement, issues, preview, map, unitsPerCell, tickMs, tick, lockedReason, onMovementIntent }: MovementOrdersProps) {
  const id = useId()
  const [column, setColumn] = useState(movement.kind === 'destination' ? String(movement.cell.column) : '')
  const [row, setRow] = useState(movement.kind === 'destination' ? String(movement.cell.row) : '')
  const [entryError, setEntryError] = useState<string | null>(null)
  // Follow draft changes made elsewhere (a plot click) without an effect round-trip.
  const [syncedMovement, setSyncedMovement] = useState(movement)
  if (movement !== syncedMovement) {
    setSyncedMovement(movement)
    setEntryError(null)
    if (movement.kind === 'destination') {
      setColumn(String(movement.cell.column))
      setRow(String(movement.cell.row))
    }
  }
  const locked = lockedReason !== null
  const relevant = issues.filter((issue) => MOVEMENT_FIELDS.has(issue.field))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (locked) return
    const cell: Cell = { column: Number(column), row: Number(row) }
    if (column.trim() === '' || row.trim() === '' || !isMapCell(cell, map)) {
      setEntryError(`Enter a column from 0 to ${map.columns - 1} and a row from 0 to ${map.rows - 1}.`)
      return
    }
    setEntryError(null)
    onMovementIntent({ kind: 'destination', cell })
  }

  const predicted = preview?.kind === 'destination' ? cellOfPosition(preview.nominalReachablePoint, unitsPerCell, map) : null

  return (
    <div className="movement-orders">
      <dl className="readouts">
        <dt>Movement</dt>
        <dd data-testid="movement-order">
          {movement.kind === 'hold' ? 'Hold position' : `Column ${movement.cell.column}, row ${movement.cell.row}`}
        </dd>
        {predicted && (
          <>
            <dt>Turn end</dt>
            <dd>Column {predicted.column}, row {predicted.row} (predicted)</dd>
          </>
        )}
      </dl>
      {preview?.kind === 'destination' && (
        <p className="order-note">The predicted point assumes propulsion energy every tick. Unfunded ticks pause movement.</p>
      )}
      <ValidationIssues issues={relevant} tickMs={tickMs} tick={tick} />
      {!locked && <p className="order-note">Select a cell on the plot, or enter a grid reference.</p>}

      <form className="cell-entry" onSubmit={submit} aria-describedby={locked ? `${id}-locked` : undefined} noValidate>
        <fieldset className="cell-entry-fields">
          <legend className="cell-entry-legend">Destination by grid reference</legend>
          <label className="cell-entry-field">
            <span>Column</span>
            <input
              type="number" inputMode="numeric" min={0} max={map.columns - 1} step={1}
              value={column} onChange={(event) => setColumn(event.target.value)}
              readOnly={locked} aria-invalid={entryError ? true : undefined}
              aria-describedby={entryError ? `${id}-error` : undefined}
            />
          </label>
          <label className="cell-entry-field">
            <span>Row</span>
            <input
              type="number" inputMode="numeric" min={0} max={map.rows - 1} step={1}
              value={row} onChange={(event) => setRow(event.target.value)}
              readOnly={locked} aria-invalid={entryError ? true : undefined}
              aria-describedby={entryError ? `${id}-error` : undefined}
            />
          </label>
        </fieldset>
        {entryError && <p id={`${id}-error`} className="entry-error" role="alert">{entryError}</p>}
        <div className="cell-entry-actions">
          <button type="submit" className="console-button" data-variant="standard" aria-disabled={locked || undefined}>
            Set destination
          </button>
          <ConsoleButton variant="quiet" unavailable={locked} aria-describedby={locked ? `${id}-locked` : undefined} onClick={() => onMovementIntent({ kind: 'hold' })}>
            Hold position
          </ConsoleButton>
        </div>
        {locked && <p id={`${id}-locked`} className="order-note">{lockedReason}</p>}
      </form>
    </div>
  )
}
