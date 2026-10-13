import { describe, expect, it } from 'vitest'
import type { TurnResolution } from '../../contracts/private'
import type { Cell, SideObservation, TurnOrders } from '../../contracts'
import { cellOf, damageTo, freshest, missileEnds, orders, planTurn, playTurn, plottedAim, range, resolve, rules, shotsBy, start, view } from './balanceSupport'

/**
 * TSB-51 paired examples on seed 1 against the real frigate AI (no scripted opponent). The player orders
 * are legal and observation-only. The frigate's seeded patrol runs (16,10) → (16,16) → (16,3): during turn 1
 * it heads north along column 16, which passes 7 cells east of the ambush cell (9,10). Every pair branches
 * alternative player orders from one planned state, so both branches face the same locked frigate plan.
 */
const AMBUSH: Cell = { column: 9, row: 10 }
const cloakedTo = (cell: Cell) => (own: SideObservation) => orders(own, { movement: { kind: 'destination', cell }, cloak: true })
const opening = playTurn(start(1), cloakedTo(AMBUSH))
// Turn 1 at the ambush cell: wait concealed, or pulse (which latches the cloak off and exposes the scanner).
const waited = playTurn(opening.nextState, (own) => orders(own, { cloak: true }))
const scanned = playTurn(opening.nextState, (own) => orders(own, { cloak: true, sensor: 'activePulse' }))
const quiet = planTurn(waited.nextState)
const alerted = planTurn(scanned.nextState)
const missileAt = (planned: typeof quiet, lead: boolean, movement: TurnOrders['movement'] = { kind: 'hold' }) => {
  const own = view(planned.state, 'player')
  const contact = freshest(own)
  if (contact === undefined) throw new Error('No contact to aim at')
  return { aim: plottedAim(own, contact, lead), result: resolve(planned, orders(own, { movement, weapon: { kind: 'missile', aim: plottedAim(own, contact, lead) } })) }
}
const laserAt = (planned: typeof quiet): TurnResolution => {
  const own = view(planned.state, 'player')
  return resolve(planned, orders(own, { cloak: true, weapon: { kind: 'laser', contactAlias: freshest(own)?.alias ?? 'none' } }))
}

describe('concealment versus scanning (seed 1, turn 1)', () => {
  it('a pulse finds the frigate beyond passive range, but exposes the scanner and alerts the frigate', () => {
    const tracked = (result: TurnResolution) => result.presentations.player.frames.filter((frame) => frame.observation.contacts.some((c) => c.kind === 'current'))
    const firstRange = (result: TurnResolution) => {
      const frame = tracked(result)[0]
      return { tick: frame.tick, cells: range(frame.observation.contacts[0].measurement.position, frame.observation.ownShip.position) / rules.geometry.unitsPerCell }
    }
    // Concealed and passive: the frigate is tracked only once it closes inside the 8-cell moving-signature range,
    // and the frigate, unable to see a still cloaked ship beyond 3 cells, learns nothing.
    expect(firstRange(waited).tick).toBe(127)
    expect(firstRange(waited).cells).toBeLessThanOrEqual(8)
    expect(waited.nextState.ships.player.cloakActive).toBe(true)
    expect(quiet.patrolView?.contacts).toEqual([])
    expect(quiet.state.plannerMemory.patrol.policy).toBe('PATROL')
    expect(quiet.patrol?.weapon).toEqual({ kind: 'hold' })
    // Pulse: tracked at active range once the (12,13) asteroid stops blocking the sightline, 14 ticks earlier and
    // beyond the 8-cell passive range of a moving uncloaked ship.
    expect(firstRange(scanned).tick).toBe(113)
    expect(firstRange(scanned).cells).toBeGreaterThan(8)
    // ...but the scan breaks cloak for the turn and the frigate acquires the scanner: it turns to investigate with a laser ready.
    expect(scanned.nextState.ships.player.cloakActive).toBe(false)
    expect(alerted.patrolView?.contacts.map((c) => c.kind)).toEqual(['stale'])
    expect(alerted.state.plannerMemory.patrol.policy).toBe('INVESTIGATE')
    expect(alerted.patrol).toMatchObject({ movement: { kind: 'destination', cell: AMBUSH }, weapon: { kind: 'laser' } })
  })
})

