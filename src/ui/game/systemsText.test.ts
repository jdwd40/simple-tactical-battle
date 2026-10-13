import { describe, expect, it } from 'vitest'
import { DUEL_MAP, DUEL_RULES, SAMPLE_PLAYER_OBSERVATION, type OwnAssessment, type OwnShipObservation, type TurnOrders, type VisibleEvent } from '../../contracts'
import { assessmentLines, eventText } from './consoleText'
import {
  cloakEffects, cloakNowText, cloakRequestHint, cloakShortText, energyPlan, exposureStatusText, pulseProgressText,
  sensorEffects, sensorStatusText,
} from './systemsText'

const rules = DUEL_RULES
const own = (extra: Partial<OwnShipObservation> = {}): OwnShipObservation => ({ ...SAMPLE_PLAYER_OBSERVATION.ownShip, ...extra })
const clocks = (trackingUntilTick: number, exposureUntilTick: number) => ({ laserReadyTick: 0, missileReadyTick: 0, trackingUntilTick, exposureUntilTick })
const draft = (extra: Partial<TurnOrders> = {}): TurnOrders => ({ turnIndex: 0, movement: { kind: 'hold' }, sensor: 'passive', cloak: true, weapon: { kind: 'hold' }, ...extra })

describe('own sensor, cloak and exposure status', () => {
  it('distinguishes the requested cloak from its actual state', () => {
    expect(cloakShortText({ requested: true, actual: true, state: 'active' })).toBe('On')
    expect(cloakShortText({ requested: false, actual: false, state: 'off' })).toBe('Off')
    expect(cloakShortText({ requested: true, actual: false, state: 'suppressed-exposure' })).toBe('Off, requested: exposed')
    expect(cloakShortText({ requested: true, actual: false, state: 'latched-activity' })).toBe('Off, requested: broken')
    expect(cloakShortText({ requested: true, actual: false, state: 'latched-unfunded' })).toBe('Off, requested: no energy')
  })

  it('explains why a requested cloak is off, with the exposure time left', () => {
    const exposed = own({ cloak: { requested: true, actual: false, state: 'suppressed-exposure' }, clocks: clocks(0, 130) })
    expect(cloakNowText(exposed, 112, rules)).toBe('Cloak requested but held off while your ship is exposed (1.8 s left).')
    expect(cloakNowText(own({ cloak: { requested: true, actual: false, state: 'latched-activity' } }), 50, rules)).toBe('Cloak requested but broken by your scan or shot; it stays off this turn.')
    expect(cloakNowText(own({ cloak: { requested: true, actual: false, state: 'latched-unfunded' } }), 50, rules)).toBe('Cloak requested but upkeep ran out of energy; it stays off this turn.')
  })

  it('asks for a fresh cloak request only after a latch left the carried draft off', () => {
    expect(cloakRequestHint(own({ cloak: { requested: true, actual: false, state: 'latched-unfunded' } }), false)).toBe('Last turn cloak upkeep ran out of energy. Select On to request it again.')
    expect(cloakRequestHint(own({ cloak: { requested: true, actual: false, state: 'latched-activity' } }), false)).toMatch(/scan or shot broke cloak/)
    expect(cloakRequestHint(own({ cloak: { requested: true, actual: false, state: 'latched-activity' } }), true)).toBeNull()
    expect(cloakRequestHint(own({ cloak: { requested: false, actual: false, state: 'off' } }), false)).toBeNull()
  })

  it('reports tracking and exposure time left from absolute clocks', () => {
    const ship = own({ sensor: 'tracking', clocks: clocks(21, 31) })
    expect(sensorStatusText(ship, 7, rules)).toBe('Tracking, 1.4 s left')
    expect(exposureStatusText(ship, 7, rules)).toBe('Exposed, 2.4 s left')
    expect(exposureStatusText(ship, 31, rules)).toBe('Not exposed')
    expect(sensorStatusText(own(), 7, rules)).toBe('Passive')
  })

  it('never reads the previous turn\'s pulse flags before a tick of this turn has resolved', () => {
    const stalePrior = own({ turnActions: { pulseAttemptSpent: true, weaponIntentSpent: false } })
    expect(pulseProgressText(stalePrior, 100, 0, rules)).toBe('Pulse fires on the first tick of the turn.')
    const tracking = own({ sensor: 'tracking', clocks: clocks(121, 131), turnActions: { pulseAttemptSpent: true, weaponIntentSpent: false } })
    expect(pulseProgressText(tracking, 105, 5, rules)).toBe('Pulse succeeded: tracking for 1.6 s more.')
    expect(pulseProgressText({ ...tracking, sensor: 'passive' }, 150, 50, rules)).toBe('Pulse succeeded; tracking has ended.')
    const failed = own({ interruptions: [{ tick: 101, reason: 'pulse-unfunded' }], turnActions: { pulseAttemptSpent: true, weaponIntentSpent: false } })
    expect(pulseProgressText(failed, 140, 40, rules)).toBe('Pulse failed: not enough energy. No scan and no exposure.')
  })
})

