interface PhaseTrackProps {
  phases: readonly string[]
  /** The current phase label; omit when no turn is in progress. */
  current?: string
}

export function PhaseTrack({ phases, current }: PhaseTrackProps) {
  return (
    <ol className="phase-track" aria-label="Turn phases">
      {phases.map((phase) => (
        <li key={phase} className="phase-step" aria-current={phase === current ? 'step' : undefined}>
          <span className="phase-marker" aria-hidden="true" />
          {phase}
        </li>
      ))}
    </ol>
  )
}
