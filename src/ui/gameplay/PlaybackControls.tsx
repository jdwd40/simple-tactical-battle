import { useId } from 'react'
import type { PlaybackCommand, ReplayPrefix } from '../../contracts'
import { ConsoleButton } from '../components/ConsoleButton'
import { PlayIcon, SkipToEndIcon, StepBackIcon, StepForwardIcon } from '../components/icons'

const SPEEDS = [0.5, 1, 2, 4] as const

export interface PlaybackControlsProps {
  /** Cursor-bounded prefix from the controller; null when no playback is available. */
  readonly replay: ReplayPrefix | null
  readonly tickMs: number
  /** Why playback is unavailable (planning, commit); shown and announced when replay is null. */
  readonly unavailableReason: string
  readonly onCommand: (command: PlaybackCommand) => void
}

function PauseIcon() {
  return <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M4 3h3v10H4zM9 3h3v10H9z" /></svg>
}

/**
 * Presentation-only playback commands. They move the controller's cursor; they never
 * change orders or results. Only the start/end bounds and cursor are read from the prefix.
 */
export function PlaybackControls({ replay, tickMs, unavailableReason, onCommand }: PlaybackControlsProps) {
  const id = useId()
  const reasonId = `${id}-reason`
  const unavailable = replay === null
  const atStart = replay ? replay.cursorTick <= replay.startTick : true
  const atEnd = replay ? replay.cursorTick >= replay.endTick : true
  const playing = replay?.playback.playing ?? false
  const elapsed = (tick: number) => `${(((tick - (replay?.startTick ?? 0)) * tickMs) / 1000).toFixed(1)} s`
  const timeText = replay ? `${elapsed(replay.cursorTick)} of ${elapsed(replay.endTick)}` : unavailableReason
  const shortTime = replay ? `${elapsed(replay.cursorTick).replace(' s', '')} / ${elapsed(replay.endTick)}` : unavailableReason

  return (
    <div className="transport playback" role="group" aria-label="Playback" aria-describedby={unavailable ? reasonId : undefined}>
      <div className="transport-buttons">
        <ConsoleButton unavailable={unavailable || atStart} icon={<StepBackIcon />} aria-describedby={unavailable ? reasonId : undefined}
          onClick={() => onCommand({ kind: 'step', direction: -1 })}>Back</ConsoleButton>
        <ConsoleButton unavailable={unavailable || (atEnd && !playing)} icon={playing ? <PauseIcon /> : <PlayIcon />} aria-describedby={unavailable ? reasonId : undefined}
          onClick={() => onCommand({ kind: playing ? 'pause' : 'play' })}>{playing ? 'Pause' : 'Play'}</ConsoleButton>
        <ConsoleButton unavailable={unavailable || atEnd} icon={<StepForwardIcon />} aria-describedby={unavailable ? reasonId : undefined}
          onClick={() => onCommand({ kind: 'step', direction: 1 })}>Forward</ConsoleButton>
        <ConsoleButton unavailable={unavailable || atEnd} icon={<SkipToEndIcon />} aria-describedby={unavailable ? reasonId : undefined}
          onClick={() => onCommand({ kind: 'skipToEnd' })}>Skip to end</ConsoleButton>
      </div>
      <div className="timeline">
        {replay ? (
          <input
            className="timeline-seek"
            type="range"
            aria-label="Playback position"
            aria-valuetext={timeText}
            min={replay.startTick}
            max={replay.endTick}
            step={1}
            value={replay.cursorTick}
            onChange={(event) => onCommand({ kind: 'seek', tick: Number(event.target.value) })}
          />
        ) : (
          <span className="timeline-track" aria-hidden="true" />
        )}
        <span id={reasonId} className="timeline-label" data-kind={replay ? 'time' : 'reason'} aria-hidden={replay ? true : undefined}>{shortTime}</span>
      </div>
      <fieldset className="speed" disabled={unavailable}>
        <legend className="sr-only">Playback speed</legend>
        {SPEEDS.map((speed) => (
          <label key={speed} className="speed-option">
            <input
              type="radio"
              name={`${id}-speed`}
              value={speed}
              checked={(replay?.playback.speed ?? 1) === speed}
              onChange={() => onCommand({ kind: 'speed', speed })}
            />
            <span>{speed}×</span>
          </label>
        ))}
      </fieldset>
    </div>
  )
}
