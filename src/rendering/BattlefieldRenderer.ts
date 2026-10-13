import { Application, Container, Graphics, Text, type TextStyleOptions } from 'pixi.js'
import type { Cell, Position, PublicMap } from '../contracts'
import { dashCircle, dashPolyline } from './dashes'
import { layoutLabels, spotsAround, type LabelSpot, type Rect } from './labelLayout'
import { PLOT_COLOURS, PLOT_FONT } from './plotPalette'
import {
  cellAtScreen, cellRect, fitPlot, headingToRotation, toScreen, type PlotTransform, type ScreenPoint,
} from './plotGeometry'
import {
  interpolateScene, splitPathAt, type PlotContact, type PlotEffect, type PlotScene, type PlotSensorRing,
} from './plotScene'

export interface RendererCallbacks {
  onHoverCell(cell: Cell | null): void
  onSelectCell(cell: Cell): void
}

export interface RendererFrame {
  readonly map: PublicMap
  readonly unitsPerCell: number
  /** Public tick length, for the age shown on last-known contact labels. */
  readonly tickMs: number
  readonly scene: PlotScene
  /**
   * Animate from an earlier scene (exactly one tick before) over the duration. `continue`
   * keeps an in-flight tween to this same tick on its original schedule (a republish during
   * active playback) and otherwise snaps. null always cancels any tween and snaps to `scene`
   * (pause, seek, reduced motion).
   */
  readonly smoothing: { readonly from: PlotScene; readonly durationMs: number } | 'continue' | null
  readonly selectable: boolean
  /** What a selecting click does: set the destination, or (deliberate aiming mode) the missile aim. */
  readonly pointerMode?: 'destination' | 'aim'
  /** Reduced motion: effects keep their size and fade instead of expanding or drifting. */
  readonly reducedMotion?: boolean
}

/** Observable lifecycle and last-drawn summary, for browser checks of cleanup and fog-of-war. */
export interface RendererDiagnostics {
  readonly created: number
  readonly destroyed: number
  readonly live: number
  /** Static terrain redraws (layout or resize), across all renderers. */
  readonly terrainDraws: number
  readonly last: DrawSummary | null
}

export interface DrawSummary {
  readonly tick: number
  readonly transition: 'snap' | 'smooth'
  readonly canvas: { readonly width: number; readonly height: number }
  readonly cellPx: number
  readonly origin: ScreenPoint
  readonly ownShip: ScreenPoint
  /** Own ship marker state drawn: cloaked (dashed hull ring), exposed (labelled) or plain. */
  readonly ownState: 'cloaked' | 'exposed' | 'plain' | 'destroyed'
  readonly trailPoints: number
  readonly plan: string | null
  readonly sensorRings: readonly { readonly kind: PlotSensorRing['kind']; readonly radiusPx: number }[]
  readonly weaponPlan: string | null
  readonly ownMissiles: readonly { readonly id: string; readonly at: ScreenPoint }[]
  readonly hostileMissiles: readonly { readonly alias: string; readonly kind: string; readonly at: ScreenPoint; readonly radiusPx: number }[]
  readonly effects: readonly string[]
  /** Every tactical label as placed this frame (screen rectangles), for overlap/clipping checks. */
  readonly labels: readonly { readonly key: string; readonly text: string; readonly rect: Rect; readonly displaced: boolean }[]
  readonly contacts: readonly { readonly alias: string; readonly kind: string; readonly at: ScreenPoint; readonly radiusPx: number; readonly filled: boolean; readonly selected: boolean; readonly label: string }[]
}

const counters = { created: 0, destroyed: 0, terrainDraws: 0 }
let lastSummary: DrawSummary | null = null

export function rendererDiagnostics(): RendererDiagnostics {
  return { ...counters, live: counters.created - counters.destroyed, last: lastSummary }
}

const RING_STYLE: Record<PlotSensorRing['kind'], { dash: number; gap: number; width: number; alpha: number; label: string }> = {
  passive: { dash: 2, gap: 6, width: 1.25, alpha: 0.55, label: 'Passive reach (nominal)' },
  tracking: { dash: 8, gap: 4, width: 1.75, alpha: 0.9, label: 'Tracking reach (nominal)' },
  'pulse-preview': { dash: 5, gap: 6, width: 1.5, alpha: 0.7, label: 'Pulse reach if funded' },
}

const terrainKey = (map: PublicMap, unitsPerCell: number) =>
  `${map.columns}x${map.rows}@${unitsPerCell}:${map.asteroidCells.map((cell) => `${cell.column},${cell.row}`).join(';')}`

/** Deterministic value in [0, 1) for fixed decoration (stars, rock outlines); never game data. */
function noise(a: number, b: number): number {
  const value = Math.sin(a * 127.1 + b * 311.7) * 43_758.5453
  return value - Math.floor(value)
}

/** Uncertainty regions up to this radius (cells) are tinted; larger ones are outline only. */
const UNCERTAINTY_FILL_CELLS = 3

interface Bounds { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
const mapBounds = (transform: PlotTransform): Bounds => ({
  left: transform.originX, top: transform.originY,
  right: transform.originX + transform.columns * transform.cellPx,
  bottom: transform.originY + transform.rows * transform.cellPx,
})
const insideBounds = (bounds: Bounds, x: number, y: number) => x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom

const LABEL_STYLE: TextStyleOptions = { fontFamily: PLOT_FONT, fontSize: 13, fontWeight: '500', fill: PLOT_COLOURS.inkMuted }

/** Reuses Text objects between redraws so animation frames do not churn GPU textures. */
class LabelPool {
  private readonly labels = new Map<string, Text>()
  private readonly fills = new Map<string, number>()
  private used = new Set<string>()
  constructor(private readonly layer: Container) {}

  begin() { this.used = new Set() }

  /** The pooled Text for `key`, created on first use and marked used for this frame. */
  text(key: string, text: string, fill: number): Text {
    let label = this.labels.get(key)
    if (!label) {
      label = new Text({ text, style: { ...LABEL_STYLE, fill } })
      this.labels.set(key, label)
      this.layer.addChild(label)
    }
    if (label.text !== text) label.text = text
    // Only touch the style when it changes: a style write re-rasterises the text.
    if (this.fills.get(key) !== fill) {
      label.style.fill = fill
      this.fills.set(key, fill)
    }
    label.visible = true
    this.used.add(key)
    return label
  }

  place(key: string, text: string, x: number, y: number, fill: number, anchorX = 0, anchorY = 0.5) {
    const label = this.text(key, text, fill)
    label.anchor.set(anchorX, anchorY)
    label.position.set(Math.round(x), Math.round(y))
  }

  end() {
    for (const [key, label] of this.labels) {
      if (!this.used.has(key)) {
        label.destroy()
        this.labels.delete(key)
        this.fills.delete(key)
      }
    }
  }
}

interface LabelOrder {
  readonly key: string
  readonly text: string
  readonly fill: number
  readonly priority: number
  readonly spots: readonly LabelSpot[]
  readonly nearSpots?: number
  readonly marker?: ScreenPoint
  readonly optional?: boolean
}

/**
 * Tactical labels for one frame: collected while drawing, then placed together by priority so
 * close markers and map edges never clip or stack text; a displaced label gets a leader line.
 */
class TacticalLabels {
  private orders: LabelOrder[] = []
  private markers: Rect[] = []
  constructor(private readonly pool: LabelPool, private readonly leaders: Graphics) {}

