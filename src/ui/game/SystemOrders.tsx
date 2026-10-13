import { useId } from 'react'
import type { OwnShipObservation, Ruleset, SensorOrder, Tick, TurnOrders, ValidationIssue } from '../../contracts'
import { ValidationIssues } from '../gameplay/ValidationIssues'
import { energyText } from './consoleText'
import {
  cloakEffects, cloakNowText, cloakRequestHint, energyPlan, pulseProgressText, sensorEffects, type Effect,
} from './systemsText'

export interface SystemOrdersProps {
  /** The draft while planning, otherwise the committed orders. */
  readonly orders: TurnOrders
  /** Own observation at the shown frame: the planning frame, or the playback cursor. */
  readonly own: OwnShipObservation
  readonly tick: Tick
  /** Ticks of the committed turn resolved at the shown frame; 0 at commit and the turn's start. */
  readonly ticksResolved: number
  readonly rules: Ruleset
  /** Supplied validation issues; only sensor and cloak ones are shown here. */
  readonly issues: readonly ValidationIssue[]
  /** Why an active pulse cannot be ordered in this build or ship, or null when it can. */
  readonly pulseUnavailableReason: string | null
  /** True when the draft moves this turn, for the energy budget. */
  readonly moving: boolean
  readonly lockedReason: string | null
  readonly onChange: (change: { readonly sensor?: SensorOrder; readonly cloak?: boolean }) => void
}

const SYSTEM_FIELDS = new Set<ValidationIssue['field']>(['sensor', 'cloak'])

export function Effects({ items, label }: { items: readonly Effect[]; label: string }) {
  return (
    <dl className="readouts system-effects" aria-label={label}>
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

interface Option<T> { readonly value: T; readonly label: string; readonly unavailable?: string | null }

export function Segmented<T extends string>({ legend, name, value, options, locked, describedBy, onSelect }: {
  legend: string; name: string; value: T; options: readonly Option<T>[]; locked: boolean; describedBy?: string; onSelect: (value: T) => void
}) {
  return (
    <fieldset className="segmented" disabled={locked} aria-describedby={describedBy}>
      <legend className="segmented-legend">{legend}</legend>
      <div className="segmented-options">
        {options.map((option) => (
          <label key={option.value} className="segmented-option" data-unavailable={option.unavailable ? 'true' : undefined}>
            <input
              type="radio" name={name} value={option.value} checked={value === option.value}
              disabled={Boolean(option.unavailable)} onChange={() => onSelect(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * Sensor and cloak orders with their public-rule costs and consequences, the actual cloak
 * state beside the request, and the engine's sensor/cloak issues. Locked outside planning.
 */
export function SystemOrders({ orders, own, tick, ticksResolved, rules, issues, pulseUnavailableReason, moving, lockedReason, onChange }: SystemOrdersProps) {
  const id = useId()
  const locked = lockedReason !== null
  const relevant = issues.filter((issue) => SYSTEM_FIELDS.has(issue.field))
  const cloakUnavailable = own.equipment.cloak ? null : 'This ship has no cloak.'
  const hint = locked ? null : cloakRequestHint(own, orders.cloak)
  const plan = energyPlan(orders, own, moving, rules)

  return (
    <div className="system-orders">
      <Segmented<SensorOrder>
        legend="Sensor" name={`${id}-sensor`} value={orders.sensor} locked={locked}
        describedBy={pulseUnavailableReason ? `${id}-pulse-unavailable` : undefined}
        options={[{ value: 'passive', label: 'Passive' }, { value: 'activePulse', label: 'Active pulse', unavailable: pulseUnavailableReason }]}
        onSelect={(sensor) => onChange({ sensor })}
      />
      {pulseUnavailableReason && <p id={`${id}-pulse-unavailable`} className="order-note">{pulseUnavailableReason}</p>}
      <Effects label={orders.sensor === 'passive' ? 'Passive sensing' : 'Active pulse effects'} items={sensorEffects(orders.sensor, rules)} />
      {locked && orders.sensor === 'activePulse' && (
        <p className="order-note system-progress" data-testid="pulse-progress">{pulseProgressText(own, tick, ticksResolved, rules)}</p>
      )}

      <Segmented<'off' | 'on'>
        legend="Cloak" name={`${id}-cloak`} value={orders.cloak ? 'on' : 'off'} locked={locked}
        describedBy={`${id}-cloak-now`}
        options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On', unavailable: cloakUnavailable }]}
        onSelect={(value) => onChange({ cloak: value === 'on' })}
      />
      <p id={`${id}-cloak-now`} className="order-note system-progress" data-testid="cloak-now" data-state={own.cloak.state}>
        {locked && <>Requested {orders.cloak ? 'on' : 'off'}. </>}
        {cloakNowText(own, tick, rules)}
      </p>
      {hint && <p className="order-note system-hint">{hint}</p>}
      <Effects label={orders.cloak ? 'Cloak effects' : 'Uncloaked signature'} items={cloakEffects(orders.cloak, own, rules)} />

      <ValidationIssues issues={relevant} tickMs={rules.timing.tickMs} tick={tick} />

      {!locked && (
        <div className="energy-plan" data-testid="energy-plan">
          <dl className="readouts">
            <dt>Energy now</dt>
            <dd>{energyText(plan.currentMilli)} / {energyText(plan.maxMilli)}</dd>
            <dt>Upkeep this turn</dt>
            <dd>{plan.upkeepMilli === 0 ? 'None' : `Up to ${energyText(plan.upkeepMilli)}`}</dd>
            <dt>Recharge</dt>
            <dd>+{energyText(plan.rechargeMilli)}</dd>
          </dl>
          {plan.parts.length > 0 && <p className="order-note">Upkeep: {plan.parts.join(', ')}.</p>}
          {plan.mayRunShort && (
            <p className="order-note system-warning" data-testid="energy-short">
              <span aria-hidden="true" className="system-warning-glyph" />
              Energy may run short this turn: the pulse fails if unfunded, movement pauses, and cloak fails when upkeep runs out.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
