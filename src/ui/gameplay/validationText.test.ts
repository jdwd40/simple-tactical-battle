import { describe, expect, it } from 'vitest'
import type { ValidationIssue } from '../../contracts'
import { issueMessage } from './validationText'

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
})