  begin() {
    this.orders = []
    this.markers = []
    this.pool.begin()
  }

  /** A marker's screen footprint; labels keep clear of it. */
  reserve(x: number, y: number, half: number) {
    this.markers.push({ left: x - half, top: y - half, right: x + half, bottom: y + half })
  }

  request(order: LabelOrder) { this.orders.push(order) }

  /** Label for a marker at (x, y) of the given radius, preferring the spots in `prefer` order. */
  around(key: string, text: string, fill: number, priority: number, at: ScreenPoint, radius: number, prefer?: readonly number[], optional = false) {
    const { spots, nearSpots } = spotsAround(at.x, at.y, radius)
    const ordered = prefer ? [...prefer.map((index) => spots[index]), ...spots.filter((_, index) => !prefer.includes(index))] : spots
    this.request({ key, text, fill, priority, spots: ordered, nearSpots, marker: at, optional })
  }

  end(bounds: Rect): DrawSummary['labels'] {
    const texts = new Map(this.orders.map((order) => [order.key, this.pool.text(order.key, order.text, order.fill)]))
    const placements = layoutLabels(this.orders.map((order) => {
      const label = texts.get(order.key)!
      // Measured text size (estimated where no renderer measures text).
      const width = Number.isFinite(label.width) ? label.width : order.text.length * 7
      const height = Number.isFinite(label.height) ? label.height : 16
      return { key: order.key, width, height, priority: order.priority, spots: order.spots, nearSpots: order.nearSpots, marker: order.marker, optional: order.optional }
    }), this.markers, bounds)
    const g = this.leaders.clear()
    const byKey = new Map(this.orders.map((order) => [order.key, order]))
    const summary: DrawSummary['labels'][number][] = []
    // Supplementary labels with no clear spot are left out this frame.
    const placedKeys = new Set(placements.map((placement) => placement.key))
    for (const [key, label] of texts) if (!placedKeys.has(key)) label.visible = false
    for (const placement of placements) {
      const order = byKey.get(placement.key)!
      const label = texts.get(placement.key)!
      label.anchor.set(placement.spot.anchorX, placement.spot.anchorY)
      label.position.set(Math.round(placement.spot.x), Math.round(placement.spot.y))
      if (placement.displaced && order.marker) {
        const { rect } = placement
        const to = { x: Math.min(rect.right, Math.max(rect.left, order.marker.x)), y: Math.min(rect.bottom, Math.max(rect.top, order.marker.y)) }
        g.moveTo(order.marker.x, order.marker.y).lineTo(to.x, to.y).stroke({ width: 1, color: order.fill, alpha: 0.6 })
      }
      summary.push({ key: placement.key, text: order.text, rect: placement.rect, displaced: placement.displaced })
    }
    this.pool.end()
    return summary
  }
}

/**
 * Direct PixiJS presentation of a PlotScene. Owns one Application, its canvas, a
 * ResizeObserver and pointer listeners; dispose() releases all of them, including when
 * called while the asynchronous init is still pending.
 */
export class BattlefieldRenderer {
  private app: Application | null = null
  private host: HTMLElement | null = null
  private disposed = false
  private frame: RendererFrame | null = null
  private transform: PlotTransform | null = null
  private hoverCell: Cell | null = null
  private animation = 0
  /** Target of the in-flight smoothing, so a same-tick republish does not restart or cut it. */
  private animatingTo: PlotScene | null = null
  private resizeObserver: ResizeObserver | null = null
  private readonly layers = {
    terrain: new Graphics(),
    terrainLabels: new Container(),
    sensors: new Graphics(),
    plan: new Graphics(),
    uncertainty: new Graphics(),
    contacts: new Graphics(),
    ordnance: new Graphics(),
    ship: new Graphics(),
    effects: new Graphics(),
    hover: new Graphics(),
    leaders: new Graphics(),
    labels: new Container(),
  }
  private terrainLabels: LabelPool | null = null
  private labels: TacticalLabels | null = null

  constructor(private readonly callbacks: RendererCallbacks) {}

  /** Resolves true once drawing can start, or false if disposed first. */
  async init(host: HTMLElement): Promise<boolean> {
    const app = new Application()
    counters.created += 1
    await app.init({
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      background: PLOT_COLOURS.well,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      autoStart: false,
      sharedTicker: false,
      preference: ['webgl', 'canvas'],
    })
    this.app = app
    if (this.disposed) {
      this.destroyApp()
      return false
    }

    this.host = host
    const canvas = app.canvas
    canvas.setAttribute('aria-hidden', 'true')
    canvas.style.display = 'block'
    host.appendChild(canvas)
    const { terrain, terrainLabels, sensors, uncertainty, plan, contacts, ordnance, ship, effects, hover, leaders, labels } = this.layers
    // Uncertainty sits under plans and markers, so a large honest area never hides them.
    app.stage.addChild(terrain, terrainLabels, sensors, uncertainty, plan, contacts, ordnance, hover, ship, effects, leaders, labels)
    this.terrainLabels = new LabelPool(terrainLabels)
    this.labels = new TacticalLabels(new LabelPool(labels), leaders)

    canvas.addEventListener('pointermove', this.handlePointerMove)
    canvas.addEventListener('pointerleave', this.handlePointerLeave)
    canvas.addEventListener('pointerdown', this.handlePointerDown)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(host)
    this.resize()
    return true
  }

  update(frame: RendererFrame) {
    // Compare the public map by content: an equal map in a new object (each phase) is no change.
    const terrainChanged = this.frame === null || terrainKey(this.frame.map, this.frame.unitsPerCell) !== terrainKey(frame.map, frame.unitsPerCell)
    this.frame = frame
    if (!this.app || this.disposed) return
    if (terrainChanged) this.layoutAndDrawTerrain()
    this.app.canvas.style.cursor = frame.selectable ? 'crosshair' : 'default'
    this.drawHover()
    const smoothing = frame.smoothing
    if (smoothing === 'continue' && this.animatingTo?.tick === frame.scene.tick) {
      this.animatingTo = frame.scene
      return
    }
    this.stopAnimation()
    if (smoothing && smoothing !== 'continue' && smoothing.durationMs > 0) this.animate(smoothing.from, frame.scene, smoothing.durationMs)
    else this.drawDynamic(frame.scene, 'snap')
  }

  private stopAnimation() {
    cancelAnimationFrame(this.animation)
    this.animatingTo = null
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.stopAnimation()
    // A pending init destroys the application itself when it resolves.
    if (this.app) this.destroyApp()
  }

