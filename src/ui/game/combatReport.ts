import type { OwnAssessment, Ruleset, Tick, VisibleEvent } from '../../contracts'
import { cellText, type TextContext } from './consoleText'

/**
 * What the player can know about combat, from published events only (TSB-50):
 *   hit          an observed impact naming a contact: a confirmed hit on that contact
 *   fired        an own laser discharge with no observed impact this tick (nothing is concluded)
 *   launch       an own missile leaving the launcher
 *   unconfirmed  an observed missile impact naming no contact: ship damage unconfirmed
 *   incoming     own damage, with the attacker named only if this side saw it fire
 *   hostile-fire an observed enemy shot that did not damage us this tick
 *   destroyed    an observed destruction (contact or own ship), at its published tick
 *   expired      an own missile that ended without a detonation
 */
export type CombatCueKind = 'hit' | 'fired' | 'launch' | 'unconfirmed' | 'incoming' | 'hostile-fire' | 'destroyed' | 'expired'

export interface CombatCue {
  readonly tick: Tick
  readonly kind: CombatCueKind
  /** Own action, effect on us, or neutral observation. */
  readonly side: 'own' | 'hostile' | 'neutral'
  readonly text: string
  readonly shieldsLost?: number
  readonly hullLost?: number
}

const weaponWord = (weapon: 'laser' | 'missile') => (weapon === 'laser' ? 'Laser' : 'Missile')

/** Cues in (tick, event) order from a cursor-bounded event list; nothing beyond it exists here. */
export function combatCues(events: readonly VisibleEvent[], context: TextContext): CombatCue[] {
  const byTick = new Map<Tick, VisibleEvent[]>()
  for (const event of events) {
    const list = byTick.get(event.tick)
    if (list) list.push(event)
    else byTick.set(event.tick, [event])
  }
  const cues: CombatCue[] = []
  for (const [tick, list] of [...byTick.entries()].sort((a, b) => a[0] - b[0])) {
    const laserImpacts = list.filter((event): event is Extract<VisibleEvent, { kind: 'observed-impact' }> => event.kind === 'observed-impact' && event.weapon === 'laser')
    const shots = list.filter((event): event is Extract<VisibleEvent, { kind: 'observed-shot' }> => event.kind === 'observed-shot')
    const damage = list.find((event): event is Extract<VisibleEvent, { kind: 'own-damage' }> => event.kind === 'own-damage')
    for (const event of list) {
      switch (event.kind) {
        case 'own-shot': {
          if (event.weapon.kind === 'laser') {
            const alias = event.weapon.contactAlias
            const impact = laserImpacts.find((candidate) => candidate.contactAlias === alias)
            cues.push(impact
              ? { tick, kind: 'hit', side: 'own', text: `Laser hit ${alias}.` }
              : { tick, kind: 'fired', side: 'own', text: `Laser fired at ${alias}; no impact observed.` })
          } else {
            cues.push({ tick, kind: 'launch', side: 'own', text: `Missile launched towards column ${event.weapon.aim.column}, row ${event.weapon.aim.row}.` })
          }
          break
        }
        case 'observed-impact':
          if (event.weapon === 'missile') {
            cues.push(event.contactAlias
              ? { tick, kind: 'hit', side: 'own', text: `Missile hit ${event.contactAlias}.` }
              : { tick, kind: 'unconfirmed', side: 'neutral', text: `Missile impact at ${cellText(event.position, context)}; ship damage unconfirmed.` })
          }
          break
        case 'own-damage': {
          const source = shots[0]
          const loss = [event.shieldsLost > 0 ? `−${event.shieldsLost} shields` : '', event.hullLost > 0 ? `−${event.hullLost} hull` : ''].filter(Boolean).join(', ')
          cues.push({
            tick, kind: 'incoming', side: 'hostile', shieldsLost: event.shieldsLost, hullLost: event.hullLost,
            // Two observed facts side by side; an unseen attacker is never named or placed.
            text: source ? `Hit: ${loss} (${source.sourceAlias} fired its ${source.weapon} this tick).` : `Hit: ${loss}.`,
          })
          break
        }
        case 'observed-shot':
          if (!damage || event !== shots[0]) {
            cues.push({ tick, kind: 'hostile-fire', side: 'hostile', text: event.weapon === 'laser' ? `${event.sourceAlias} fired a laser.` : `${event.sourceAlias} launched a missile.` })
          }
          break
        case 'observed-destruction':
          cues.push({ tick, kind: 'destroyed', side: 'own', text: `${event.contactAlias} destroyed.` })
          break
        case 'own-destruction':
          cues.push({ tick, kind: 'destroyed', side: 'hostile', text: 'Shadow-Dancer destroyed.' })
          break
        case 'own-missile':
          if (event.missile.status === 'expired' || event.missile.status === 'exited-map') {
            cues.push({ tick, kind: 'expired', side: 'neutral', text: 'Own missile expired without detonating.' })
          }
          break
        default:
          break
      }
    }
  }
  return cues
}

