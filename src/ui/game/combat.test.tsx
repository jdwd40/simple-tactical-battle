import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  DUEL_MAP, DUEL_RULES, type GameController, type GameView, type OwnAssessment, type PublicReplayFrame, type ReplayPrefix, type TurnOrders,
  type VisibleEvent,
} from '../../contracts'
import { buildScene, interpolateScene } from '../../rendering/plotScene'
import { current, frameAt, stale } from '../../rendering/testFrames'
import { assessmentLines } from './consoleText'
import { GameConsole } from './GameConsole'
import { readinessText, weaponProgressText } from './systemsText'
import { WeaponOrders, type WeaponOrdersProps } from './WeaponOrders'

vi.mock('pixi.js', () => ({ Application: class {}, Container: class {}, Graphics: class {}, Text: class {} }))

// Static public fixtures only: hand-written frames and views, no simulation.
const rules = DUEL_RULES
const position = { x: 3500, y: 10_500 }
const all = { laser: true, missile: true }
const orders = (extra: Partial<TurnOrders> = {}): TurnOrders => ({ turnIndex: 4, movement: { kind: 'hold' }, sensor: 'passive', cloak: false, weapon: { kind: 'hold' }, ...extra })
const event = (tick: number, body: Record<string, unknown>, index = 0) => ({ id: `t${tick}-00${index}`, tick, ...body }) as VisibleEvent
const withEvents = (frame: PublicReplayFrame, events: VisibleEvent[]): PublicReplayFrame => ({ ...frame, events, observation: { ...frame.observation, events } })
const radio = (html: string, value: string) => html.match(new RegExp(`<input[^>]*value="${value}"[^>]*>`))?.[0] ?? ''

const weaponOrders = (props: Partial<WeaponOrdersProps> = {}) => renderToStaticMarkup(
  <WeaponOrders
    orders={orders()} own={frameAt(400, position).observation.ownShip} contacts={[]} map={DUEL_MAP} tick={400} turnStartTick={400}
    ticksResolved={0} events={[]} rules={rules} issues={[]} capabilities={all} aiming={false} lockedReason={null}
    onWeapon={() => {}} onAimingChange={() => {}} {...props}
  />,
)

describe('WeaponOrders', () => {
  it('offers a laser only with a known contact and labels a stale target honestly', () => {
    expect(radio(weaponOrders(), 'laser')).toContain('disabled=""')
    expect(weaponOrders()).toContain('No known contact to aim a laser at.')
    const html = weaponOrders({
      orders: orders({ weapon: { kind: 'laser', contactAlias: 'contact-2' } }),
      contacts: [current('contact-1', { x: 8500, y: 10_500 }, 400), stale('contact-2', { x: 9500, y: 6500 }, 380, 20, 400)],
    })
    expect(radio(html, 'laser')).toContain('checked=""')
    expect(html).toContain('contact-1, current')
    expect(html).toContain('contact-2, last known 2.0 s ago: fires only if detected again')
    expect(radio(html, 'contact-2')).toContain('checked=""')
    for (const text of ['18.0 energy when it fires', '35, shields first', '6 cells, clear line of sight', 'A current lock at the firing tick', '5.0 s; ready']) expect(html).toContain(text)
  })

  it('aims a missile only at a chosen cell, with costs, ammunition and no homing', () => {
    const html = weaponOrders({ orders: orders({ weapon: { kind: 'missile', aim: { column: 12, row: 9 } } }) })
    expect(html).toContain('Aimed at column 12, row 9. It flies straight from where it launches and does not home.')
    for (const text of ['10.0 energy and 1 missile (6 left)', '45, blast radius 0.75 cell', '2.0 cells/s for 15.0 s, no homing', '10.0 s; ready']) expect(html).toContain(text)
    expect(html).toContain('>Aim on plot<')
    expect(html).toContain('Aim column')
  })

  it('says why weapons are unavailable and shows the engine weapon issues', () => {
    const own = { ...frameAt(400, position).observation.ownShip, ammunition: { current: 0, max: 6 } }
    expect(weaponOrders({ own })).toContain('No missiles left.')
    expect(weaponOrders({ capabilities: { laser: false, missile: false } })).toContain('Lasers are not available in this version yet.')
    const html = weaponOrders({
      orders: orders({ weapon: { kind: 'laser', contactAlias: 'contact-1' } }), contacts: [stale('contact-1', { x: 9500, y: 6500 }, 380, 20, 400)],
      issues: [
        { field: 'weapon', severity: 'conditional', code: 'awaiting-current-lock', details: { contactAlias: 'contact-1' } },
        { field: 'weapon', severity: 'conditional', code: 'awaiting-cooldown', details: { readyTick: 425 } },
      ],
    })
    expect(html).toContain('Fires only once contact-1 is detected again this turn.')
    expect(html).toContain('Fires once the weapon has cooled down, in 2.5 s.')
  })

  it('locks the committed intent and reports firing from the shown events only', () => {
    const committed = orders({ weapon: { kind: 'laser', contactAlias: 'contact-1' } })
    const own = frameAt(430, position).observation.ownShip
    const locked = weaponOrders({ orders: committed, own, contacts: [current('contact-1', { x: 8500, y: 10_500 }, 430)], tick: 430, ticksResolved: 30, lockedReason: 'Orders are locked while the turn plays.' })
    expect(locked.match(/<fieldset class="segmented" disabled=""/g)).toHaveLength(1)
    expect(locked).toContain('Waiting for the laser to become eligible')
    expect(weaponProgressText(committed, own, [event(412, { kind: 'own-shot', position, weapon: { kind: 'laser', contactAlias: 'contact-1' } })], 400, 30, rules)).toBe('Laser fired at 1.2 s.')
    expect(weaponProgressText(committed, { ...own, turnActions: { pulseAttemptSpent: false, weaponIntentSpent: true } }, [], 400, 0, rules)).toBe('The laser fires at its first eligible tick this turn.')
  })
})

