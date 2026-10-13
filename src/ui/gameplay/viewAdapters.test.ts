import { describe, expect, it } from 'vitest'
import { DUEL_RULES, type GameView, type ReplayPrefix, type TurnOrders } from '../../contracts'
import { frameAt } from '../../rendering/testFrames'
import { presentGameView } from './viewAdapters'

const orders: TurnOrders = { turnIndex: 0, movement: { kind: 'destination', cell: { column: 8, row: 10 } }, sensor: 'passive', cloak: true, weapon: { kind: 'hold' } }
const base = { encounterId: 'e1', revision: 3, rules: DUEL_RULES }
const prefix: ReplayPrefix = {
  scope: 'latest-player-turn-with-aftermath', startTick: 0, endTick: 100, cursorTick: 1,
  frames: [frameAt(0, { x: 3500, y: 10_500 }), frameAt(1, { x: 3600, y: 10_500 })], events: [],
  playback: { playing: true, speed: 2 },
}

describe('presentGameView', () => {
  it('planning: editable draft with the supplied preview and validation, no playback', () => {
    const view: GameView = {
      ...base, phase: 'planning', frame: frameAt(0, { x: 3500, y: 10_500 }), draft: orders,
      validation: { structurallyValid: false, issues: [{ field: 'movement', severity: 'error', code: 'obstacle' }] },
      routePreview: { kind: 'unavailable', issues: [] }, replay: null,
    }
    const result = presentGameView(view)
    expect(result.editable).toBe(true)
    expect(result.movement).toEqual(orders.movement)
    expect(result.issues).toHaveLength(1)
    expect(result.routePreview).toEqual({ kind: 'unavailable', issues: [] })
    expect(result.replay).toBeNull()
    expect(result.frames).toEqual([view.frame])
  })

  it('execution: only the cursor-bounded prefix frames, locked orders, no preview', () => {
    const view: GameView = { ...base, phase: 'execution', frame: prefix.frames[1], replay: prefix, replayOf: null, automatic: false, lockedOwnOrders: orders }
    const result = presentGameView(view)
    expect(result.frames).toBe(prefix.frames)
    expect(result.replay).toBe(prefix)
    expect(result.routePreview).toBeNull()
    expect(result.editable).toBe(false)
    expect(result.lockedReason).toMatch(/locked/)
  })

  it('automatic aftermath after own destruction may have no own orders', () => {
    const view: GameView = { ...base, phase: 'execution', frame: prefix.frames[1], replay: prefix, replayOf: null, automatic: true, reason: 'own-destroyed', lockedOwnOrders: null }
    const result = presentGameView(view)
    expect(result.movement).toBeNull()
    expect(result.lockedReason).toMatch(/destroyed/)
  })

  it('commit and terminal without replay fall back to the published current frame', () => {
    const frame = frameAt(100, { x: 9000, y: 10_500 })
    expect(presentGameView({ ...base, phase: 'commit', frame, lockedOwnOrders: orders, replay: null }).frames).toEqual([frame])
    const terminal = presentGameView({ ...base, phase: 'terminal', frame, lockedOwnOrders: null, replay: null, result: { kind: 'abandoned' } })
    expect(terminal.frames).toEqual([frame])
    expect(terminal.replay).toBeNull()
    expect(terminal.editable).toBe(false)
  })
})