describe('prediction and weapon choice against the patrolling frigate (seed 1, turn 2)', () => {
  const own = view(quiet.state, 'player')
  const contact = freshest(own)

  it('observes legal motion: a current contact 7.3 cells away moving north at 80 units per tick', () => {
    expect(contact).toMatchObject({ kind: 'current', measurement: { position: { x: 16_500, y: 8500 } }, estimatedVelocity: { xUnitsPerTick: 0, yUnitsPerTick: -80 } })
    expect(range(own.ownShip.position, contact?.measurement.position ?? own.ownShip.position)).toBeGreaterThan(rules.laser.rangeUnits)
  })

  it('a velocity-led missile hits a frigate holding course; the same shot at the measured cell misses', () => {
    const led = missileAt(quiet, true)
    expect(led.aim).toEqual({ column: 16, row: 5 })
    expect(damageTo(led.result, 'patrol')).toEqual([{ tick: 245, amount: rules.missile.damage, sources: ['player-missile-1'] }])
    // The unalerted frigate had no contact at planning, so it cannot answer this turn.
    expect(damageTo(led.result, 'player')).toEqual([])
    const measured = missileAt(quiet, false)
    expect(measured.aim).toEqual({ column: 16, row: 8 })
    expect(missileEnds(measured.result)).toEqual([{ tick: 238, reason: 'arrival', cell: { column: 16, row: 8 } }])
    expect(damageTo(measured.result, 'patrol')).toEqual([])
  })

  it('a laser cannot reach the same retreating target: the intent waits, out of range and then out of sight', () => {
    const result = laserAt(quiet)
    expect(shotsBy(result, 'player')).toEqual([])
    expect(result.presentations.player.assessment.weaponAttempt).toEqual({ kind: 'unfired', weapon: 'laser', reasons: ['no-current-lock', 'out-of-range'] })
    // An unfired intent costs nothing and keeps the cloak.
    expect(result.internalEvents.some((event) => event.kind === 'resource' && event.reason === 'laser')).toBe(false)
    expect(result.nextState.ships.player.cloakActive).toBe(true)
  })

  it('an alerted frigate changes course: the identical led missile misses, while a laser trades hits in range', () => {
    expect(missileAt(alerted, true).aim).toEqual({ column: 16, row: 5 })
    const led = missileAt(alerted, true).result
    expect(damageTo(led, 'patrol')).toEqual([])
    expect(missileEnds(led)).toEqual([{ tick: 245, reason: 'arrival', cell: { column: 16, row: 5 } }])
    expect(damageTo(led, 'player')).toEqual([{ tick: 219, amount: rules.laser.damage, sources: ['patrol-ship'] }])
    // A laser needs no prediction: it fires once the closing frigate is in range; the frigate retaliates a tick later.
    const lasers = laserAt(alerted)
    expect(damageTo(lasers, 'patrol')).toEqual([{ tick: 219, amount: rules.laser.damage, sources: ['player-ship'] }])
    expect(damageTo(lasers, 'player')).toEqual([{ tick: 220, amount: rules.laser.damage, sources: ['patrol-ship'] }])
  })
})

describe("the frigate's own predictive missile and evading it (seed 1, turns 2–3)", () => {
  // The ambush missile again, this time withdrawing east to the map edge while it flies.
  const ambush = missileAt(quiet, true, { kind: 'destination', cell: { column: 19, row: 10 } }).result
  const counter = planTurn(ambush.nextState)

  it('plots a velocity-led missile at a current contact beyond laser range', () => {
    expect(damageTo(ambush, 'patrol').map((hit) => hit.amount)).toEqual([rules.missile.damage])
    const sighting = counter.patrolView?.contacts[0]
    expect(sighting).toMatchObject({ kind: 'current', estimatedVelocity: { xUnitsPerTick: 100, yUnitsPerTick: 0 } })
    expect(range(sighting?.measurement.position ?? { x: 0, y: 0 }, counter.patrolView?.ownShip.position ?? { x: 0, y: 0 })).toBeGreaterThan(rules.laser.rangeUnits + rules.geometry.unitsPerCell)
    expect(counter.state.plannerMemory.patrol.policy).toBe('ENGAGE')
    expect(counter.patrol?.weapon).toEqual({ kind: 'missile', aim: { column: 19, row: 10 } })
  })

  it('staying where the prediction points is hit; turning away at the turn boundary evades it', () => {
    const stay = resolve(counter, orders(view(counter.state, 'player')))
    expect(damageTo(stay, 'player')).toEqual([{ tick: 337, amount: rules.missile.damage, sources: ['patrol-missile-1'] }])
    const turn = resolve(counter, orders(view(counter.state, 'player'), { movement: { kind: 'destination', cell: { column: 19, row: 16 } } }))
    expect(damageTo(turn, 'player')).toEqual([])
    expect(missileEnds(turn)).toEqual([{ tick: 339, reason: 'arrival', cell: { column: 19, row: 10 } }])
    expect(cellOf(turn.nextState.ships.player.position)).toEqual({ column: 19, row: 16 })
  })
})