describe('combat on the plot uses recorded public data only', () => {
  it('previews a laser line and range to the target alias, and a missile aim with its blast', () => {
    const frame = frameAt(400, position, [stale('contact-1', { x: 9500, y: 6500 }, 380, 20, 400)])
    const weaponRules = { laserRangeUnits: 6000, blastRadiusUnits: 750 }
    expect(buildScene({ frames: [frame], weapon: { kind: 'laser', contactAlias: 'contact-1' }, weaponRules }).weaponPlan)
      .toEqual({ kind: 'laser', alias: 'contact-1', target: { x: 9500, y: 6500 }, current: false, rangeUnits: 6000 })
    expect(buildScene({ frames: [frame], weapon: { kind: 'missile', aim: { column: 12, row: 9 } }, weaponRules }).weaponPlan)
      .toEqual({ kind: 'missile', aim: { column: 12, row: 9 }, blastRadiusUnits: 750 })
    expect(buildScene({ frames: [frame], weapon: { kind: 'hold' }, weaponRules }).weaponPlan).toBeNull()
  })

  it('marks fire, confirmed hits and own damage from their recorded tick for a set time, never before', () => {
    const shot = withEvents(frameAt(412, position, [current('contact-1', { x: 8500, y: 10_500 }, 412)]), [
      event(412, { kind: 'own-shot', position, weapon: { kind: 'laser', contactAlias: 'contact-1' } }),
      event(412, { kind: 'observed-shot', sourceAlias: 'contact-1', position: { x: 8500, y: 10_500 }, weapon: 'laser' }, 1),
      event(412, { kind: 'own-damage', shieldsLost: 35, hullLost: 0 }, 2),
      event(412, { kind: 'observed-impact', position: { x: 8500, y: 10_500 }, weapon: 'laser', contactAlias: 'contact-1' }, 3),
      event(412, { kind: 'observed-impact', position: { x: 12_500, y: 4500 }, weapon: 'missile' }, 4),
    ])
    const before = frameAt(411, position)
    const after = (count: number) => Array.from({ length: count }, (_, k) => frameAt(413 + k, position))
    const kinds = (frames: PublicReplayFrame[]) => buildScene({ frames, weaponRules: { laserRangeUnits: 6000, blastRadiusUnits: 750 } }).effects.map((effect) => effect.kind)
    expect(kinds([before])).toEqual([])
    const at = buildScene({ frames: [before, shot], weaponRules: { laserRangeUnits: 6000, blastRadiusUnits: 750 } }).effects
    expect(at.map((effect) => effect.kind)).toEqual(['beam', 'beam', 'own-hit', 'hit', 'impact'])
    expect(at[0]).toMatchObject({ from: position, to: { x: 8500, y: 10_500 }, own: true, ageTicks: 0 })
    expect(at[1]).toMatchObject({ from: { x: 8500, y: 10_500 }, to: position, own: false })
    expect(at[2]).toMatchObject({ shieldsLost: 35, hullLost: 0 })
    expect(at[3]).toMatchObject({ alias: 'contact-1', weapon: 'laser' })
    // An impact naming no contact stays an unconfirmed explosion with its blast radius.
    expect(at[4]).toMatchObject({ kind: 'impact', weapon: 'missile', radiusUnits: 750 })
    // Beams fade first; confirmed hits and own damage stay longer; all are gone after their time.
    expect(kinds([before, shot, ...after(12)])).toEqual(['own-hit', 'hit', 'impact'])
    expect(kinds([before, shot, ...after(25)])).toEqual(['own-hit', 'hit'])
    expect(kinds([before, shot, ...after(30)])).toEqual([])
  })

  it('names destructions and scans at their published ticks only', () => {
    const blast = withEvents(frameAt(500, position), [
      event(500, { kind: 'observed-destruction', contactAlias: 'contact-1', position: { x: 9500, y: 9500 } }),
      event(500, { kind: 'own-energy', deltaMilli: -12_000, reason: 'pulse' }, 1),
    ])
    const scene = buildScene({ frames: [frameAt(499, position), blast], sensors: DUEL_RULES.sensors })
    expect(scene.effects).toEqual([
      expect.objectContaining({ kind: 'destroyed', own: false, alias: 'contact-1', at: { x: 9500, y: 9500 } }),
      expect.objectContaining({ kind: 'scan', radiusUnits: 10_000 }),
    ])
    expect(buildScene({ frames: [frameAt(499, position)], sensors: DUEL_RULES.sensors }).effects).toEqual([])
  })

  it('draws own missiles from telemetry and hostile ordnance as sightings without aim, interpolating only known intervals', () => {
    const missileAt = (tick: number, x: number) => ({ id: 'own-1', position: { x, y: 10_500 }, aim: { column: 12, row: 10 }, launchTick: 401, updatedTick: tick, status: 'flying' as const })
    const hostile = (tick: number, x: number, kind: 'current' | 'stale') => kind === 'current'
      ? { alias: 'missile-1', kind, measurement: { position: { x, y: 6000 }, tick }, ageTicks: 0 as const, uncertaintyRadiusUnits: 0 as const }
      : { alias: 'missile-1', kind, measurement: { position: { x, y: 6000 }, tick: tick - 3 }, ageTicks: 3, uncertaintyRadiusUnits: 600 }
    const frame = (tick: number, x: number, kind: 'current' | 'stale', status: 'flying' | 'detonated' = 'flying') => {
      const base = frameAt(tick, position)
      return { ...base, observation: { ...base.observation, ownMissiles: [{ ...missileAt(tick, x), status }], hostileMissiles: [hostile(tick, 12_000 - x, kind)] } }
    }
    const a = buildScene({ frames: [frame(410, 5000, 'current')] })
    const b = buildScene({ frames: [frame(411, 5200, 'current')] })
    expect(a.ownMissiles).toEqual([{ id: 'own-1', position: { x: 5000, y: 10_500 }, aim: { column: 12, row: 10 }, updatedTick: 410, trail: [] }])
    // Trails use only this side's recorded positions: telemetry for own missiles, consecutive sightings for hostile ones.
    const pair = buildScene({ frames: [frame(410, 5000, 'current'), frame(411, 5200, 'current')] })
    expect(pair.ownMissiles[0].trail).toEqual([{ x: 5000, y: 10_500 }])
    expect(pair.hostileMissiles[0].trail).toEqual([{ x: 7000, y: 6000 }])
    expect(buildScene({ frames: [frame(410, 5000, 'current'), frame(411, 5200, 'stale')] }).hostileMissiles[0].trail).toEqual([])
    expect(JSON.stringify(a.hostileMissiles)).not.toContain('aim')
    const mid = interpolateScene(a, b, 0.5)
    expect(mid.ownMissiles[0].position).toEqual({ x: 5100, y: 10_500 })
    expect(mid.hostileMissiles[0].position).toEqual({ x: 6900, y: 6000 })
    const lost = buildScene({ frames: [frame(411, 5200, 'stale')] })
    expect(interpolateScene(a, lost, 0.5).hostileMissiles[0]).toEqual(lost.hostileMissiles[0])
    expect(buildScene({ frames: [frame(412, 5400, 'stale', 'detonated')] }).ownMissiles).toEqual([])
  })
})

