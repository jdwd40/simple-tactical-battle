import type { Tick, ValidationIssue } from '../../contracts'
import { issueMessage, SEVERITY_LABEL } from './validationText'

interface ValidationIssuesProps {
  readonly issues: readonly ValidationIssue[]
  readonly tickMs: number
  readonly tick: Tick
}

/** Issues are labelled by word and glyph, not colour alone. */
export function ValidationIssues({ issues, tickMs, tick }: ValidationIssuesProps) {
  if (issues.length === 0) return null
  return (
    <ul className="issues">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className="issue" data-severity={issue.severity}>
          <span className="issue-severity">
            <span aria-hidden="true" className="issue-glyph" />
            {SEVERITY_LABEL[issue.severity]}
          </span>
          <span>{issueMessage(issue, { tickMs, tick })}</span>
        </li>
      ))}
    </ul>
  )
}