/** Cues shown on the plot banner: the newest few within `windowTicks` of the cursor. */
export function recentCues(cues: readonly CombatCue[], cursor: Tick, windowTicks: number, limit = 3): CombatCue[] {
  return cues.filter((cue) => cue.tick <= cursor && cue.tick > cursor - windowTicks).slice(-limit).reverse()
}

export interface CombatSummary {
  /** Own fire and what was observed of it. */
  readonly outgoing: readonly CombatCue[]
  /** Damage taken, enemy fire seen, destructions. */
  readonly incoming: readonly CombatCue[]
  /** Why a committed weapon did not fire, or null. */
  readonly unfired: string | null
  readonly shieldsLost: number
  readonly hullLost: number
}

const UNFIRED_REASON: Record<string, string> = {
  'no-current-lock': 'no current lock on the target',
  'out-of-range': 'the target stayed out of range',
  'line-of-sight-blocked': 'an asteroid blocked the line of sight',
  cooldown: 'the weapon was cooling down',
  'insufficient-energy': 'not enough energy',
  'own-destroyed': 'your ship was destroyed first',
}

/** The turn's combat at a glance, from the own assessment only. */
export function combatSummary(assessment: OwnAssessment, context: TextContext): CombatSummary {
  const cues = combatCues(assessment.events, context)
  const weapon = assessment.weaponAttempt
  const unfired = weapon.kind === 'unfired'
    ? `${weaponWord(weapon.weapon)} did not fire: ${weapon.reasons.map((reason) => UNFIRED_REASON[reason] ?? reason).join('; ') || 'it never became eligible'}.`
    : null
  // The weapon attempt is authoritative for "fired" even if its shot event is not listed.
  if (weapon.kind === 'fired' && !cues.some((cue) => cue.tick === weapon.tick && (cue.kind === 'hit' || cue.kind === 'fired' || cue.kind === 'launch'))) {
    cues.push({ tick: weapon.tick, kind: 'fired', side: 'own', text: `${weaponWord(weapon.weapon)} fired.` })
    cues.sort((a, b) => a.tick - b.tick)
  }
  const own = (cue: CombatCue) => cue.kind === 'hit' || cue.kind === 'fired' || cue.kind === 'launch' || cue.kind === 'expired' || cue.kind === 'unconfirmed' || (cue.kind === 'destroyed' && cue.side === 'own')
  return {
    outgoing: cues.filter(own),
    incoming: cues.filter((cue) => !own(cue)),
    unfired,
    shieldsLost: Math.max(0, -assessment.deltas.shields),
    hullLost: Math.max(0, -assessment.deltas.hull),
  }
}

/** Seconds into the turn for a cue time. */
export const cueTime = (tick: Tick, startTick: Tick, rules: Ruleset) => `${(((tick - startTick) * rules.timing.tickMs) / 1000).toFixed(1)} s`
