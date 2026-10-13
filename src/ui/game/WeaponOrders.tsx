import { useId, useState, type FormEvent } from 'react'
import {
  isMapCell, type Cell, type ContactMemory, type OwnShipObservation, type PublicMap, type Ruleset, type Tick, type TurnOrders,
  type ValidationIssue, type VisibleEvent, type WeaponOrder,
} from '../../contracts'
import { cellOfPosition } from '../../rendering/plotGeometry'
import { ConsoleButton } from '../components/ConsoleButton'
import { ValidationIssues } from '../gameplay/ValidationIssues'
import { Effects, Segmented } from './SystemOrders'
import { targetText, weaponEffects, weaponProgressText, type OrderCapabilities } from './systemsText'

export interface WeaponOrdersProps {
  /** The draft while planning, otherwise the committed orders. */
  readonly orders: TurnOrders
  readonly own: OwnShipObservation
  /** Contacts known at the shown frame; the only possible laser targets. */
  readonly contacts: readonly ContactMemory[]
  readonly map: PublicMap
  readonly tick: Tick
  readonly turnStartTick: Tick
  readonly ticksResolved: number
  /** Events through the shown frame, for whether the committed intent has fired yet. */
  readonly events: readonly VisibleEvent[]
  readonly rules: Ruleset
  readonly issues: readonly ValidationIssue[]
  readonly capabilities: Pick<OrderCapabilities, 'laser' | 'missile'>
  /** True while plot clicks aim the missile instead of setting the destination. */
  readonly aiming: boolean
  readonly lockedReason: string | null
  readonly onWeapon: (weapon: WeaponOrder) => void
  readonly onAimingChange: (aiming: boolean) => void
}

type Kind = WeaponOrder['kind']

/**
 * One weapon intent per turn: hold fire, a conditional laser at a known contact alias, or a
 * missile at a plotted cell. Aiming on the plot is a deliberate mode, never a movement click.
 */
