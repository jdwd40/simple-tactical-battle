import { describe, expect, it } from 'vitest'
import type { TurnOrders } from '../../contracts'
import { DUEL_SCENARIO } from '../../scenarios/private'
import { resolveTurn, validateOrders } from '../../simulation'
import { clampToMap } from '../../ai/navigation'
import { runEncounter } from '../../../tools/batch/encounter'
import { cellOf, damageTo, freshest, missileEnds, range, replaySteps, rules, view } from './balanceSupport'

/**
 * Exact reproductions of the reviewed TSB-52A diagnostics (`npm run batch -- --seeds 1,2,3,4,5`, normal-turn
 * limit 200) with the accepted batch tool and its observation-only diagnostic players. Recorded at base
 * 4ffd1a2 in /tmp/tsb-52a-a1/twenty; the corrected planner was re-run in /tmp/tsb-51-a1/after.
 */
const encounter = (seed: number, policy: 'concealed-search' | 'pursuit-laser' | 'scan-search') =>
  runEncounter({ seed, policy, normalTurnLimit: 200, sourceRevision: 'tsb-51-balance' })

describe('concealed-search seed 5: eight frigate laser intents, four shots (unchanged by TSB-51)', () => {
  const run = encounter(5, 'concealed-search')
  const turns = replaySteps(run)
  const patrolAttempts = turns.map((turn) => turn.presentations.patrol.assessment.weaponAttempt)

  it('reproduces the recorded run exactly', () => {
    expect(run.metrics).toMatchObject({ outcome: 'defeat', normalTurns: 10, intents: { patrol: { lasers: 8, missiles: 0 } }, fired: { patrol: { lasers: 4, missiles: 0 } } })
    expect(run.metrics.finalStateHash).toBe('5606017a94a9bff30a88b695a9b3e5d645e1313dc7efedbffa90ff4e9d6be215')
  })

  it('fires on a current lock; a conditional laser on the stale alias waits, unspent and free, until reacquisition', () => {
    expect(patrolAttempts.map((attempt) => attempt.kind === 'fired' ? attempt.tick : attempt.kind === 'unfired' ? attempt.reasons.join('+') : '-'))
      .toEqual(['-', '-', 201, 301, 'no-current-lock', 'no-current-lock', 'no-current-lock', 'no-current-lock', 814, 901])
    // Turns 4–7: the player was behind the (12–13, 13–14) rock or cloaked while the frigate investigated/searched south.
    expect(run.steps.slice(4, 8).map((step) => step.plannerMemory.patrol.policy)).toEqual(['INVESTIGATE', 'SEARCH', 'SEARCH', 'SEARCH'])
    for (const turn of turns.slice(4, 8)) expect(turn.internalEvents.some((event) => event.kind === 'resource' && event.reason === 'laser')).toBe(false)
    // Turn 8: its first-tick pulse reacquires the cloaked player and the waiting intent fires at once.
    expect(run.steps[8].locked.orders.patrol?.sensor).toBe('activePulse')
    expect(damageTo(turns[8], 'player')).toEqual([{ tick: 814, amount: rules.laser.damage, sources: ['patrol-ship'] }])
  })

  it('why not a missile instead: the same turn-8 knowledge, plotted as the planner would, misses where the laser hit', () => {
    const before = { ...turns[7].nextState, plannerMemory: run.steps[8].plannerMemory, random: { ...turns[7].nextState.random, planners: run.steps[8].plannerRandom } }
    const patrolView = view(before, 'patrol')
    const contact = freshest(patrolView)
    if (contact === undefined) throw new Error('stale contact expected')
    expect(contact).toMatchObject({ kind: 'stale', ageTicks: 470, estimatedVelocity: { xUnitsPerTick: 0, yUnitsPerTick: 100 } })
    // Measured position + velocity × (age + flight), within the uncertainty radius and the map.
    const at = contact.measurement.position
    const ahead = contact.ageTicks + Math.ceil(range(patrolView.ownShip.position, at) / rules.missile.speedUnitsPerTick) + 1
    const velocity = contact.estimatedVelocity ?? { xUnitsPerTick: 0, yUnitsPerTick: 0 }
    const lead = { x: velocity.xUnitsPerTick * ahead, y: velocity.yUnitsPerTick * ahead }
    const scale = Math.min(1, contact.uncertaintyRadiusUnits / Math.hypot(lead.x, lead.y))
    const aim = cellOf(clampToMap({ x: at.x + lead.x * scale, y: at.y + lead.y * scale }, patrolView.map, rules))
    expect(aim).toEqual({ column: 10, row: 19 })
    const locked = run.steps[8].locked
    const missile: TurnOrders = { ...(locked.orders.patrol as TurnOrders), weapon: { kind: 'missile', aim } }
    expect(validateOrders(missile, patrolView, rules).structurallyValid).toBe(true)
    const counterfactual = resolveTurn(before, { ...locked, orders: { ...locked.orders, patrol: missile } }, rules, DUEL_SCENARIO)
    expect(damageTo(counterfactual, 'player')).toEqual([])
    expect(missileEnds(counterfactual)).toEqual([{ tick: 832, reason: 'arrival', cell: { column: 10, row: 19 } }])
  })
})

