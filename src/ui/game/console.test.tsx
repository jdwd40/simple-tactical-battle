import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DUEL_RULES, type GameController, type GameView, type OwnShipObservation, type ReplayPrefix, type TurnOrders, type ValidationIssue } from '../../contracts'
import { current, frameAt, stale } from '../../rendering/testFrames'
import { GameConsole } from './GameConsole'
import { SystemOrders, type SystemOrdersProps } from './SystemOrders'

// GameConsole mounts the Pixi plot only in effects; server rendering never creates it.
vi.mock('pixi.js', () => ({ Application: class {}, Container: class {}, Graphics: class {}, Text: class {} }))

const rules = DUEL_RULES
const position = { x: 3500, y: 10_500 }
const orders = (extra: Partial<TurnOrders> = {}): TurnOrders => ({ turnIndex: 2, movement: { kind: 'hold' }, sensor: 'passive', cloak: true, weapon: { kind: 'hold' }, ...extra })
const clocks = (trackingUntilTick: number, exposureUntilTick: number) => ({ laserReadyTick: 0, missileReadyTick: 0, trackingUntilTick, exposureUntilTick })

/** Static public views only: commands are recorded, nothing is simulated. */
function fixtureController(view: GameView) {
  const commands: unknown[] = []
  const controller: GameController = {
    getView: () => view,
    subscribe: () => () => {},
    setDraft: (draft) => { commands.push(['setDraft', draft]) },
    commit: () => ({ kind: 'ignored', reason: 'wrong-phase' }),
    playback: (command) => { commands.push(['playback', command]) },
    finishAssessment: () => {},
    abandon: () => {},
    restart: () => {},
  }
  return { controller, commands }
}

const base = { encounterId: 'encounter-1', revision: 4, rules }
function planning(own: Partial<OwnShipObservation> = {}, draft = orders(), issues: ValidationIssue[] = []): GameView {
  return {
    ...base, phase: 'planning', frame: frameAt(200, position, [stale('contact-1', { x: 9500, y: 9500 }, 161, 39, 1170)], own), draft,
    validation: { structurallyValid: true, issues }, routePreview: { kind: 'hold', position }, replay: null,
  }
}

const render = (view: GameView, activePulse = true) => renderToStaticMarkup(<GameConsole controller={fixtureController(view).controller} capabilities={{ activePulse, laser: false, missile: false }} />)
const systems = (props: Partial<SystemOrdersProps> = {}) => renderToStaticMarkup(
  <SystemOrders
    orders={orders()} own={frameAt(200, position).observation.ownShip} tick={200} ticksResolved={0} rules={rules}
    issues={[]} pulseUnavailableReason={null} moving={false} lockedReason={null} onChange={() => {}} {...props}
  />,
)
const radio = (html: string, value: string) => html.match(new RegExp(`<input[^>]*value="${value}"[^>]*>`))?.[0] ?? ''

describe('SystemOrders', () => {
  it('offers passive and pulse, with pulse cost, tracking, exposure and failure before commit', () => {
    const html = systems({ orders: orders({ sensor: 'activePulse' }) })
    expect(radio(html, 'activePulse')).toContain('checked=""')
    expect(radio(html, 'activePulse')).not.toContain('disabled')
    for (const text of ['12.0 energy, first tick only', '2.0 s at 10 cells, 7 if cloaked', '3.0 s, seen within 12 cells', 'Fails once; no exposure']) expect(html).toContain(text)
    expect(html).toContain('Up to 42.0')
    expect(html).toContain('Upkeep: cloak 30.0, pulse 12.0.')
  })

  it('keeps an unavailable pulse visible but unselectable, saying why', () => {
    const html = systems({ pulseUnavailableReason: 'Active pulse is not available in this version yet; sensors stay passive.' })
    expect(radio(html, 'activePulse')).toContain('disabled=""')
    expect(html).toContain('Active pulse is not available in this version yet; sensors stay passive.')
  })

  it('shows the engine sensor and cloak issues, including a forecast pulse failure', () => {
    const html = systems({
      orders: orders({ sensor: 'activePulse' }),
      issues: [
        { field: 'cloak', severity: 'warning', code: 'activity-breaks-cloak' },
        { field: 'sensor', severity: 'conditional', code: 'awaiting-energy', details: { requiredEnergyMilli: 12_000, availableEnergyMilli: 9_800 } },
        { field: 'movement', severity: 'conditional', code: 'propulsion-funding' },
      ],
    })
    expect(html).toContain('A successful scan or shot breaks cloak until a later turn.')
    expect(html).toContain('Will fail')
    expect(html).toContain('The pulse needs 12 energy on the first tick; 9 would be available.')
    expect(html).not.toContain('Movement pauses')
  })

  it('locks with the committed request beside the actual state at the cursor', () => {
    const own = frameAt(161, position, [], { cloak: { requested: true, actual: false, state: 'latched-activity' }, sensor: 'tracking', clocks: clocks(121, 131), turnActions: { pulseAttemptSpent: true, weaponIntentSpent: false } }).observation.ownShip
    const html = systems({ orders: orders({ sensor: 'activePulse' }), own, tick: 115, ticksResolved: 15, lockedReason: 'Orders are locked while the turn plays.' })
    expect(html.match(/<fieldset class="segmented" disabled=""/g)).toHaveLength(2)
    expect(html).toContain('Requested on. Cloak requested but broken by your scan or shot; it stays off this turn.')
    expect(html).toContain('Pulse succeeded: tracking for 0.6 s more.')
    expect(html).not.toContain('data-testid="energy-plan"')
  })

  it('warns when upkeep may outrun energy', () => {
    const own = frameAt(700, position, [], { energy: { currentMilli: 6800, maxMilli: 100_000 } }).observation.ownShip
    expect(systems({ own })).toContain('data-testid="energy-short"')
  })
})

