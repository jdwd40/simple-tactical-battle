import type { OwnAssessment, Ruleset, Tick } from '../../contracts'
import type { TextContext } from './consoleText'
import { combatSummary, cueTime, type CombatCue } from './combatReport'

function CueList({ title, cues, rules, startTick, empty }: { title: string; cues: readonly CombatCue[]; rules: Ruleset; startTick: Tick; empty: string }) {
  return (
    <div className="combat-summary-group">
      <h3 className="combat-summary-title">{title}</h3>
      {cues.length === 0 ? <p className="combat-summary-empty">{empty}</p> : (
        <ul className="combat-summary-list">
          {cues.map((cue) => (
            <li key={`${cue.tick}-${cue.kind}-${cue.text}`} data-kind={cue.kind}>
              <span className="combat-summary-time">{cueTime(cue.tick, startTick, rules)}</span>
              <span>{cue.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The turn's combat at a glance, at the top of the assessment and the ending: what was fired
 * and observed, what hit this ship, and why a weapon did not fire. From the own assessment only.
 */
export function CombatSummary({ assessment, context, startTick }: { assessment: OwnAssessment; context: TextContext; startTick: Tick }) {
  const summary = combatSummary(assessment, context)
  const quiet = summary.outgoing.length === 0 && summary.incoming.length === 0 && summary.unfired === null
  if (quiet) return <p className="combat-summary-quiet" data-testid="combat-summary">No shots fired or hits taken this turn.</p>
  return (
    <section className="combat-summary" aria-label="Combat this turn" data-testid="combat-summary">
      {(summary.shieldsLost > 0 || summary.hullLost > 0) && (
        <p className="combat-summary-damage" data-testid="damage-taken">
          <span aria-hidden="true">✖</span> Damage taken: {summary.shieldsLost} shields, {summary.hullLost} hull
        </p>
      )}
      <CueList title="Your fire" cues={summary.outgoing} rules={context.rules} startTick={startTick} empty="You did not fire." />
      {summary.unfired && <p className="combat-summary-unfired" data-testid="unfired">{summary.unfired}</p>}
      <CueList
        title="Against you" cues={summary.incoming} rules={context.rules} startTick={startTick}
        empty={summary.shieldsLost + summary.hullLost > 0 ? 'No individual hits recorded.' : 'Nothing hit you.'}
      />
    </section>
  )
}
