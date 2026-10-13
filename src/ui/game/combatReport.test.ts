import { describe, expect, it } from 'vitest'
import { DUEL_MAP, DUEL_RULES, type OwnAssessment, type VisibleEvent } from '../../contracts'
import { combatCues, combatSummary, recentCues } from './combatReport'

const context = { rules: DUEL_RULES, map: DUEL_MAP }
const position = { x: 3500, y: 10_500 }
const at = (tick: number, body: Record<string, unknown>, index = 0) => ({ id: `t${tick}-00${index}`, tick, ...body }) as VisibleEvent

describe('combat cues from published events only', () => {
  it('confirms a laser hit only from an observed impact naming the contact at the same tick', () => {
    const shot = at(201, { kind: 'own-shot', position, weapon: { kind: 'laser', contactAlias: 'contact-1' } })
    const impact = at(201, { kind: 'observed-impact', position: { x: 9500, y: 9500 }, weapon: 'laser', contactAlias: 'contact-1' }, 1)
    expect(combatCues([shot, impact], context)).toEqual([expect.objectContaining({ tick: 201, kind: 'hit', side: 'own', text: 'Laser hit contact-1.' })])
    // No observed impact: the discharge is reported, nothing is concluded about a hit or a miss.
    expect(combatCues([shot], context)).toEqual([expect.objectContaining({ kind: 'fired', text: 'Laser fired at contact-1; no impact observed.' })])
  })

  it('keeps a missile impact naming no contact as an unconfirmed explosion', () => {
    const cues = combatCues([
      at(223, { kind: 'observed-impact', position: { x: 7780, y: 6100 }, weapon: 'missile' }),
      at(330, { kind: 'observed-impact', position: { x: 9500, y: 9500 }, weapon: 'missile', contactAlias: 'contact-1' }),
    ], context)
    expect(cues.map(({ kind, text }) => [kind, text])).toEqual([
      ['unconfirmed', 'Missile impact at column 7, row 6; ship damage unconfirmed.'],
      ['hit', 'Missile hit contact-1.'],
    ])
  })

  it('reports own damage exactly, naming an attacker only if it was seen firing that tick', () => {
    const seen = combatCues([
      at(101, { kind: 'observed-shot', sourceAlias: 'contact-1', position: { x: 9500, y: 9500 }, weapon: 'laser' }),
      at(101, { kind: 'own-damage', shieldsLost: 35, hullLost: 0 }, 1),
    ], context)
    expect(seen).toEqual([expect.objectContaining({ kind: 'incoming', shieldsLost: 35, hullLost: 0, text: 'Hit: −35 shields (contact-1 fired its laser this tick).' })])
    const unseen = combatCues([at(204, { kind: 'own-damage', shieldsLost: 40, hullLost: 5 })], context)
    expect(unseen).toEqual([expect.objectContaining({ kind: 'incoming', text: 'Hit: −40 shields, −5 hull.' })])
    expect(combatCues([at(301, { kind: 'observed-shot', sourceAlias: 'contact-1', position, weapon: 'missile' })], context))
      .toEqual([expect.objectContaining({ kind: 'hostile-fire', text: 'contact-1 launched a missile.' })])
  })

  it('reports destructions and expired own missiles at their published ticks', () => {
    const cues = combatCues([
      at(601, { kind: 'observed-destruction', contactAlias: 'contact-1', position }),
      at(601, { kind: 'own-destruction', position }, 1),
      at(650, { kind: 'own-missile', missile: { id: 'm', position, aim: { column: 1, row: 1 }, launchTick: 500, updatedTick: 650, status: 'expired' } }),
    ], context)
    expect(cues.map((cue) => [cue.tick, cue.kind, cue.side, cue.text])).toEqual([
      [601, 'destroyed', 'own', 'contact-1 destroyed.'],
      [601, 'destroyed', 'hostile', 'Shadow-Dancer destroyed.'],
      [650, 'expired', 'neutral', 'Own missile expired without detonating.'],
    ])
  })

  it('shows on the banner only cues at or before the cursor, newest first, within the window', () => {
    const cues = combatCues([
      at(101, { kind: 'own-damage', shieldsLost: 35, hullLost: 0 }),
      at(130, { kind: 'own-damage', shieldsLost: 5, hullLost: 30 }),
    ], context)
    expect(recentCues(cues, 100, 25)).toEqual([])
    expect(recentCues(cues, 101, 25).map((cue) => cue.tick)).toEqual([101])
    expect(recentCues(cues, 130, 25).map((cue) => cue.tick)).toEqual([130])
    expect(recentCues(cues, 125, 25).map((cue) => cue.tick)).toEqual([101])
    expect(recentCues(cues, 160, 25)).toEqual([])
  })
})

describe('combat summary after a turn', () => {
  const assessment = (extra: Partial<OwnAssessment>): OwnAssessment => ({
    turnIndex: 1, revealTick: 200, startPosition: position, endPosition: position, destination: null, destinationReached: false,
    deltas: { energyMilli: 0, hull: 0, shields: 0, ammunition: 0 }, interruptions: [], sensorAttempt: { kind: 'not-requested' },
    weaponAttempt: { kind: 'not-requested' }, contacts: [], events: [], ordnancePending: null, ...extra,
  })

  it('separates own fire, damage taken and why a weapon did not fire', () => {
    const summary = combatSummary(assessment({
      deltas: { energyMilli: -18_000, hull: -30, shields: -5, ammunition: 0 },
      weaponAttempt: { kind: 'fired', tick: 101, weapon: 'laser' },
      events: [
        at(101, { kind: 'own-shot', position, weapon: { kind: 'laser', contactAlias: 'contact-1' } }),
        at(101, { kind: 'observed-impact', position, weapon: 'laser', contactAlias: 'contact-1' }, 1),
        at(117, { kind: 'own-damage', shieldsLost: 5, hullLost: 30 }),
      ],
    }), context)
    expect(summary.outgoing.map((cue) => cue.text)).toEqual(['Laser hit contact-1.'])
    expect(summary.incoming.map((cue) => cue.text)).toEqual(['Hit: −5 shields, −30 hull.'])
    expect(summary).toMatchObject({ shieldsLost: 5, hullLost: 30, unfired: null })
    expect(combatSummary(assessment({ weaponAttempt: { kind: 'unfired', weapon: 'laser', reasons: ['no-current-lock', 'out-of-range'] } }), context).unfired)
      .toBe('Laser did not fire: no current lock on the target; the target stayed out of range.')
  })
})