describe('GameConsole with sensors', () => {
  it('offers a fresh planning pulse even though the planning frame still carries last turn\'s spent flag', () => {
    const html = render(planning({ turnActions: { pulseAttemptSpent: true, weaponIntentSpent: false } }))
    expect(radio(html, 'activePulse')).not.toContain('disabled')
    expect(html).toContain('Sensor drill')
    expect(html).toContain('The patrol is an interim script: it follows a set route and does not fire.')
  })

  it('names the movement drill and disables the pulse when the engine cannot perform it', () => {
    const html = render(planning(), false)
    expect(html).toContain('Movement drill')
    expect(radio(html, 'activePulse')).toContain('disabled=""')
    expect(html).toContain('Lasers are not available in this version yet. Missiles are not available in this version yet.')
  })

  it('prompts for a fresh cloak request after an unfunded latch carried the draft off', () => {
    const html = render(planning({ cloak: { requested: true, actual: false, state: 'latched-unfunded' } }, orders({ cloak: false })))
    expect(html).toContain('Last turn cloak upkeep ran out of energy. Select On to request it again.')
    expect(html).toContain('data-state="latched-unfunded"')
  })

  it('lists contacts as selectable entries with age, range, bearing and uncertainty', () => {
    const html = render(planning())
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('Seen 3.9 s ago at column 9, row 9, 6.1 cells away on bearing 081°; now anywhere within 1.2 cells of that point.')
    expect(html).toContain('Sensor reach')
  })

  it('shows status, contacts and log only through the playback cursor', () => {
    const turnStart = frameAt(100, position, [], { turnActions: { pulseAttemptSpent: true, weaponIntentSpent: false } })
    const atCursor = frameAt(110, position, [], {
      sensor: 'tracking', clocks: clocks(121, 131), cloak: { requested: true, actual: false, state: 'latched-activity' },
      turnActions: { pulseAttemptSpent: true, weaponIntentSpent: false }, energy: { currentMilli: 86_200, maxMilli: 100_000 },
    })
    const replay: ReplayPrefix = {
      scope: 'latest-player-turn-with-aftermath', startTick: 100, endTick: 200, cursorTick: 110,
      frames: [turnStart, atCursor], events: [{ id: 't101-000', tick: 101, kind: 'own-energy', deltaMilli: -12_000, reason: 'pulse' }],
      playback: { playing: false, speed: 1 },
    }
    const view: GameView = { ...base, phase: 'execution', frame: atCursor, replay, replayOf: null, automatic: false, lockedOwnOrders: orders({ sensor: 'activePulse' }) }
    const html = render(view)
    expect(html).toContain('Tracking, 1.1 s left')
    expect(html).toContain('Exposed, 2.1 s left')
    expect(html).toContain('Off, requested: broken')
    expect(html).toContain('Energy −12.0 (active pulse).')
    expect(html).toContain('No contacts.')
    expect(html).toContain('Pulse succeeded: tracking for 1.1 s more.')
  })

  it('keeps the commit phase from reading the previous turn\'s pulse flags', () => {
    const frame = frameAt(100, position, [current('contact-1', { x: 9500, y: 10_500 }, 100)], { turnActions: { pulseAttemptSpent: true, weaponIntentSpent: false } })
    const html = render({ ...base, phase: 'commit', frame, lockedOwnOrders: orders({ sensor: 'activePulse' }), replay: null })
    expect(html).toContain('Pulse fires on the first tick of the turn.')
  })
})