export function WeaponOrders({
  orders, own, contacts, map, tick, turnStartTick, ticksResolved, events, rules, issues, capabilities, aiming, lockedReason, onWeapon, onAimingChange,
}: WeaponOrdersProps) {
  const id = useId()
  const locked = lockedReason !== null
  const weapon = orders.weapon
  // Missile chosen but not yet aimed: the order stays hold fire until a cell is chosen.
  const [pendingMissile, setPendingMissile] = useState(false)
  const shownKind: Kind = !locked && pendingMissile && weapon.kind !== 'missile' ? 'missile' : weapon.kind
  const [column, setColumn] = useState('')
  const [row, setRow] = useState('')
  const [entryError, setEntryError] = useState<string | null>(null)

  const laserUnavailable = !capabilities.laser ? 'Lasers are not available in this version yet.'
    : !own.equipment.laser ? 'This ship has no laser.'
      : contacts.length === 0 ? 'No known contact to aim a laser at.' : null
  const missileUnavailable = !capabilities.missile ? 'Missiles are not available in this version yet.'
    : !own.equipment.missileLauncher ? 'This ship has no missile launcher.'
      : own.ammunition.current === 0 ? 'No missiles left.' : null
  const notes = [...new Set([laserUnavailable, missileUnavailable].filter((note): note is string => note !== null))]
  const relevant = issues.filter((issue) => issue.field === 'weapon')

  const aimAt = (cell: Cell) => {
    setPendingMissile(false)
    onAimingChange(false)
    onWeapon({ kind: 'missile', aim: cell })
  }
  const select = (kind: Kind) => {
    setEntryError(null)
    if (kind === 'hold') {
      setPendingMissile(false)
      onAimingChange(false)
      onWeapon({ kind: 'hold' })
    } else if (kind === 'laser') {
      setPendingMissile(false)
      onAimingChange(false)
      const target = contacts.find((contact) => contact.kind === 'current') ?? contacts[0]
      if (target) onWeapon({ kind: 'laser', contactAlias: target.alias })
    } else {
      setPendingMissile(true)
      onAimingChange(true)
      // Until a cell is chosen the intent is hold fire, never a leftover laser.
      if (weapon.kind !== 'missile') onWeapon({ kind: 'hold' })
    }
  }
  const submitAim = (event: FormEvent) => {
    event.preventDefault()
    const cell: Cell = { column: Number(column), row: Number(row) }
    if (column.trim() === '' || row.trim() === '' || !isMapCell(cell, map)) {
      setEntryError(`Enter a column from 0 to ${map.columns - 1} and a row from 0 to ${map.rows - 1}.`)
      return
    }
    setEntryError(null)
    aimAt(cell)
  }

  const progress = locked ? weaponProgressText(orders, own, events, turnStartTick, ticksResolved, rules) : null
  const aimCell = weapon.kind === 'missile' ? weapon.aim : null
  const target = weapon.kind === 'laser' ? contacts.find((contact) => contact.alias === weapon.contactAlias) : undefined

  return (
    <div className="weapon-orders">
      <Segmented<Kind>
        legend="Weapon" name={`${id}-weapon`} value={shownKind} locked={locked}
        describedBy={notes.length > 0 ? `${id}-unavailable` : undefined}
        options={[
          { value: 'hold', label: 'Hold fire' },
          { value: 'laser', label: 'Laser', unavailable: laserUnavailable },
          { value: 'missile', label: 'Missile', unavailable: missileUnavailable },
        ]}
        onSelect={select}
      />
      {notes.length > 0 && !locked && <p id={`${id}-unavailable`} className="order-note">{notes.join(' ')}</p>}
      {shownKind === 'hold' && <p className="order-note">No weapon fires this turn.</p>}

      {shownKind === 'laser' && (
        <>
          {!locked && contacts.length > 0 && (
            <fieldset className="target-list">
              <legend className="cell-entry-legend">Laser target</legend>
              {contacts.map((contact) => (
                <label key={contact.alias} className="target-option" data-kind={contact.kind}>
                  <input
                    type="radio" name={`${id}-target`} value={contact.alias}
                    checked={weapon.kind === 'laser' && weapon.contactAlias === contact.alias}
                    onChange={() => onWeapon({ kind: 'laser', contactAlias: contact.alias })}
                  />
                  <span aria-hidden="true" className="contact-glyph" />
                  <span>{targetText(contact, rules)}</span>
                </label>
              ))}
            </fieldset>
          )}
          {locked && weapon.kind === 'laser' && (
            <p className="order-note system-progress">Target {target ? targetText(target, rules) : `${weapon.contactAlias}, not in memory at this time`}.</p>
          )}
          <Effects label="Laser effects" items={weaponEffects('laser', own, tick, rules)} />
        </>
      )}

      {shownKind === 'missile' && (
        <>
          <p className="order-note system-progress" data-testid="missile-aim">
            {aimCell ? `Aimed at column ${aimCell.column}, row ${aimCell.row}. It flies straight from where it launches and does not home.` : 'No aim yet: the order stays Hold fire until you choose a cell.'}
          </p>
          {!locked && (
            <form className="cell-entry" onSubmit={submitAim} noValidate>
              <div className="cell-entry-actions">
                <ConsoleButton aria-pressed={aiming} onClick={() => onAimingChange(!aiming)}>
                  {aiming ? 'Cancel plot aiming' : 'Aim on plot'}
                </ConsoleButton>
                {contacts.map((contact) => {
                  const cell = cellOfPosition(contact.measurement.position, rules.geometry.unitsPerCell, map)
                  return (
                    <ConsoleButton key={contact.alias} variant="quiet" onClick={() => aimAt(cell)}>
                      At {contact.alias} {contact.kind === 'current' ? 'now' : 'last known'}
                    </ConsoleButton>
                  )
                })}
              </div>
              {aiming && <p className="order-note system-hint">Plot clicks now aim the missile. Press Escape to stop aiming.</p>}
              <fieldset className="cell-entry-fields">
                <legend className="cell-entry-legend">Aim by grid reference</legend>
                <label className="cell-entry-field">
                  <span>Aim column</span>
                  <input type="number" inputMode="numeric" min={0} max={map.columns - 1} step={1} value={column}
                    onChange={(event) => setColumn(event.target.value)} aria-invalid={entryError ? true : undefined}
                    aria-describedby={entryError ? `${id}-aim-error` : undefined} />
                </label>
                <label className="cell-entry-field">
                  <span>Aim row</span>
                  <input type="number" inputMode="numeric" min={0} max={map.rows - 1} step={1} value={row}
                    onChange={(event) => setRow(event.target.value)} aria-invalid={entryError ? true : undefined}
                    aria-describedby={entryError ? `${id}-aim-error` : undefined} />
                </label>
              </fieldset>
              {entryError && <p id={`${id}-aim-error`} className="entry-error" role="alert">{entryError}</p>}
              <div className="cell-entry-actions">
                <button type="submit" className="console-button" data-variant="standard">Set aim</button>
              </div>
            </form>
          )}
          <Effects label="Missile effects" items={weaponEffects('missile', own, tick, rules)} />
        </>
      )}

      <ValidationIssues issues={relevant} tickMs={rules.timing.tickMs} tick={tick} />
      {progress && <p className="order-note system-progress" data-testid="weapon-progress">{progress}</p>}
    </div>
  )
}