describe('assessment and endings', () => {
  const context = { rules, map: DUEL_MAP }
  const assessment = (extra: Partial<OwnAssessment>): OwnAssessment => ({
    turnIndex: 4, revealTick: 500, startPosition: position, endPosition: position, destination: null, destinationReached: false,
    deltas: { energyMilli: 0, hull: 0, shields: -35, ammunition: 0 }, interruptions: [], sensorAttempt: { kind: 'not-requested' },
    weaponAttempt: { kind: 'not-requested' }, contacts: [], events: [], ordnancePending: null, ...extra,
  })

  it('explains fired, unfired and pending ordnance from the own assessment only', () => {
    expect(assessmentLines(assessment({ weaponAttempt: { kind: 'fired', tick: 412, weapon: 'laser' } }), context, 400)).toContain('Laser fired at 1.2 s.')
    expect(assessmentLines(assessment({ weaponAttempt: { kind: 'unfired', weapon: 'laser', reasons: ['no-current-lock', 'out-of-range'] } }), context, 400))
      .toContain('Laser did not fire: the target was never detected as current; the target stayed out of range. The intent does not carry into the next turn.')
    expect(assessmentLines(assessment({ ordnancePending: { reason: 'known-own-missiles', missileIds: ['own-1'] } }), context, 400)).toContain('Your missile is still flying, so the encounter continues.')
    expect(assessmentLines(assessment({ ordnancePending: { reason: 'observed-opponent-destroyed' } }), context, 400))
      .toContain('You saw the patrol frigate destroyed, but ordnance is still active: weapons now hold fire.')
  })

  function render(view: GameView) {
    const controller: GameController = {
      getView: () => view, subscribe: () => () => {}, setDraft: () => {}, commit: () => ({ kind: 'ignored', reason: 'wrong-phase' }),
      playback: () => {}, finishAssessment: () => {}, abandon: () => {}, restart: () => {},
    }
    return renderToStaticMarkup(<GameConsole controller={controller} capabilities={{ activePulse: true, ...all }} opponentNote="The patrol is an interim script: it follows a set route and does not fire." />)
  }
  const replay = (frames: PublicReplayFrame[], cursorTick: number): ReplayPrefix => ({
    scope: 'latest-player-turn-with-aftermath', startTick: 400, endTick: 500, cursorTick, frames, events: frames.flatMap((frame) => frame.events), playback: { playing: false, speed: 1 },
  })

  it('shows a revealed outcome with its assessment, replay and restart, and no orders', () => {
    const end = frameAt(500, position)
    const html = render({
      encounterId: 'encounter-1', revision: 9, rules, phase: 'terminal', frame: end, lockedOwnOrders: orders(), replay: replay([frameAt(400, position), end], 500),
      result: { kind: 'combat', outcome: { outcome: 'victory', revealTick: 500 }, assessment: assessment({ weaponAttempt: { kind: 'fired', tick: 412, weapon: 'laser' } }) },
    })
    expect(html).toContain('data-testid="outcome">Victory</p>')
    expect(html).toContain('The patrol frigate is destroyed and Shadow-Dancer survives.')
    expect(html).toContain('<span class="combat-summary-time">1.2 s</span><span>Laser fired.</span>')
    expect(html).toContain('Damage taken: 35 shields, 0 hull')
    expect(html).not.toContain('Nothing hit you.')
    for (const name of ['Restart encounter', 'New encounter', 'Replay final turn']) expect(html).toContain(`>${name}</button>`)
    expect(html).not.toContain('Commit turn')
    expect(html).not.toMatch(/drill/i)
  })

  it('explains automatic aftermath after own destruction, without orders or commit', () => {
    const frame = frameAt(560, position, [], { status: 'destroyed' })
    const html = render({
      encounterId: 'encounter-1', revision: 12, rules, phase: 'execution', frame, replay: { ...replay([frameAt(400, position), frame], 560), endTick: 600 },
      replayOf: null, automatic: true, reason: 'own-destroyed', lockedOwnOrders: null,
    })
    expect(html).toContain('Shadow-Dancer destroyed')
    expect(html).toContain('Remaining ordnance plays out in automatic turns while the patrol plans from its own observation.')
    expect(html).not.toContain('Commit turn')
    expect(html).not.toMatch(/<h2[^>]*>Orders<\/h2>/)
    expect(readinessText(520, 500, rules)).toBe('Cooling, 2.0 s')
  })
})
