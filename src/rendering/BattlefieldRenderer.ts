import { Application, Container, Graphics, Text, type TextStyleOptions } from 'pixi.js'
import type { Cell, Position, PublicMap } from '../contracts'
import { dashCircle, dashPolyline } from './dashes'
import { PLOT_COLOURS, PLOT_FONT } from './plotPalette'
import {
  cellAtScreen, cellRect, fitPlot, headingToRotation, toScreen, type PlotTransform, type ScreenPoint,
} from './plotGeometry'
import {
  EFFECT_TICKS, interpolateScene, splitPathAt, type PlotContact, type PlotScene, type PlotSensorRing,
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
}

/** Observable lifecycle and last-drawn summary, for browser checks of cleanup and fog-of-war. */
export interface RendererDiagnostics {
  readonly created: number
  readonly destroyed: number
  readonly live: number
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
  readonly contacts: readonly { readonly alias: string; readonly kind: string; readonly at: ScreenPoint; readonly radiusPx: number; readonly selected: boolean; readonly label: string }[]
}

const counters = { created: 0, destroyed: 0 }
let lastSummary: DrawSummary | null = null

export function rendererDiagnostics(): RendererDiagnostics {
  return { ...counters, live: counters.created - counters.destroyed, last: lastSummary }
}

const RING_STYLE: Record<PlotSensorRing['kind'], { dash: number; gap: number; width: number; alpha: number; label: string }> = {
  passive: { dash: 2, gap: 6, width: 1.25, alpha: 0.55, label: 'Passive reach (nominal)' },
  tracking: { dash: 8, gap: 4, width: 1.75, alpha: 0.9, label: 'Tracking reach (nominal)' },
  'pulse-preview': { dash: 5, gap: 6, width: 1.5, alpha: 0.7, label: 'Pulse reach if funded' },
}

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
  private used = new Set<string>()
  constructor(private readonly layer: Container) {}

  begin() { this.used = new Set() }

  place(key: string, text: string, x: number, y: number, fill: number, anchorX = 0, anchorY = 0.5) {
    let label = this.labels.get(key)
    if (!label) {
      label = new Text({ text, style: { ...LABEL_STYLE, fill } })
      this.labels.set(key, label)
      this.layer.addChild(label)
    }
    if (label.text !== text) label.text = text
    label.style.fill = fill
    label.anchor.set(anchorX, anchorY)
    label.position.set(Math.round(x), Math.round(y))
    label.visible = true
    this.used.add(key)
  }

  end() {
    for (const [key, label] of this.labels) {
      if (!this.used.has(key)) {
        label.destroy()
        this.labels.delete(key)
      }
    }
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
    contacts: new Graphics(),
    ordnance: new Graphics(),
    ship: new Graphics(),
    hover: new Graphics(),
    labels: new Container(),
  }
  private terrainLabels: LabelPool | null = null
  private labels: LabelPool | null = null

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
    const { terrain, terrainLabels, sensors, plan, contacts, ordnance, ship, hover, labels } = this.layers
    app.stage.addChild(terrain, terrainLabels, sensors, plan, contacts, ordnance, hover, ship, labels)
    this.terrainLabels = new LabelPool(terrainLabels)
    this.labels = new LabelPool(labels)

    canvas.addEventListener('pointermove', this.handlePointerMove)
    canvas.addEventListener('pointerleave', this.handlePointerLeave)
    canvas.addEventListener('pointerdown', this.handlePointerDown)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(host)
    this.resize()
    return true
  }

  update(frame: RendererFrame) {
    const terrainChanged = this.frame?.map !== frame.map || this.frame?.unitsPerCell !== frame.unitsPerCell
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

    for (let column = 0; column <= columns; column += 1) {
      const x = originX + column * cellPx
      g.moveTo(x, originY).lineTo(x, originY + height)
    }
    for (let row = 0; row <= rows; row += 1) {
      const y = originY + row * cellPx
      g.moveTo(originX, y).lineTo(originX + width, y)
    }
    g.stroke({ width: 1, color: PLOT_COLOURS.grid, pixelLine: true })
    for (let index = 5; index < Math.max(columns, rows); index += 5) {
      if (index < columns) g.moveTo(originX + index * cellPx, originY).lineTo(originX + index * cellPx, originY + height)
      if (index < rows) g.moveTo(originX, originY + index * cellPx).lineTo(originX + width, originY + index * cellPx)
    }
    g.stroke({ width: 1, color: PLOT_COLOURS.gridMajor, pixelLine: true })

    // Asteroids: solid fill plus diagonal hatching, so obstacles read without colour.
    for (const cell of frame.map.asteroidCells) {
      const rect = cellRect(transform, cell)
      g.rect(rect.x, rect.y, rect.size, rect.size).fill({ color: PLOT_COLOURS.asteroidFill })
      for (let k = 1; k <= 3; k += 1) {
        const offset = (rect.size * k) / 4
        g.moveTo(rect.x + offset, rect.y).lineTo(rect.x, rect.y + offset)
        g.moveTo(rect.x + rect.size, rect.y + offset).lineTo(rect.x + offset, rect.y + rect.size)
      }
      g.stroke({ width: 1, color: PLOT_COLOURS.asteroidHatch, alpha: 0.7 })
      g.rect(rect.x, rect.y, rect.size, rect.size).stroke({ width: 1, color: PLOT_COLOURS.edge, alignment: 1 })
    }
    g.rect(originX, originY, width, height).stroke({ width: 1, color: PLOT_COLOURS.edge, alignment: 0 })

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
    const sensorRings = this.drawSensorRings(scene, transform, labels)
    this.drawPlan(scene, transform, labels)
    const contacts = this.drawContacts(scene.contacts, transform, labels, this.frame?.tickMs ?? 100)
    const ordnance = this.drawOrdnance(scene, transform, labels, this.frame?.tickMs ?? 100)
    const { at: ship, state: ownState } = this.drawShip(scene, transform, labels)
    labels.end()
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
    }
  }

  /** Own sensor reach as dotted/dashed sea-glass rings, clipped to the public map. */
  private drawSensorRings(scene: PlotScene, transform: PlotTransform, labels: LabelPool) {
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
      const spot = spots.find((candidate) => insideBounds(bounds, candidate.x, candidate.y))
      if (spot) labels.place(`ring:${ring.kind}`, style.label, spot.x, spot.y, PLOT_COLOURS.sonar, spot.ax)
      drawn.push({ kind: ring.kind, radiusPx })
    }
    return drawn
  }

  private drawPlan(scene: PlotScene, transform: PlotTransform, labels: LabelPool) {
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
    labels.place('destination', 'Destination', destination.x + destination.size + 4, centre.y, PLOT_COLOURS.command)

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
      labels.place('nominal', 'Reached this turn (predicted)', destination.x + destination.size + 4, centre.y + 15, PLOT_COLOURS.command)
      return
    }
    g.circle(nominal.x, nominal.y, 5).fill({ color: PLOT_COLOURS.well }).stroke({ width: 2, color: PLOT_COLOURS.command })
    labels.place('nominal', 'Turn end (predicted)', nominal.x + 9, nominal.y + 12, PLOT_COLOURS.command)
  }

  /** Intended weapon use: laser line and range to its target alias, or missile line, aim mark and blast. */
  private drawWeaponPlan(
    scene: PlotScene, transform: PlotTransform, labels: LabelPool,
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
      if (spot) labels.place('laser-range', 'Laser range', spot.x, spot.y, PLOT_COLOURS.command, 0.5)
      if (weapon.target) {
        const to = toScreen(transform, weapon.target)
        // Current lock: long dashes; last sighting: short dots (it may never fire).
        strokeDashes([from, to], weapon.current ? 10 : 3, weapon.current ? 5 : 5, 2, 0.95)
        labels.place('laser-target', weapon.current ? 'Laser target' : 'Laser target (needs a new lock)', (from.x + to.x) / 2 + 6, (from.y + to.y) / 2 - 10, PLOT_COLOURS.command)
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
    labels.place('missile-aim', 'Missile aim', centre.x + r + 6, centre.y - r - 4, PLOT_COLOURS.command)
  }

  /** Own missile telemetry, observed hostile ordnance and recent recorded shot/impact marks. */
  private drawOrdnance(scene: PlotScene, transform: PlotTransform, labels: LabelPool, tickMs: number) {
    const g = this.layers.ordnance.clear()
    const size = Math.max(5, transform.cellPx * 0.18)
    const bounds = mapBounds(transform)
    const triangle = (at: ScreenPoint, angle: number) => {
      const point = (a: number, r: number) => [at.x + Math.cos(angle + a) * r, at.y + Math.sin(angle + a) * r]
      return [...point(0, size * 1.4), ...point(2.5, size), ...point(-2.5, size)]
    }
    const ownMissiles: DrawSummary['ownMissiles'][number][] = []
    for (const missile of scene.ownMissiles) {
      const at = toScreen(transform, missile.position)
      const aimRect = cellRect(transform, missile.aim)
      const aim = { x: aimRect.x + aimRect.size / 2, y: aimRect.y + aimRect.size / 2 }
      for (const [a, b] of dashPolyline([at, aim], 4, 5)) g.moveTo(a.x, a.y).lineTo(b.x, b.y)
      g.stroke({ width: 1.25, color: PLOT_COLOURS.command, alpha: 0.7 })
      g.moveTo(aim.x - 4, aim.y - 4).lineTo(aim.x + 4, aim.y + 4).moveTo(aim.x + 4, aim.y - 4).lineTo(aim.x - 4, aim.y + 4)
        .stroke({ width: 1.5, color: PLOT_COLOURS.command })
      g.poly(triangle(at, Math.atan2(aim.y - at.y, aim.x - at.x)), true).fill({ color: PLOT_COLOURS.command }).stroke({ width: 1, color: PLOT_COLOURS.commandInk })
      labels.place(`own-missile:${missile.id}`, 'Own missile', at.x + size + 6, at.y + size + 4, PLOT_COLOURS.command)
      ownMissiles.push({ id: missile.id, at })
    }

    const hostileMissiles: DrawSummary['hostileMissiles'][number][] = []
    for (const missile of scene.hostileMissiles) {
      const at = toScreen(transform, missile.position)
      const radiusPx = missile.uncertaintyRadiusUnits * transform.scale
      if (missile.kind === 'stale' && radiusPx > 0) {
        for (const [start, end] of dashCircle(radiusPx, 4, 5)) {
          const mid = (start + end) / 2
          if (!insideBounds(bounds, at.x + Math.cos(mid) * radiusPx, at.y + Math.sin(mid) * radiusPx)) continue
          g.moveTo(at.x + Math.cos(start) * radiusPx, at.y + Math.sin(start) * radiusPx).arc(at.x, at.y, radiusPx, start, end)
        }
        g.stroke({ width: 1.25, color: PLOT_COLOURS.hostile, alpha: 0.7 })
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
      labels.place(`hostile-missile:${missile.alias}`, label, at.x + size + 6, at.y - size - 2, PLOT_COLOURS.hostile)
      hostileMissiles.push({ alias: missile.alias, kind: missile.kind, at, radiusPx })
    }

    const effects: string[] = []
    for (const effect of scene.effects) {
      const alpha = Math.max(0.25, 1 - effect.ageTicks / EFFECT_TICKS)
      if (effect.kind === 'beam') {
        const from = toScreen(transform, effect.from)
        const to = toScreen(transform, effect.to)
        // Own beam: solid amber; hostile beam: coral with a centre line, so both read without colour.
        g.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ width: effect.own ? 3 : 4, color: effect.own ? PLOT_COLOURS.command : PLOT_COLOURS.hostile, alpha })
        if (!effect.own) g.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ width: 1, color: PLOT_COLOURS.well, alpha })
        effects.push(effect.own ? 'own-beam' : 'hostile-beam')
      } else if (effect.kind === 'impact') {
        const at = toScreen(transform, effect.at)
        const radius = Math.max(6, effect.radiusUnits * transform.scale)
        g.circle(at.x, at.y, radius).stroke({ width: 2, color: PLOT_COLOURS.ink, alpha })
        for (let k = 0; k < 8; k += 1) {
          const angle = (k / 8) * Math.PI * 2
          g.moveTo(at.x + Math.cos(angle) * radius * 0.4, at.y + Math.sin(angle) * radius * 0.4).lineTo(at.x + Math.cos(angle) * radius * 0.9, at.y + Math.sin(angle) * radius * 0.9)
        }
        g.stroke({ width: 1.5, color: PLOT_COLOURS.ink, alpha })
        effects.push(`impact-${effect.weapon}`)
      } else if (effect.kind === 'own-hit') {
        const at = toScreen(transform, effect.at)
        const radius = Math.max(16, transform.cellPx * 0.8)
        for (const [start, end] of dashCircle(radius, 6, 4)) g.moveTo(at.x + Math.cos(start) * radius, at.y + Math.sin(start) * radius).arc(at.x, at.y, radius, start, end)
        g.stroke({ width: 2.5, color: PLOT_COLOURS.ink, alpha })
        labels.place('own-hit', 'Hit', at.x + radius + 4, at.y - radius, PLOT_COLOURS.ink)
        effects.push('own-hit')
      } else {
        const at = toScreen(transform, effect.at)
        g.circle(at.x, at.y, Math.max(6, size * 1.5)).stroke({ width: 1.5, color: effect.own ? PLOT_COLOURS.command : PLOT_COLOURS.hostile, alpha })
        effects.push(effect.own ? 'own-launch' : 'hostile-launch')
      }
    }
    return { ownMissiles, hostileMissiles, effects }
  }

  private drawContacts(contacts: readonly PlotContact[], transform: PlotTransform, labels: LabelPool, tickMs: number) {
    const g = this.layers.contacts.clear()
    const size = Math.max(7, transform.cellPx * 0.3)
    const bounds = mapBounds(transform)
    const inside = (x: number, y: number) => insideBounds(bounds, x, y)
    const drawn: DrawSummary['contacts'][number][] = []

    for (const contact of contacts) {
      const at = toScreen(transform, contact.position)
      const radiusPx = contact.uncertaintyRadiusUnits * transform.scale

      if (contact.kind === 'stale' && radiusPx > 0) {
        // Uncertainty region exactly as published, clipped to the public map bounds.
        const outline: number[] = []
        for (let k = 0; k < 64; k += 1) {
          const angle = (k / 64) * Math.PI * 2
          outline.push(
            Math.min(bounds.right, Math.max(bounds.left, at.x + Math.cos(angle) * radiusPx)),
            Math.min(bounds.bottom, Math.max(bounds.top, at.y + Math.sin(angle) * radiusPx)),
          )
        }
        g.poly(outline, true).fill({ color: PLOT_COLOURS.hostile, alpha: 0.07 })
        for (const [start, end] of dashCircle(radiusPx, 5, 6)) {
          const mid = (start + end) / 2
          if (!inside(at.x + Math.cos(mid) * radiusPx, at.y + Math.sin(mid) * radiusPx)) continue
          g.moveTo(at.x + Math.cos(start) * radiusPx, at.y + Math.sin(start) * radiusPx).arc(at.x, at.y, radiusPx, start, end)
        }
        g.stroke({ width: 1.5, color: PLOT_COLOURS.hostile, alpha: 0.75 })
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
      labels.place(`contact:${contact.alias}`, label, at.x + size + 5, at.y - size - 2, PLOT_COLOURS.hostile)
      drawn.push({ alias: contact.alias, kind: contact.kind, at, radiusPx, selected: contact.selected, label })
    }
    return drawn
  }

  private drawShip(scene: PlotScene, transform: PlotTransform, labels: LabelPool): { at: ScreenPoint; state: DrawSummary['ownState'] } {
    const g = this.layers.ship.clear()
    const at = toScreen(transform, scene.ownShip.position)
    const length = Math.max(18, transform.cellPx * 0.9)
    const rotation = headingToRotation(scene.ownShip.headingMilliDegrees)
    const rotate = (x: number, y: number) => ({
      x: at.x + x * Math.cos(rotation) - y * Math.sin(rotation),
      y: at.y + x * Math.sin(rotation) + y * Math.cos(rotation),
    })
    // Chevron pointing along the heading (screen-up before rotation).
    const outline = [rotate(0, -length * 0.55), rotate(length * 0.38, length * 0.45), rotate(0, length * 0.2), rotate(-length * 0.38, length * 0.45)]
    const points = outline.flatMap((p) => [p.x, p.y])
    if (scene.ownShip.destroyed) {
      g.poly(points, true).stroke({ width: 2, color: PLOT_COLOURS.command })
      g.moveTo(at.x - length / 2, at.y - length / 2).lineTo(at.x + length / 2, at.y + length / 2)
        .moveTo(at.x + length / 2, at.y - length / 2).lineTo(at.x - length / 2, at.y + length / 2)
        .stroke({ width: 2, color: PLOT_COLOURS.ink })
      return { at, state: 'destroyed' }
    }
    // Ring marks the hull extent so the ship never reads as the arrowhead of its own trail.
    // Cloaked: dashed ring plus a label; exposed: labelled. Both read without colour.
    const { cloaked, exposed } = scene.ownShip
    const radius = length * 0.62
    if (cloaked) {
      for (const [start, end] of dashCircle(radius, 4, 4)) g.moveTo(at.x + Math.cos(start) * radius, at.y + Math.sin(start) * radius).arc(at.x, at.y, radius, start, end)
      g.stroke({ width: 1.5, color: PLOT_COLOURS.command, alpha: 0.9 })
    } else {
      g.circle(at.x, at.y, radius).stroke({ width: 1.5, color: PLOT_COLOURS.command, alpha: 0.9 })
    }
    g.poly(points, true).fill({ color: PLOT_COLOURS.command }).stroke({ width: 1.5, color: PLOT_COLOURS.commandInk })
    const state = cloaked ? 'cloaked' : exposed ? 'exposed' : 'plain'
    if (state !== 'plain') labels.place('own-state', cloaked ? 'Cloaked' : 'Exposed', at.x, at.y + radius + 10, PLOT_COLOURS.command, 0.5)
    return { at, state }
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
