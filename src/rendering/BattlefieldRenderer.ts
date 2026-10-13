import { Application, Container, Graphics, Text, type TextStyleOptions } from 'pixi.js'
import type { Cell, Position, PublicMap } from '../contracts'
import { dashCircle, dashPolyline } from './dashes'
import { PLOT_COLOURS, PLOT_FONT } from './plotPalette'
import {
  cellAtScreen, cellRect, fitPlot, headingToRotation, toScreen, type PlotTransform, type ScreenPoint,
} from './plotGeometry'
import { interpolateScene, splitPathAt, type PlotContact, type PlotScene } from './plotScene'

export interface RendererCallbacks {
  onHoverCell(cell: Cell | null): void
  onSelectCell(cell: Cell): void
}

export interface RendererFrame {
  readonly map: PublicMap
  readonly unitsPerCell: number
  readonly scene: PlotScene
  /** Animate from this earlier scene (exactly one tick before) over the duration; null snaps. */
  readonly smoothing: { readonly from: PlotScene; readonly durationMs: number } | null
  readonly selectable: boolean
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
  readonly trailPoints: number
  readonly plan: string | null
  readonly contacts: readonly { readonly alias: string; readonly kind: string; readonly at: ScreenPoint; readonly radiusPx: number }[]
}

const counters = { created: 0, destroyed: 0 }
let lastSummary: DrawSummary | null = null

export function rendererDiagnostics(): RendererDiagnostics {
  return { ...counters, live: counters.created - counters.destroyed, last: lastSummary }
}

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
    plan: new Graphics(),
    contacts: new Graphics(),
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
    const { terrain, terrainLabels, plan, contacts, ship, hover, labels } = this.layers
    app.stage.addChild(terrain, terrainLabels, plan, contacts, hover, ship, labels)
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
    if (!frame.smoothing && this.animatingTo?.tick === frame.scene.tick) {
      this.animatingTo = frame.scene
      return
    }
    this.stopAnimation()
    if (frame.smoothing && frame.smoothing.durationMs > 0) this.animate(frame.smoothing.from, frame.scene, frame.smoothing.durationMs)
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
    this.drawPlan(scene, transform, labels)
    const contacts = this.drawContacts(scene.contacts, transform, labels)
    const ship = this.drawShip(scene, transform)
    labels.end()
    app.render()

    lastSummary = {
      tick: scene.tick,
      transition,
      canvas: { width: app.screen.width, height: app.screen.height },
      cellPx: transform.cellPx,
      origin: { x: transform.originX, y: transform.originY },
      ownShip: ship,
      trailPoints: scene.trail.length,
      plan: scene.plan?.kind ?? null,
      contacts,
    }
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

  private drawContacts(contacts: readonly PlotContact[], transform: PlotTransform, labels: LabelPool) {
    const g = this.layers.contacts.clear()
    const size = Math.max(7, transform.cellPx * 0.3)
    const bounds = {
      left: transform.originX, top: transform.originY,
      right: transform.originX + transform.columns * transform.cellPx,
      bottom: transform.originY + transform.rows * transform.cellPx,
    }
    const inside = (x: number, y: number) => x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
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

      const status = contact.destroyed ? 'destroyed' : contact.kind === 'current' ? 'current' : 'last known'
      labels.place(`contact:${contact.alias}`, `${contact.alias} (${status})`, at.x + size + 5, at.y - size - 2, PLOT_COLOURS.hostile)
      drawn.push({ alias: contact.alias, kind: contact.kind, at, radiusPx })
    }
    return drawn
  }

  private drawShip(scene: PlotScene, transform: PlotTransform): ScreenPoint {
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
    } else {
      // Ring marks the hull extent so the ship never reads as the arrowhead of its own trail.
      g.circle(at.x, at.y, length * 0.62).stroke({ width: 1.5, color: PLOT_COLOURS.command, alpha: 0.9 })
      g.poly(points, true).fill({ color: PLOT_COLOURS.command }).stroke({ width: 1.5, color: PLOT_COLOURS.commandInk })
    }
    return at
  }

  private drawHover() {
    const g = this.layers.hover.clear()
    if (!this.transform || !this.hoverCell || !this.frame?.selectable) return
    const rect = cellRect(this.transform, this.hoverCell)
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