describe('order consequences from public rules', () => {
  it('states pulse cost, tracking, exposure and failure before commit', () => {
    expect(sensorEffects('activePulse', rules)).toEqual([
      { label: 'Cost', value: '12.0 energy, first tick only' },
      { label: 'Tracking', value: '2.0 s at 10 cells, 7 if cloaked' },
      { label: 'Exposes you', value: '3.0 s, seen within 12 cells' },
      { label: 'Unfunded', value: 'Fails once; no exposure' },
    ])
    expect(sensorEffects('passive', rules)).toEqual([
      { label: 'Cost', value: 'None' },
      { label: 'Detects', value: '7 cells, 3 if cloaked, +1 if moving' },
    ])
  })

  it('states cloak upkeep and how close the patrol must be', () => {
    expect(cloakEffects(true, own(), rules)).toEqual([
      { label: 'Upkeep', value: '3.0 per s, 30.0 a turn' },
      { label: 'Detectable', value: '3 cells passive, 7 by a pulse' },
    ])
    expect(cloakEffects(false, own(), rules)).toEqual([{ label: 'Detectable', value: '7 cells passive, 10 by a pulse' }])
  })

  it('budgets the largest upkeep and warns when it outruns energy plus recharge', () => {
    const full = energyPlan(draft({ sensor: 'activePulse' }), own(), true, rules)
    expect(full).toMatchObject({ currentMilli: 100_000, rechargeMilli: 20_000, upkeepMilli: 52_000, parts: ['cloak 30.0', 'pulse 12.0', 'propulsion 10.0'], mayRunShort: false })
    // Seed 17's eighth turn: 6.8 energy cannot carry a full turn of cloak upkeep.
    expect(energyPlan(draft(), own({ energy: { currentMilli: 6800, maxMilli: 100_000 } }), false, rules).mayRunShort).toBe(true)
    expect(energyPlan(draft({ cloak: false }), own(), false, rules)).toMatchObject({ upkeepMilli: 0, parts: [], mayRunShort: false })
  })
})

describe('log and assessment wording', () => {
  const context = { rules, map: DUEL_MAP }
  const at = (tick: number, body: Record<string, unknown>) => ({ id: `t${tick}-000`, tick, ...body }) as VisibleEvent

  it('explains own cloak changes, pulse costs and failures from their events', () => {
    expect(eventText(at(1, { kind: 'own-cloak', cloak: { requested: true, actual: false, state: 'latched-activity' } }), context)).toBe('Cloak broken by your scan or shot; it stays off until you request it again.')
    expect(eventText(at(1, { kind: 'own-cloak', cloak: { requested: true, actual: false, state: 'latched-unfunded' } }), context)).toBe('Cloak upkeep ran out of energy; it stays off until you request it again.')
    expect(eventText(at(1, { kind: 'own-energy', deltaMilli: -12_000, reason: 'pulse' }), context)).toBe('Energy −12.0 (active pulse).')
    expect(eventText(at(1, { kind: 'own-interruption', reason: 'pulse-unfunded' }), context)).toBe('Active pulse failed: not enough energy, so no scan and no exposure.')
    expect(eventText(at(760, { kind: 'contact-expired', alias: 'contact-1' }), context)).toBe('Memory of contact-1 expired after 60 s unseen.')
  })

  const assessment = (extra: Partial<OwnAssessment>): OwnAssessment => ({
    turnIndex: 7, revealTick: 800, startPosition: { x: 2500, y: 18_500 }, endPosition: { x: 2500, y: 18_500 },
    destination: null, destinationReached: false, deltas: { energyMilli: -6400, hull: 0, shields: 0, ammunition: 0 },
    interruptions: [], sensorAttempt: { kind: 'not-requested' }, weaponAttempt: { kind: 'not-requested' },
    contacts: [], events: [], ordnancePending: null, ...extra,
  })

  it('explains a failed or successful pulse and a cloak broken by activity', () => {
    expect(assessmentLines(assessment({ sensorAttempt: { kind: 'failed', reason: 'insufficient-energy' } }), context))
      .toContain('Active pulse failed on the first tick for lack of energy. It did not retry and did not expose you.')
    const scanned = assessmentLines(assessment({
      sensorAttempt: { kind: 'succeeded' },
      events: [at(701, { kind: 'own-cloak', cloak: { requested: true, actual: false, state: 'latched-activity' } })],
    }), context)
    expect(scanned).toContain('Active pulse succeeded: tracking for 2.0 s, and your ship was exposed for 3.0 s.')
    expect(scanned).toContain('Your scan or shot broke cloak for the rest of the turn. Request it again when planning.')
    expect(assessmentLines(assessment({}), context).some((line) => /pulse/i.test(line))).toBe(false)
  })

  it('explains unfunded cloak and contact changes at their turn times', () => {
    const lines = assessmentLines(assessment({
      interruptions: [{ tick: 799, reason: 'cloak-unfunded' }],
      events: [
        at(760, { kind: 'contact-expired', alias: 'contact-1' }),
        at(799, { kind: 'own-interruption', reason: 'cloak-unfunded' }),
        at(799, { kind: 'own-cloak', cloak: { requested: true, actual: false, state: 'latched-unfunded' } }),
      ],
    }), context, 700)
    expect(lines).toContain('Cloak failed: not enough energy (1 time).')
    expect(lines).toContain('Cloak stays off until you request it again when planning.')
    expect(lines).toContain('Memory of contact-1 expired at 6.0 s.')
    expect(lines.at(-1)).toBe('No contacts known at the end of the turn.')
  })
})
