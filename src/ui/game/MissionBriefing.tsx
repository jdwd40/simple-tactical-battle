import { useEffect, useId, useRef } from 'react'
import type { Ruleset } from '../../contracts'
import { ConsoleButton } from '../components/ConsoleButton'

export interface MissionBriefingProps {
  readonly open: boolean
  /** Seed of the current encounter, shown as reproduction data. */
  readonly seed: number | null
  /** True on the first showing, before any orders; later showings return to the console. */
  readonly first: boolean
  readonly rules: Ruleset
  readonly onClose: () => void
}

/**
 * The brief opening: setting, objective and a few rules that matter in the first turns. It is
 * a modal over the console and changes nothing in the encounter; planning stays paused.
 * Public knowledge only: nothing about the frigate's position, route or condition.
 */
export function MissionBriefing({ open, seed, first, rules, onClose }: MissionBriefingProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog ref={ref} className="briefing" aria-labelledby={titleId} onClose={onClose}>
      <div className="briefing-body">
        <h2 id={titleId} className="briefing-title">Patrol encounter</h2>
        <p>
          The colonial war is in its last months. The Federation holds the colonies; Earth is still free.
          The Earth stealth ship Shadow-Dancer has met a lone Federation patrol frigate in an asteroid field.
        </p>
        <p className="briefing-objective">
          Destroy the frigate and survive. If Shadow-Dancer is lost it is a defeat; if both ships are lost it is mutual destruction.
        </p>
        <h3 className="briefing-subtitle">How a turn works</h3>
        <p>
          Time stops while you plan, for as long as you like. Set movement, sensor, cloak and one weapon order, then commit:
          both ships act at once for {rules.timing.turnMs / 1000} seconds. Watch it play, replay it if you want, then plan the next turn.
        </p>
        <h3 className="briefing-subtitle">Worth knowing</h3>
        <ul className="briefing-tips">
          <li>You start cloaked and holding. Cloak costs energy each second, and firing or an active pulse breaks it for the rest of that turn.</li>
          <li>Solid markers are what you see now. Dashed markers are last-known positions whose uncertainty grows with age.</li>
          <li>A laser needs a current lock within {rules.laser.rangeUnits / rules.geometry.unitsPerCell} cells. A missile flies straight to the cell you plot and does not home, so lead a moving target, and keep moving to dodge one.</li>
          <li>Shields take damage before hull, and energy recharges slowly. The orders panel shows the upkeep before you commit.</li>
          <li>Everything works from the keyboard: Tab through the controls, and enter grid references wherever you could click the plot.</li>
        </ul>
        {seed !== null && <p className="briefing-seed">Seed {seed}. The same seed and the same orders always play out the same way.</p>}
        <div className="assessment-actions">
          <ConsoleButton variant="commit" onClick={() => ref.current?.close()} autoFocus>
            {first ? 'Begin mission' : 'Return to the console'}
          </ConsoleButton>
        </div>
      </div>
    </dialog>
  )
}
