import { describe, expect, it } from 'vitest'
import type { ValidationIssue } from '../../contracts'
import { issueMessage, severityLabel } from './validationText'

const codes: ValidationIssue[] = [
  ...(['invalid-shape', 'invalid-turn', 'out-of-bounds', 'obstacle', 'unreachable', 'unknown-alias', 'equipment-unavailable', 'no-ammunition', 'observed-opponent-destroyed'] as const)
    .map((code) => ({ field: 'orders' as const, severity: 'error' as const, code })),
  ...(['awaiting-current-lock', 'awaiting-range', 'awaiting-line-of-sight', 'awaiting-cooldown', 'awaiting-energy', 'propulsion-funding', 'cloak-exposure'] as const)
    .map((code) => ({ field: 'weapon' as const, severity: 'conditional' as const, code })),
  { field: 'cloak', severity: 'warning', code: 'activity-breaks-cloak' },
]

describe('validation messages', () => {
  it('explains every contract issue code in plain language', () => {
    for (const issue of codes) expect(issueMessage(issue, { tickMs: 100, tick: 0 })).toMatch(/^[A-Z].+\.$/)
  })

  it('uses supplied safe details', () => {
    const context = { tickMs: 100, tick: 40 }
    expect(issueMessage({ field: 'movement', severity: 'error', code: 'obstacle', details: { cell: { column: 7, row: 4 } } }, context)).toBe('Column 7, row 4 is an asteroid. Choose open space.')
    expect(issueMessage({ field: 'weapon', severity: 'conditional', code: 'awaiting-cooldown', details: { readyTick: 65 } }, context)).toBe('Fires once the weapon has cooled down, in 2.5 s.')
    expect(issueMessage({ field: 'weapon', severity: 'conditional', code: 'awaiting-energy', details: { requiredEnergyMilli: 18_000, availableEnergyMilli: 12_400 } }, context)).toBe('Needs 18 energy; 12 available now.')
  })

  it('describes a pulse energy forecast as a one-off failure, not a wait', () => {
    const issue: ValidationIssue = { field: 'sensor', severity: 'conditional', code: 'awaiting-energy', details: { requiredEnergyMilli: 12_000, availableEnergyMilli: 9_800 } }
    expect(issueMessage(issue, { tickMs: 100, tick: 0 })).toBe('The pulse needs 12 energy on the first tick; 9 would be available. It would fail once, without exposing you.')
    expect(severityLabel(issue)).toBe('Will fail')
    expect(severityLabel({ field: 'weapon', severity: 'conditional', code: 'awaiting-energy' })).toBe('Waits')
  })

  it('times a cloak held off by exposure from the supplied ready tick', () => {
    expect(issueMessage({ field: 'cloak', severity: 'conditional', code: 'cloak-exposure', details: { readyTick: 130 } }, { tickMs: 100, tick: 100 }))
      .toBe('Cloak engages only once your exposure ends, in 3.0 s, and only if funded.')
  })
})
