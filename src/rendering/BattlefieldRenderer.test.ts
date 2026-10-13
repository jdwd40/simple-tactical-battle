import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DUEL_MAP } from '../contracts'
import { BattlefieldRenderer, rendererDiagnostics, type RendererFrame } from './BattlefieldRenderer'
import { fitPlot, toScreen } from './plotGeometry'
import { buildScene } from './plotScene'
import { frameAt } from './testFrames'

// Minimal PixiJS stand-ins: these tests exercise the renderer's own animation control flow,
// not Pixi drawing. Every drawing call is a chainable no-op.
vi.mock('pixi.js', () => {
  class Chain {
    clear() { return this }
    rect() { return this }
    fill() { return this }
    stroke() { return this }
    moveTo() { return this }
    lineTo() { return this }
    circle() { return this }
    poly() { return this }
    arc() { return this }
  }
  class Container { addChild() {} }
  class Text {
    text: string
    style: Record<string, unknown>
    anchor = { set() {} }
    position = { set() {} }
    visible = true
    constructor(options: { text: string; style: Record<string, unknown> }) { this.text = options.text; this.style = { ...options.style } }
    destroy() {}
  }
  class Application {
    stage = new Container()
    screen = { width: 732, height: 635 }
    renderer = { resize: (width: number, height: number) => { this.screen = { width, height } } }
    canvas = { setAttribute() {}, style: {}, addEventListener() {}, removeEventListener() {} }
    async init() {}
    render() {}
    destroy() {}
  }
  return { Application, Container, Graphics: Chain, Text }
})

let now = 0
let frames = new Map<number, FrameRequestCallback>()
let nextFrame = 1
function advance(ms: number) {
  now += ms
  const due = [...frames.values()]
  frames = new Map()
  for (const callback of due) callback(now)
}

beforeEach(() => {
  now = 0
  frames = new Map()
  vi.stubGlobal('window', { devicePixelRatio: 1 })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(nextFrame, callback); return nextFrame++ })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const from = buildScene({ frames: [frameAt(4, { x: 1000, y: 10_500 })] })
const to = buildScene({ frames: [frameAt(5, { x: 2000, y: 10_500 })] })
const transform = fitPlot(732, 635, DUEL_MAP, 1000)
const screenX = (worldX: number) => toScreen(transform, { x: worldX, y: 10_500 }).x
const frame = (scene = to, smoothing: RendererFrame['smoothing'] = null): RendererFrame => ({ map: DUEL_MAP, unitsPerCell: 1000, tickMs: 100, scene, smoothing, selectable: false })
const drawn = () => rendererDiagnostics().last!

async function startedRenderer() {
  const renderer = new BattlefieldRenderer({ onHoverCell() {}, onSelectCell() {} })
  await renderer.init({ clientWidth: 732, clientHeight: 635, appendChild() {} } as unknown as HTMLElement)
  renderer.update(frame(from))
  return renderer
}

describe('BattlefieldRenderer smoothing control', () => {
  it('cancels an in-flight tween and snaps to frame n when a same-tick update carries no smoothing (pause, reduced motion)', async () => {
    const renderer = await startedRenderer()
    renderer.update(frame(to, { from, durationMs: 100 }))
    advance(25)
    expect(drawn().transition).toBe('smooth')
    expect(drawn().ownShip.x).toBeCloseTo(screenX(1250))

    renderer.update(frame({ ...to }, null))
    expect(drawn()).toMatchObject({ tick: 5, transition: 'snap' })
    expect(drawn().ownShip.x).toBeCloseTo(screenX(2000))

    advance(25)
    advance(100)
    expect(frames.size).toBe(0)
    expect(drawn().transition).toBe('snap')
    expect(drawn().ownShip.x).toBeCloseTo(screenX(2000))
    renderer.dispose()
  })

  it('keeps a same-tick republish during playback on the original tween without restarting or extending it', async () => {
    const renderer = await startedRenderer()
    renderer.update(frame(to, { from, durationMs: 100 }))
    advance(40)
    expect(drawn().ownShip.x).toBeCloseTo(screenX(1400))

    renderer.update(frame({ ...to }, 'continue'))
    advance(20)
    expect(drawn().transition).toBe('smooth')
    expect(drawn().ownShip.x).toBeCloseTo(screenX(1600))

    advance(40)
    expect(drawn().ownShip.x).toBeCloseTo(screenX(2000))
    expect(frames.size).toBe(0)
    renderer.dispose()
  })

  it('treats continue with no tween in flight as a snap', async () => {
    const renderer = await startedRenderer()
    renderer.update(frame(to, 'continue'))
    expect(drawn()).toMatchObject({ tick: 5, transition: 'snap' })
    expect(frames.size).toBe(0)
    renderer.dispose()
  })

  it('stops any tween on dispose and when disposed before init resolves', async () => {
    const before = rendererDiagnostics()
    const renderer = await startedRenderer()
    renderer.update(frame(to, { from, durationMs: 100 }))
    renderer.dispose()
    expect(frames.size).toBe(0)

    const pending = new BattlefieldRenderer({ onHoverCell() {}, onSelectCell() {} })
    const started = pending.init({ clientWidth: 732, clientHeight: 635, appendChild() {} } as unknown as HTMLElement)
    pending.dispose()
    expect(await started).toBe(false)
    const after = rendererDiagnostics()
    expect(after.created - before.created).toBe(2)
    expect(after.destroyed - before.destroyed).toBe(2)
  })
})
