import type { PublicMap, ReplayPrefix, Ruleset } from '../../contracts'
import { elapsedText, eventText } from './consoleText'

interface EventLogProps {
  /** Cursor-bounded prefix; its events never run ahead of the playback position. */
  readonly replay: ReplayPrefix | null
  readonly rules: Ruleset
  readonly map: PublicMap
}

export function EventLog({ replay, rules, map }: EventLogProps) {
  if (!replay) {
    return <p className="pending-note">The log fills with what your ship observes as the committed turn plays.</p>
  }
  if (replay.events.length === 0) {
    return <p className="pending-note">Nothing observed yet this turn.</p>
  }
  return (
    <ol className="event-list" aria-label="Observed events">
      {[...replay.events].reverse().map((event) => (
        <li key={event.id} className="event-item" data-kind={event.kind}>
          <span className="event-time">{elapsedText(event.tick, replay.startTick, rules)}</span>
          <span>{eventText(event, { rules, map })}</span>
        </li>
      ))}
    </ol>
  )
}