describe('TSB-51 D1, pursuit-laser seed 1: a weak frigate that cannot cloak returns fire while withdrawing', () => {
  const run = encounter(1, 'pursuit-laser')
  const turns = replaySteps(run)

  it('turn 5: hull 20 and a current contact one cell away; it lasers on the way out (the recorded run held fire and lost)', () => {
    const patrolView = view({ ...turns[4].nextState }, 'patrol')
    expect(patrolView.ownShip.hull.current).toBe(20)
    const contact = freshest(patrolView)
    expect(contact?.kind).toBe('current')
    expect(range(contact?.measurement.position ?? { x: 0, y: 0 }, patrolView.ownShip.position)).toBe(rules.geometry.unitsPerCell)
    // Base 4ffd1a2 locked { destination (8,10), weapon hold } here and the player's t501 shot ended in victory.
    expect(run.steps[5].locked.orders.patrol).toMatchObject({ movement: { kind: 'destination', cell: { column: 8, row: 10 } }, weapon: { kind: 'laser', contactAlias: contact?.alias } })
    expect(damageTo(turns[5], 'player')).toEqual([{ tick: 501, amount: rules.laser.damage, sources: ['patrol-ship'] }])
    expect(run.metrics).toMatchObject({ outcome: 'mutual-destruction', normalTurns: 6, fired: { patrol: { lasers: 4 } } })
  })
})

describe('TSB-51 D2, scan-search seed 1: a newer sighting of a stale contact restarts the investigation', () => {
  const run = encounter(1, 'scan-search')
  const turns = replaySteps(run)

  it('turn 5: heads for the newer measurement, not the outdated (10,19) route, and reacquires', () => {
    expect(run.steps[4].plannerMemory.patrol).toMatchObject({ policy: 'INVESTIGATE', searchDestination: { column: 10, row: 19 } })
    const contact = freshest(view(turns[4].nextState, 'patrol'))
    expect(contact).toMatchObject({ kind: 'stale', measurement: { position: { x: 8500, y: 10_500 } } })
    expect(contact?.measurement.tick).toBeGreaterThan(run.steps[4].plannerMemory.patrol.rememberedContacts[0].measurement.tick)
    // Base 4ffd1a2 kept (10,19) here, reached the map edge, then searched; the player sat at (8.5,10.5).
    expect(run.steps[5].plannerMemory.patrol).toMatchObject({ policy: 'INVESTIGATE', searchDestination: { column: 8, row: 10 } })
    expect(damageTo(turns[5], 'player')).toEqual([{ tick: 572, amount: rules.laser.damage, sources: ['patrol-ship'] }])
    expect(run.metrics).toMatchObject({ outcome: 'defeat', normalTurns: 6 })
  })
})
