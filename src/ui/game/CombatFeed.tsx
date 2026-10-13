import type { CombatCue } from './combatReport'

const GLYPH: Record<CombatCue['kind'], string> = {
  hit: '✸', fired: '→', launch: '➚', unconfirmed: '◌', incoming: '✖', 'hostile-fire': '⚠', destroyed: '✹', expired: '·',
}

/**
 * Combat banner over the plot: the newest observed combat cues at the playback position, in
 * words and a glyph (not colour alone). It holds only what the cursor-bounded prefix contains,
 * so seeking back removes later cues.
 */
export function CombatFeed({ cues }: { cues: readonly CombatCue[] }) {
  return (
    <div className="combat-feed" aria-live="polite" aria-atomic="false" data-testid="combat-feed">
      {cues.map((cue) => (
        <p key={`${cue.tick}-${cue.kind}-${cue.text}`} className="combat-cue" data-kind={cue.kind} data-side={cue.side}>
          <span className="combat-cue-glyph" aria-hidden="true">{GLYPH[cue.kind]}</span>
          {cue.text}
        </p>
      ))}
    </div>
  )
}