  private destroyApp() {
    const app = this.app
    if (!app) return
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    app.canvas.removeEventListener('pointermove', this.handlePointerMove)
    app.canvas.removeEventListener('pointerleave', this.handlePointerLeave)
    app.canvas.removeEventListener('pointerdown', this.handlePointerDown)
    app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true, context: true })
    this.app = null
    this.host = null
    counters.destroyed += 1
  }

  private resize() {
    if (!this.app || !this.host) return
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    this.app.renderer.resize(width, height)
    this.layoutAndDrawTerrain()
    if (this.frame && !this.animatingTo) this.drawDynamic(this.frame.scene, 'snap')
  }

  private animate(from: PlotScene, to: PlotScene, durationMs: number) {
    const start = performance.now()
    this.animatingTo = to
    const step = (now: number) => {
      const target = this.animatingTo
      if (!target) return
      const t = Math.min(1, (now - start) / durationMs)
      this.drawDynamic(t < 1 ? interpolateScene(from, target, t) : target, 'smooth')
      if (t < 1) this.animation = requestAnimationFrame(step)
      else this.animatingTo = null
    }
    this.animation = requestAnimationFrame(step)
  }

  private layoutAndDrawTerrain() {
    const app = this.app
    const frame = this.frame
    if (!app || !frame || !this.terrainLabels) return
    const transform = fitPlot(app.screen.width, app.screen.height, frame.map, frame.unitsPerCell)
    this.transform = transform
    const { columns, rows, cellPx, originX, originY } = transform
    const width = columns * cellPx
    const height = rows * cellPx
    const g = this.layers.terrain.clear()
    counters.terrainDraws += 1

    // Depth: a recessed field with a faint, fixed starfield and an inner edge shadow.
    g.rect(originX, originY, width, height).fill({ color: PLOT_COLOURS.space })
    for (let star = 0; star < 140; star += 1) {
      // Tiny squares read as stars at this size and cost a fraction of circles to build.
      const size = 0.8 + noise(star, 3) * 1.4
      g.rect(originX + noise(star, 1) * width, originY + noise(star, 2) * height, size, size)
        .fill({ color: PLOT_COLOURS.star, alpha: 0.1 + noise(star, 4) * 0.32 })
    }
    for (let ring = 0; ring < 6; ring += 1) {
      const inset = ring * 7
      g.rect(originX + inset, originY + inset, width - inset * 2, height - inset * 2).stroke({ width: 7, color: 0x000000, alpha: 0.11 * (1 - ring / 6), alignment: 1 })
    }

    for (let column = 0; column <= columns; column += 1) {
      const x = originX + column * cellPx
      g.moveTo(x, originY).lineTo(x, originY + height)
    }
    for (let row = 0; row <= rows; row += 1) {
      const y = originY + row * cellPx
      g.moveTo(originX, y).lineTo(originX + width, y)
    }
    g.stroke({ width: 1, color: PLOT_COLOURS.grid, alpha: 0.75, pixelLine: true })
    for (let index = 5; index < Math.max(columns, rows); index += 5) {
      if (index < columns) g.moveTo(originX + index * cellPx, originY).lineTo(originX + index * cellPx, originY + height)
      if (index < rows) g.moveTo(originX, originY + index * cellPx).lineTo(originX + width, originY + index * cellPx)
    }
    g.stroke({ width: 3, color: PLOT_COLOURS.gridMajor, alpha: 0.18 })
    for (let index = 5; index < Math.max(columns, rows); index += 5) {
      if (index < columns) g.moveTo(originX + index * cellPx, originY).lineTo(originX + index * cellPx, originY + height)
      if (index < rows) g.moveTo(originX, originY + index * cellPx).lineTo(originX + width, originY + index * cellPx)
    }
    g.stroke({ width: 1, color: PLOT_COLOURS.gridMajor, pixelLine: true })

    // Asteroids block their whole cell: the cell stays filled, hatched and outlined, with a rock
    // silhouette (deterministic per cell) so obstacles read as rock without relying on colour.
    for (const cell of frame.map.asteroidCells) {
      const rect = cellRect(transform, cell)
      g.rect(rect.x, rect.y, rect.size, rect.size).fill({ color: PLOT_COLOURS.asteroidFill })
      for (let k = 1; k <= 3; k += 1) {
        const offset = (rect.size * k) / 4
        g.moveTo(rect.x + offset, rect.y).lineTo(rect.x, rect.y + offset)
        g.moveTo(rect.x + rect.size, rect.y + offset).lineTo(rect.x + offset, rect.y + rect.size)
      }
      g.stroke({ width: 1, color: PLOT_COLOURS.asteroidHatch, alpha: 0.35 })
      const cx = rect.x + rect.size / 2
      const cy = rect.y + rect.size / 2
      const rock = (scale: number, dx: number, dy: number) => Array.from({ length: 9 }, (_, k) => {
        const angle = (k / 9) * Math.PI * 2 + noise(cell.column * 31 + cell.row, k) * 0.35
        const radius = rect.size * scale * (0.78 + noise(cell.row * 17 + cell.column, k + 9) * 0.22)
        return [cx + dx + Math.cos(angle) * radius, cy + dy + Math.sin(angle) * radius]
      }).flat()
      g.poly(rock(0.44, 1.5, 2), true).fill({ color: PLOT_COLOURS.rockShadow, alpha: 0.9 })
      g.poly(rock(0.42, 0, 0), true).fill({ color: PLOT_COLOURS.rock }).stroke({ width: 1, color: PLOT_COLOURS.rockLight, alpha: 0.55 })
      g.circle(cx - rect.size * 0.1, cy - rect.size * 0.08, rect.size * 0.07).fill({ color: PLOT_COLOURS.rockShadow, alpha: 0.8 })
      g.circle(cx + rect.size * 0.12, cy + rect.size * 0.1, rect.size * 0.045).fill({ color: PLOT_COLOURS.rockShadow, alpha: 0.7 })
      g.rect(rect.x, rect.y, rect.size, rect.size).stroke({ width: 1, color: PLOT_COLOURS.edge, alignment: 1 })
    }
    g.rect(originX, originY, width, height).stroke({ width: 1, color: PLOT_COLOURS.edge, alignment: 0 })
    // Terrain is static between resizes: render it once to a texture instead of every frame.
    if (g.cacheAsTexture) {
      g.cacheAsTexture(false)
      g.cacheAsTexture({ resolution: app.renderer.resolution, antialias: true })
    }

    // Coordinate labels match the zero-based column/row numbers used for keyboard entry.
    const labelEvery = cellPx >= 22 ? 1 : 5
    const pool = this.terrainLabels
    pool.begin()
    for (let column = 0; column < columns; column += labelEvery) {
      pool.place(`c${column}`, String(column), originX + (column + 0.5) * cellPx, originY - 11, PLOT_COLOURS.inkMuted, 0.5, 0.5)
    }
    for (let row = 0; row < rows; row += labelEvery) {
      pool.place(`r${row}`, String(row), originX - 7, originY + (row + 0.5) * cellPx, PLOT_COLOURS.inkMuted, 1, 0.5)
    }
    pool.end()
    this.drawHover()
  }

  private drawDynamic(scene: PlotScene, transition: 'snap' | 'smooth') {
    const app = this.app
    const transform = this.transform
    const labels = this.labels
    if (!app || !transform || !labels) return
    labels.begin()
    this.layers.uncertainty.clear()
    const sensorRings = this.drawSensorRings(scene, transform, labels)
    this.drawPlan(scene, transform, labels)
    const contacts = this.drawContacts(scene.contacts, transform, labels, this.frame?.tickMs ?? 100)
    const ordnance = this.drawOrdnance(scene, transform, labels, this.frame?.tickMs ?? 100)
    const { at: ship, state: ownState } = this.drawShip(scene, transform, labels)
    const effects = this.drawEffects(scene, transform, labels)
    const placedLabels = labels.end(mapBounds(transform))
    app.render()

    lastSummary = {
      tick: scene.tick,
      transition,
      canvas: { width: app.screen.width, height: app.screen.height },
      cellPx: transform.cellPx,
      origin: { x: transform.originX, y: transform.originY },
      ownShip: ship,
      ownState,
      trailPoints: scene.trail.length,
      plan: scene.plan?.kind ?? null,
      sensorRings,
      contacts,
      weaponPlan: scene.weaponPlan?.kind ?? null,
      ...ordnance,
      effects,
      labels: placedLabels,
    }
  }

  /** Own sensor reach as dotted/dashed sea-glass rings, clipped to the public map. */
  private drawSensorRings(scene: PlotScene, transform: PlotTransform, labels: TacticalLabels) {
    const g = this.layers.sensors.clear()
    const at = toScreen(transform, scene.ownShip.position)
    const bounds = mapBounds(transform)
    const drawn: DrawSummary['sensorRings'][number][] = []
    for (const ring of scene.sensorRings) {
      const radiusPx = ring.radiusUnits * transform.scale
      const style = RING_STYLE[ring.kind]
      for (const [start, end] of dashCircle(radiusPx, style.dash, style.gap)) {
        const mid = (start + end) / 2
        if (!insideBounds(bounds, at.x + Math.cos(mid) * radiusPx, at.y + Math.sin(mid) * radiusPx)) continue
        g.moveTo(at.x + Math.cos(start) * radiusPx, at.y + Math.sin(start) * radiusPx).arc(at.x, at.y, radiusPx, start, end)
      }
      g.stroke({ width: style.width, color: PLOT_COLOURS.sonar, alpha: style.alpha, cap: 'round' })
      // Label the ring where it is on the map: above, below, left or right of the ship.
      const spots = ring.kind === 'pulse-preview'
        ? [{ x: at.x, y: at.y + radiusPx + 9, ax: 0.5 }, { x: at.x, y: at.y - radiusPx - 9, ax: 0.5 }]
        : [{ x: at.x, y: at.y - radiusPx - 9, ax: 0.5 }, { x: at.x, y: at.y + radiusPx + 9, ax: 0.5 }]
      spots.push({ x: at.x + radiusPx + 6, y: at.y - 12, ax: 0 }, { x: at.x - radiusPx - 6, y: at.y - 12, ax: 1 })
      labels.request({ key: `ring:${ring.kind}`, text: style.label, fill: PLOT_COLOURS.sonar, priority: 10, optional: true, spots: spots.map((spot) => ({ x: spot.x, y: spot.y, anchorX: spot.ax, anchorY: 0.5 })) })
      drawn.push({ kind: ring.kind, radiusPx })
    }
    return drawn
  }

  private drawPlan(scene: PlotScene, transform: PlotTransform, labels: TacticalLabels) {
    const g = this.layers.plan.clear()
    const screen = (points: readonly Position[]) => points.map((point) => toScreen(transform, point))
    const strokeDashes = (points: readonly ScreenPoint[], dash: number, gap: number, width: number, alpha: number) => {
      for (const [a, b] of dashPolyline(points, dash, gap)) g.moveTo(a.x, a.y).lineTo(b.x, b.y)
      g.stroke({ width, color: PLOT_COLOURS.command, alpha, cap: 'round' })
    }

    // Executed trail: solid, because these positions are recorded fact.
    if (scene.trail.length > 1) {
      const [first, ...rest] = screen(scene.trail)
      g.moveTo(first.x, first.y)
      for (const point of rest) g.lineTo(point.x, point.y)
      g.stroke({ width: 2, color: PLOT_COLOURS.command, alpha: 0.55, join: 'round' })
    }

    this.drawWeaponPlan(scene, transform, labels, strokeDashes)

    const plan = scene.plan
    if (!plan || plan.kind === 'hold') return
    const destination = cellRect(transform, plan.destination)
    const inset = Math.max(3, destination.size * 0.14)
    g.rect(destination.x + inset, destination.y + inset, destination.size - inset * 2, destination.size - inset * 2)
      .stroke({ width: 2, color: PLOT_COLOURS.command })
    const centre = { x: destination.x + destination.size / 2, y: destination.y + destination.size / 2 }
    g.moveTo(centre.x - 4, centre.y).lineTo(centre.x + 4, centre.y).moveTo(centre.x, centre.y - 4).lineTo(centre.x, centre.y + 4)
      .stroke({ width: 1.5, color: PLOT_COLOURS.command })
    labels.reserve(centre.x, centre.y, destination.size / 2 - inset)
    labels.around('destination', 'Destination', PLOT_COLOURS.command, 60, centre, destination.size / 2 - inset)

    if (plan.kind === 'committed') {
      strokeDashes(screen(plan.path), 2, 5, 2, 0.85)
      return
    }
    // Draft preview: brighter dashes up to the predicted turn-end point, fainter beyond it.
    const { reach, beyond } = splitPathAt(plan.path, plan.nominal)
    strokeDashes(screen(reach), 7, 5, 2, 0.95)
    strokeDashes(screen(beyond), 4, 6, 1.5, 0.45)
    const nominal = toScreen(transform, plan.nominal)
    const reachesDestination = Math.abs(nominal.x - centre.x) < destination.size / 2 && Math.abs(nominal.y - centre.y) < destination.size / 2
    if (reachesDestination) {
      labels.around('nominal', 'Reached this turn (predicted)', PLOT_COLOURS.command, 55, centre, destination.size / 2 + 8, [5, 7, 4, 6], true)
      return
    }
    g.circle(nominal.x, nominal.y, 5).fill({ color: PLOT_COLOURS.well }).stroke({ width: 2, color: PLOT_COLOURS.command })
    labels.reserve(nominal.x, nominal.y, 6)
    labels.around('nominal', 'Turn end (predicted)', PLOT_COLOURS.command, 55, nominal, 7, [5, 3, 7, 0, 1], true)
  }

  /** Intended weapon use: laser line and range to its target alias, or missile line, aim mark and blast. */
  private drawWeaponPlan(
    scene: PlotScene, transform: PlotTransform, labels: TacticalLabels,
    strokeDashes: (points: readonly ScreenPoint[], dash: number, gap: number, width: number, alpha: number) => void,
  ) {
    const weapon = scene.weaponPlan
    if (!weapon) return
    const g = this.layers.plan
    const from = toScreen(transform, scene.ownShip.position)
    if (weapon.kind === 'laser') {
      const radiusPx = weapon.rangeUnits * transform.scale
      const bounds = mapBounds(transform)
      for (const [start, end] of dashCircle(radiusPx, 10, 6)) {
        const mid = (start + end) / 2
        if (!insideBounds(bounds, from.x + Math.cos(mid) * radiusPx, from.y + Math.sin(mid) * radiusPx)) continue
        g.moveTo(from.x + Math.cos(start) * radiusPx, from.y + Math.sin(start) * radiusPx).arc(from.x, from.y, radiusPx, start, end)
      }
      g.stroke({ width: 1.25, color: PLOT_COLOURS.command, alpha: 0.6 })
      const spot = [{ x: from.x, y: from.y + radiusPx + 9 }, { x: from.x, y: from.y - radiusPx - 9 }].find((point) => insideBounds(bounds, point.x, point.y))
      if (spot) labels.request({ key: 'laser-range', text: 'Laser range', fill: PLOT_COLOURS.command, priority: 15, optional: true, spots: [{ x: spot.x, y: spot.y, anchorX: 0.5, anchorY: 0.5 }] })
      if (weapon.target) {
        const to = toScreen(transform, weapon.target)
        // Current lock: long dashes; last sighting: short dots (it may never fire).
        strokeDashes([from, to], weapon.current ? 10 : 3, weapon.current ? 5 : 5, 2, 0.95)
        labels.around('laser-target', weapon.current ? 'Laser target' : 'Laser target (needs a new lock)', PLOT_COLOURS.command, 45, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, 4, [4, 6, 0, 1], true)
      }
      return
    }
    const aim = cellRect(transform, weapon.aim)
    const centre = { x: aim.x + aim.size / 2, y: aim.y + aim.size / 2 }
    strokeDashes([from, centre], 6, 6, 2, 0.9)
    const blastPx = weapon.blastRadiusUnits * transform.scale
    for (const [start, end] of dashCircle(blastPx, 3, 4)) g.moveTo(centre.x + Math.cos(start) * blastPx, centre.y + Math.sin(start) * blastPx).arc(centre.x, centre.y, blastPx, start, end)
    g.stroke({ width: 1.25, color: PLOT_COLOURS.command, alpha: 0.8 })
    // Aim mark: a ringed X, distinct from the destination's square.
    const r = Math.max(5, aim.size * 0.28)
    g.circle(centre.x, centre.y, r).stroke({ width: 2, color: PLOT_COLOURS.command })
    g.moveTo(centre.x - r, centre.y - r).lineTo(centre.x + r, centre.y + r).moveTo(centre.x + r, centre.y - r).lineTo(centre.x - r, centre.y + r)
      .stroke({ width: 1.5, color: PLOT_COLOURS.command })
    labels.reserve(centre.x, centre.y, r + 1)
    labels.around('missile-aim', 'Missile aim', PLOT_COLOURS.command, 50, centre, r, [4, 0, 6, 1], true)
  }

  /** Own missile telemetry, observed hostile ordnance and recent recorded shot/impact marks. */
  private drawOrdnance(scene: PlotScene, transform: PlotTransform, labels: TacticalLabels, tickMs: number) {
    const g = this.layers.ordnance.clear()
    const size = Math.max(5, transform.cellPx * 0.18)
    const bounds = mapBounds(transform)
    const triangle = (at: ScreenPoint, angle: number) => {
      const point = (a: number, r: number) => [at.x + Math.cos(angle + a) * r, at.y + Math.sin(angle + a) * r]
      return [...point(0, size * 1.4), ...point(2.5, size), ...point(-2.5, size)]
    }
    const trail = (positions: readonly Position[], head: ScreenPoint, color: number) => {
      const points = [...positions.map((position) => toScreen(transform, position)), head]
      for (let index = 1; index < points.length; index += 1) {
        const share = index / points.length
        g.moveTo(points[index - 1].x, points[index - 1].y).lineTo(points[index].x, points[index].y)
          .stroke({ width: 1 + share * 2.5, color, alpha: 0.12 + share * 0.5, cap: 'round' })
      }
    }
    const ownMissiles: DrawSummary['ownMissiles'][number][] = []
    for (const missile of scene.ownMissiles) {
      const at = toScreen(transform, missile.position)
      trail(missile.trail, at, PLOT_COLOURS.command)
      const aimRect = cellRect(transform, missile.aim)
      const aim = { x: aimRect.x + aimRect.size / 2, y: aimRect.y + aimRect.size / 2 }
      for (const [a, b] of dashPolyline([at, aim], 4, 5)) g.moveTo(a.x, a.y).lineTo(b.x, b.y)
      g.stroke({ width: 1.25, color: PLOT_COLOURS.command, alpha: 0.7 })
      g.moveTo(aim.x - 4, aim.y - 4).lineTo(aim.x + 4, aim.y + 4).moveTo(aim.x + 4, aim.y - 4).lineTo(aim.x - 4, aim.y + 4)
        .stroke({ width: 1.5, color: PLOT_COLOURS.command })
      g.poly(triangle(at, Math.atan2(aim.y - at.y, aim.x - at.x)), true).fill({ color: PLOT_COLOURS.command }).stroke({ width: 1, color: PLOT_COLOURS.commandInk })
      labels.reserve(at.x, at.y, size * 1.4)
      labels.around(`own-missile:${missile.id}`, 'Own missile', PLOT_COLOURS.command, 70, at, size * 1.4, [5, 7, 0, 1])
      ownMissiles.push({ id: missile.id, at })
    }

    const hostileMissiles: DrawSummary['hostileMissiles'][number][] = []
    for (const missile of scene.hostileMissiles) {
      const at = toScreen(transform, missile.position)
      const radiusPx = missile.uncertaintyRadiusUnits * transform.scale
      if (missile.kind === 'current') trail(missile.trail, at, PLOT_COLOURS.hostile)
      if (missile.kind === 'stale' && radiusPx > 0) {
        const u = this.layers.uncertainty
        for (const [start, end] of dashCircle(radiusPx, 4, 5)) {
          const mid = (start + end) / 2
          if (!insideBounds(bounds, at.x + Math.cos(mid) * radiusPx, at.y + Math.sin(mid) * radiusPx)) continue
          u.moveTo(at.x + Math.cos(start) * radiusPx, at.y + Math.sin(start) * radiusPx).arc(at.x, at.y, radiusPx, start, end)
        }
        u.stroke({ width: 1.25, color: PLOT_COLOURS.hostile, alpha: 0.6 })
      }
      // Hostile missile: a hollow triangle pointing up (no aim is known). Stale outline is dashed.
      const outline = triangle(at, -Math.PI / 2)
      const points = [{ x: outline[0], y: outline[1] }, { x: outline[2], y: outline[3] }, { x: outline[4], y: outline[5] }]
      if (missile.kind === 'current') g.poly(outline, true).fill({ color: PLOT_COLOURS.hostile, alpha: 0.35 }).stroke({ width: 2, color: PLOT_COLOURS.hostile })
      else {
        for (const [a, b] of dashPolyline([...points, points[0]], 3, 3)) g.moveTo(a.x, a.y).lineTo(b.x, b.y)
        g.stroke({ width: 2, color: PLOT_COLOURS.hostile })
      }
      const label = missile.kind === 'current' ? `${missile.alias} (hostile missile)` : `${missile.alias} (last seen, ${((missile.ageTicks * tickMs) / 1000).toFixed(1)} s ago)`
      labels.reserve(at.x, at.y, size * 1.4)
      labels.around(`hostile-missile:${missile.alias}`, label, PLOT_COLOURS.hostile, 75, at, size * 1.4, [4, 6, 0, 1])
      hostileMissiles.push({ alias: missile.alias, kind: missile.kind, at, radiusPx })
    }

    return { ownMissiles, hostileMissiles }
  }

  private drawContacts(contacts: readonly PlotContact[], transform: PlotTransform, labels: TacticalLabels, tickMs: number) {
    const g = this.layers.contacts.clear()
    const size = Math.max(7, transform.cellPx * 0.3)
    const bounds = mapBounds(transform)
    const inside = (x: number, y: number) => insideBounds(bounds, x, y)
    const drawn: DrawSummary['contacts'][number][] = []

    for (const contact of contacts) {
      const at = toScreen(transform, contact.position)
      const radiusPx = contact.uncertaintyRadiusUnits * transform.scale

      // Uncertainty region exactly as published, clipped to the public map, on the layer under
      // plans and markers. Only a compact region is tinted; a large one is outline only, so it
      // keeps its meaning without washing over terrain and markers.
      const filled = contact.kind === 'stale' && radiusPx > 0 && radiusPx <= transform.cellPx * UNCERTAINTY_FILL_CELLS
      if (contact.kind === 'stale' && radiusPx > 0) {
        const u = this.layers.uncertainty
        if (filled) {
          const outline: number[] = []
          for (let k = 0; k < 64; k += 1) {
            const angle = (k / 64) * Math.PI * 2
            outline.push(
              Math.min(bounds.right, Math.max(bounds.left, at.x + Math.cos(angle) * radiusPx)),
              Math.min(bounds.bottom, Math.max(bounds.top, at.y + Math.sin(angle) * radiusPx)),
            )
          }
          u.poly(outline, true).fill({ color: PLOT_COLOURS.hostile, alpha: 0.08 })
        }
        for (const [start, end] of dashCircle(radiusPx, 5, 6)) {
          const mid = (start + end) / 2
          if (!inside(at.x + Math.cos(mid) * radiusPx, at.y + Math.sin(mid) * radiusPx)) continue
          u.moveTo(at.x + Math.cos(start) * radiusPx, at.y + Math.sin(start) * radiusPx).arc(at.x, at.y, radiusPx, start, end)
        }
        u.stroke({ width: filled ? 1.5 : 1.25, color: PLOT_COLOURS.hostile, alpha: filled ? 0.75 : 0.55 })
      }

      // Hostile symbol: a diamond. Current = solid outline with fill; stale = dashed outline only.
      const diamond = [
        { x: at.x, y: at.y - size }, { x: at.x + size, y: at.y }, { x: at.x, y: at.y + size }, { x: at.x - size, y: at.y },
      ]
      if (contact.kind === 'current') {
        g.poly(diamond.flatMap((p) => [p.x, p.y]), true).fill({ color: PLOT_COLOURS.hostile, alpha: 0.3 })
          .stroke({ width: 2, color: PLOT_COLOURS.hostile })
        if (contact.velocity) {
          // Speed leader: two seconds of the measured velocity, drawn from the measured position.
          const leaderTicks = 20
          const tip = toScreen(transform, {
            x: contact.position.x + contact.velocity.xUnitsPerTick * leaderTicks,
            y: contact.position.y + contact.velocity.yUnitsPerTick * leaderTicks,
          })
          g.moveTo(at.x, at.y).lineTo(tip.x, tip.y).stroke({ width: 1.5, color: PLOT_COLOURS.hostile, alpha: 0.9 })
        }
      } else {
        for (const [a, b] of dashPolyline([...diamond, diamond[0]], 4, 3)) g.moveTo(a.x, a.y).lineTo(b.x, b.y)
        g.stroke({ width: 2, color: PLOT_COLOURS.hostile })
      }
      if (contact.destroyed) {
        g.moveTo(at.x - size, at.y - size).lineTo(at.x + size, at.y + size)
          .moveTo(at.x + size, at.y - size).lineTo(at.x - size, at.y + size)
          .stroke({ width: 2, color: PLOT_COLOURS.ink })
      }
      if (contact.selected) {
        // Selection: corner brackets, a shape cue independent of colour and contact state.
        const r = size + 6
        const arm = Math.max(4, size * 0.6)
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
          g.moveTo(at.x + sx * r, at.y + sy * (r - arm)).lineTo(at.x + sx * r, at.y + sy * r).lineTo(at.x + sx * (r - arm), at.y + sy * r)
        }
        g.stroke({ width: 2, color: PLOT_COLOURS.ink, join: 'miter' })
      }

      const status = contact.destroyed ? 'destroyed'
        : contact.kind === 'current' ? 'current'
          : `last known, ${((contact.ageTicks * tickMs) / 1000).toFixed(1)} s ago`
      const label = `${contact.alias} (${status})`
      labels.reserve(at.x, at.y, size + (contact.selected ? 6 : 0))
      labels.around(`contact:${contact.alias}`, label, PLOT_COLOURS.hostile, 80, at, size + (contact.selected ? 6 : 0), [4, 6, 0, 1])
      drawn.push({ alias: contact.alias, kind: contact.kind, at, radiusPx, filled, selected: contact.selected, label })
    }
    return drawn
  }

  private drawShip(scene: PlotScene, transform: PlotTransform, labels: TacticalLabels): { at: ScreenPoint; state: DrawSummary['ownState'] } {
    const g = this.layers.ship.clear()
    const at = toScreen(transform, scene.ownShip.position)
    const length = Math.max(18, transform.cellPx * 0.9)
    const rotation = headingToRotation(scene.ownShip.headingMilliDegrees)
    const rotate = (x: number, y: number) => ({
      x: at.x + x * Math.cos(rotation) - y * Math.sin(rotation),
      y: at.y + x * Math.sin(rotation) + y * Math.cos(rotation),
    })
    // Shadow-Dancer: a swept-wing hull pointing along the heading (screen-up before rotation).
    const L = length
    const hull = [
      rotate(0, -L * 0.62), rotate(L * 0.14, -L * 0.2), rotate(L * 0.46, L * 0.34), rotate(L * 0.2, L * 0.26),
      rotate(L * 0.12, L * 0.44), rotate(-L * 0.12, L * 0.44), rotate(-L * 0.2, L * 0.26), rotate(-L * 0.46, L * 0.34), rotate(-L * 0.14, -L * 0.2),
    ]
    const points = hull.flatMap((p) => [p.x, p.y])
    if (scene.ownShip.destroyed) {
      g.poly(points, true).stroke({ width: 2, color: PLOT_COLOURS.command, alpha: 0.8 })
      g.moveTo(at.x - L / 2, at.y - L / 2).lineTo(at.x + L / 2, at.y + L / 2)
        .moveTo(at.x + L / 2, at.y - L / 2).lineTo(at.x - L / 2, at.y + L / 2)
        .stroke({ width: 2, color: PLOT_COLOURS.ink })
      return { at, state: 'destroyed' }
    }
    // Ring marks the hull extent so the ship never reads as the arrowhead of its own trail.
    // Cloaked: dashed ring plus a label; exposed: labelled. Both read without colour.
    const { cloaked, exposed, shieldFraction, moving } = scene.ownShip
    const radius = L * 0.62
    // Shield bubble: an outer sea-glass ring whose strength follows the shields at this frame.
    if (shieldFraction > 0) {
      const shield = radius + 4
      g.circle(at.x, at.y, shield).fill({ color: PLOT_COLOURS.sonar, alpha: 0.04 + shieldFraction * 0.08 })
        .stroke({ width: 1 + shieldFraction * 1.5, color: PLOT_COLOURS.sonar, alpha: 0.25 + shieldFraction * 0.5 })
    }
    if (cloaked) {
      for (const [start, end] of dashCircle(radius, 4, 4)) g.moveTo(at.x + Math.cos(start) * radius, at.y + Math.sin(start) * radius).arc(at.x, at.y, radius, start, end)
      g.stroke({ width: 1.5, color: PLOT_COLOURS.command, alpha: 0.9 })
    } else {
      g.circle(at.x, at.y, radius).stroke({ width: 1.5, color: PLOT_COLOURS.command, alpha: 0.9 })
    }
    if (moving) {
      // Engine glow and exhaust while the ship moves.
      const exhaust = [rotate(-L * 0.1, L * 0.44), rotate(0, L * 0.86), rotate(L * 0.1, L * 0.44)].flatMap((p) => [p.x, p.y])
      g.poly(exhaust, true).fill({ color: PLOT_COLOURS.command, alpha: 0.32 })
      for (const side of [-1, 1]) {
        const nozzle = rotate(side * L * 0.07, L * 0.46)
        g.circle(nozzle.x, nozzle.y, L * 0.06).fill({ color: PLOT_COLOURS.ink, alpha: 0.85 })
      }
    }
    g.poly(points, true).fill({ color: PLOT_COLOURS.command }).stroke({ width: 1.5, color: PLOT_COLOURS.commandInk })
    const cockpit = [rotate(0, -L * 0.36), rotate(L * 0.07, -L * 0.12), rotate(-L * 0.07, -L * 0.12)].flatMap((p) => [p.x, p.y])
    g.poly(cockpit, true).fill({ color: PLOT_COLOURS.commandInk, alpha: 0.85 })
    const state = cloaked ? 'cloaked' : exposed ? 'exposed' : 'plain'
    labels.reserve(at.x, at.y, radius)
    if (state !== 'plain') labels.around('own-state', cloaked ? 'Cloaked' : 'Exposed', PLOT_COLOURS.command, 90, at, radius, [3, 2, 0, 1])
    return { at, state }
  }

  /**
   * Combat marks from recorded events through the shown tick: beams, confirmed hits, unconfirmed
   * impacts, own shield/hull hits with their exact losses, explosions and scans. Ages are ticks
   * after the event; under reduced motion shapes keep their size and only fade.
   */
  private drawEffects(scene: PlotScene, transform: PlotTransform, labels: TacticalLabels): string[] {
    const g = this.layers.effects.clear()
    const still = this.frame?.reducedMotion === true
    const cell = transform.cellPx
    const drawn: string[] = []
    const rays = (at: ScreenPoint, inner: number, outer: number, count: number, color: number, alpha: number, width: number) => {
      for (let k = 0; k < count; k += 1) {
        const angle = (k / count) * Math.PI * 2 + 0.2
        const length = k % 2 === 0 ? outer : outer * 0.7
        g.moveTo(at.x + Math.cos(angle) * inner, at.y + Math.sin(angle) * inner).lineTo(at.x + Math.cos(angle) * length, at.y + Math.sin(angle) * length)
      }
      g.stroke({ width, color, alpha, cap: 'round' })
    }
    for (const effect of scene.effects) {
      // Each mark's label is keyed by its own published tick, so a newer event never overwrites
      // an older one's text (or the reverse); newer marks get the higher label priority.
      const eventTick = scene.tick - effect.ageTicks
      const recency = -effect.ageTicks * 0.01
      const progress = effect.ageTicks / effect.durationTicks
      const fade = Math.max(0.15, 1 - progress)
      const grow = still ? 0.5 : progress
      drawn.push(effectName(effect))
      switch (effect.kind) {
        case 'beam': {
          const from = toScreen(transform, effect.from)
          const to = toScreen(transform, effect.to)
          const color = effect.own ? PLOT_COLOURS.command : PLOT_COLOURS.hostile
          g.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ width: 10, color, alpha: 0.16 * fade, cap: 'round' })
          g.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ width: effect.own ? 3 : 4, color, alpha: fade, cap: 'round' })
          // An enemy beam is hollow (dark core), so own and hostile fire differ without colour.
          if (!effect.own) g.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ width: 1.2, color: PLOT_COLOURS.well, alpha: fade })
          if (effect.ageTicks < 4) g.circle(from.x, from.y, cell * 0.22).fill({ color, alpha: 0.5 * fade })
          break
        }
        case 'hit': {
          // Confirmed hit on a named contact: starburst, ring and a plain label.
          const at = toScreen(transform, effect.at)
          const ring = cell * (0.45 + grow * 0.6)
          g.circle(at.x, at.y, ring).stroke({ width: 3, color: PLOT_COLOURS.ink, alpha: fade })
          if (effect.radiusUnits > 0) g.circle(at.x, at.y, effect.radiusUnits * transform.scale).stroke({ width: 1.5, color: PLOT_COLOURS.command, alpha: 0.8 * fade })
          rays(at, cell * 0.25, cell * (0.75 + grow * 0.35), 10, PLOT_COLOURS.command, fade, 2.5)
          if (effect.ageTicks < effect.durationTicks * 0.8) {
            labels.around(`hit@${eventTick}:${effect.alias}`, `Hit: ${effect.alias}${effect.weapon === 'missile' ? ' (missile)' : ''}`, PLOT_COLOURS.ink, 88 + recency, at, ring + 2, [2, 4, 6, 0, 1])
          }
          break
        }
        case 'impact': {
          // An explosion with no ship named: shown as such, damage unconfirmed.
          const at = toScreen(transform, effect.at)
          const radius = Math.max(cell * 0.3, effect.radiusUnits * transform.scale)
          for (const [start, end] of dashCircle(radius, 5, 4)) g.moveTo(at.x + Math.cos(start) * radius, at.y + Math.sin(start) * radius).arc(at.x, at.y, radius, start, end)
          g.stroke({ width: 2, color: PLOT_COLOURS.ink, alpha: fade })
          rays(at, radius * 0.25, radius * (0.6 + grow * 0.3), 6, PLOT_COLOURS.ink, 0.8 * fade, 1.5)
          if (effect.ageTicks < effect.durationTicks * 0.8) labels.around(`impact@${eventTick}:${Math.round(at.x)},${Math.round(at.y)}`, 'Impact: damage unconfirmed', PLOT_COLOURS.ink, 40 + recency, at, radius, [2, 3, 0, 1])
          break
        }
        case 'own-hit': {
          const at = toScreen(transform, effect.at)
          const base = Math.max(18, cell * 0.9) * 0.62
          if (effect.shieldsLost > 0) {
            // Shield flare: a bright broken sea-glass ring just outside the hull.
            const shield = base + 5 + grow * 6
            for (const [start, end] of dashCircle(shield, 9, 3)) g.moveTo(at.x + Math.cos(start) * shield, at.y + Math.sin(start) * shield).arc(at.x, at.y, shield, start, end)
            g.stroke({ width: 4, color: PLOT_COLOURS.sonar, alpha: fade })
            g.circle(at.x, at.y, shield).fill({ color: PLOT_COLOURS.sonar, alpha: 0.12 * fade })
          }
          if (effect.hullLost > 0) {
            // Hull damage: a jagged coral burst and sparks on the hull itself.
            const jag: number[] = []
            for (let k = 0; k < 16; k += 1) {
              const angle = (k / 16) * Math.PI * 2
              const r = base * (k % 2 === 0 ? 1.15 : 0.8) + grow * 4
              jag.push(at.x + Math.cos(angle) * r, at.y + Math.sin(angle) * r)
            }
            g.poly(jag, true).stroke({ width: 2.5, color: PLOT_COLOURS.hostile, alpha: fade })
            rays(at, base * 0.4, base * 1.35, 8, PLOT_COLOURS.ink, 0.9 * fade, 1.5)
          }
          const parts = [effect.shieldsLost > 0 ? `−${effect.shieldsLost} shields` : '', effect.hullLost > 0 ? `−${effect.hullLost} hull` : ''].filter(Boolean)
          const lift = still ? 0 : Math.min(14, effect.ageTicks * 0.6)
          labels.around(`own-hit@${eventTick}`, `Hit ${parts.join(', ')}`, PLOT_COLOURS.ink, 95 + recency, { x: at.x, y: at.y - lift }, base + 10, [2, 4, 6, 0, 1])
          break
        }
        case 'launch': {
          const at = toScreen(transform, effect.at)
          const color = effect.own ? PLOT_COLOURS.command : PLOT_COLOURS.hostile
          g.circle(at.x, at.y, cell * (0.25 + grow * 0.35)).stroke({ width: 2, color, alpha: fade })
          break
        }
        case 'destroyed': {
          // Explosion at the published position: rings, rays and debris.
          const at = toScreen(transform, effect.at)
          const color = effect.own ? PLOT_COLOURS.command : PLOT_COLOURS.hostile
          for (let ring = 0; ring < 3; ring += 1) {
            g.circle(at.x, at.y, cell * (0.35 + ring * 0.3 + grow * 0.8)).stroke({ width: 3 - ring, color: ring === 0 ? PLOT_COLOURS.ink : color, alpha: fade * (1 - ring * 0.25) })
          }
          rays(at, cell * 0.3, cell * (1 + grow * 0.7), 14, color, fade, 2)
          for (let k = 0; k < 10; k += 1) {
            const angle = (k / 10) * Math.PI * 2 + 0.5
            const distance = cell * (0.5 + grow * 1.2) * (0.6 + (k % 3) * 0.2)
            g.circle(at.x + Math.cos(angle) * distance, at.y + Math.sin(angle) * distance, 2).fill({ color: PLOT_COLOURS.ink, alpha: fade })
          }
          labels.around(effect.own ? 'destroyed-own' : `destroyed:${effect.alias}`, effect.own ? 'Shadow-Dancer destroyed' : `${effect.alias} destroyed`, PLOT_COLOURS.ink, 92, at, cell * 1.1, [2, 3, 0, 1])
          break
        }
        case 'scan': {
          // Active pulse: a sea-glass sweep out to tracking reach.
          const at = toScreen(transform, effect.at)
          const reach = effect.radiusUnits * transform.scale
          const radius = still ? reach : Math.max(cell * 0.6, reach * Math.min(1, progress * 1.6))
          g.circle(at.x, at.y, radius).stroke({ width: 3, color: PLOT_COLOURS.sonar, alpha: 0.8 * fade })
          if (!still && radius > cell * 2) g.circle(at.x, at.y, radius * 0.82).stroke({ width: 1.5, color: PLOT_COLOURS.sonar, alpha: 0.4 * fade })
          break
        }
      }
    }
    return drawn
  }

  private drawHover() {
    const g = this.layers.hover.clear()
    if (!this.transform || !this.hoverCell || !this.frame?.selectable) return
    const rect = cellRect(this.transform, this.hoverCell)
    if (this.frame.pointerMode === 'aim') {
      // Aiming: a ringed X like the aim mark, never the destination square.
      const centre = { x: rect.x + rect.size / 2, y: rect.y + rect.size / 2 }
      const r = rect.size * 0.32
      g.circle(centre.x, centre.y, r).moveTo(centre.x - r, centre.y - r).lineTo(centre.x + r, centre.y + r)
        .moveTo(centre.x + r, centre.y - r).lineTo(centre.x - r, centre.y + r).stroke({ width: 1.5, color: PLOT_COLOURS.ink, alpha: 0.9 })
      return
    }
    g.rect(rect.x + 1, rect.y + 1, rect.size - 2, rect.size - 2).stroke({ width: 1.5, color: PLOT_COLOURS.ink, alpha: 0.8 })
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (!this.transform) return
    const cell = cellAtScreen(this.transform, event.offsetX, event.offsetY)
    if (cell?.column === this.hoverCell?.column && cell?.row === this.hoverCell?.row) return
    this.hoverCell = cell
    this.drawHover()
    this.app?.render()
    this.callbacks.onHoverCell(cell)
  }

  private readonly handlePointerLeave = () => {
    if (!this.hoverCell) return
    this.hoverCell = null
    this.drawHover()
    this.app?.render()
    this.callbacks.onHoverCell(null)
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !this.transform || !this.frame?.selectable) return
    const cell = cellAtScreen(this.transform, event.offsetX, event.offsetY)
    if (cell) this.callbacks.onSelectCell(cell)
  }
}

/** Diagnostic name of a plot effect, for browser checks of what is drawn. */
function effectName(effect: PlotEffect): string {
  switch (effect.kind) {
    case 'beam': return effect.own ? 'own-beam' : 'hostile-beam'
    case 'hit': return `hit-${effect.weapon}`
    case 'impact': return `impact-${effect.weapon}`
    case 'launch': return effect.own ? 'own-launch' : 'hostile-launch'
    case 'destroyed': return effect.own ? 'own-destroyed' : 'destroyed'
    default: return effect.kind
  }
}
