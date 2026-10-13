/**
 * Readable placement for tactical plot labels (TSB-50). Pure geometry on screen rectangles:
 * each label offers candidate spots in preference order, markers are obstacles, and labels are
 * placed by priority so the most important ones keep the closest spot. Nothing here knows game
 * state; it only arranges text that the plot already decided to show.
 */
export interface Rect { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

/** A text anchor point: anchorX/anchorY 0 = left/top, 0.5 = centre, 1 = right/bottom. */
export interface LabelSpot { readonly x: number; readonly y: number; readonly anchorX: number; readonly anchorY: number }

export interface LabelRequest {
  readonly key: string
  readonly width: number
  readonly height: number
  /** Higher places first and so keeps its preferred spot. */
  readonly priority: number
  readonly spots: readonly LabelSpot[]
  /** Spots from this index on are away from the marker and get a leader line. */
  readonly nearSpots?: number
  /** The marker the label names, for its leader line. */
  readonly marker?: { readonly x: number; readonly y: number }
  /** Supplementary text (also shown elsewhere): left out rather than placed over anything. */
  readonly optional?: boolean
}

export interface LabelPlacement {
  readonly key: string
  readonly spot: LabelSpot
  readonly rect: Rect
  /** Placed away from its marker; draw a leader from `marker`. */
  readonly displaced: boolean
  /** Remaining overlap area with other labels and markers (0 when clear). */
  readonly overlap: number
}

export function rectAt(spot: LabelSpot, width: number, height: number): Rect {
  const left = spot.x - width * spot.anchorX
  const top = spot.y - height * spot.anchorY
  return { left, top, right: left + width, bottom: top + height }
}

export function overlapArea(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
}

function outsideArea(rect: Rect, bounds: Rect): number {
  const area = (rect.right - rect.left) * (rect.bottom - rect.top)
  return area - overlapArea(rect, bounds)
}

/**
 * Spots around a marker of radius `radius`: right, left, above, below and the four diagonals at
 * `gap` (the "near" spots, no leader needed), then the same eight further out, then twelve
 * directions further still, so a crowded corner or map edge still has somewhere clear to go.
 */
export function spotsAround(x: number, y: number, radius: number, gap = 5): { spots: LabelSpot[]; nearSpots: number } {
  const ring = (d: number): LabelSpot[] => [
    { x: x + d, y, anchorX: 0, anchorY: 0.5 },
    { x: x - d, y, anchorX: 1, anchorY: 0.5 },
    { x, y: y - d, anchorX: 0.5, anchorY: 1 },
    { x, y: y + d, anchorX: 0.5, anchorY: 0 },
    { x: x + d * 0.75, y: y - d * 0.75, anchorX: 0, anchorY: 1 },
    { x: x + d * 0.75, y: y + d * 0.75, anchorX: 0, anchorY: 0 },
    { x: x - d * 0.75, y: y - d * 0.75, anchorX: 1, anchorY: 1 },
    { x: x - d * 0.75, y: y + d * 0.75, anchorX: 1, anchorY: 0 },
  ]
  const far = (d: number): LabelSpot[] => Array.from({ length: 12 }, (_, k) => {
    const angle = (k / 12) * Math.PI * 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return { x: x + cos * d, y: y + sin * d, anchorX: cos > 0.3 ? 0 : cos < -0.3 ? 1 : 0.5, anchorY: sin > 0.3 ? 0 : sin < -0.3 ? 1 : 0.5 }
  })
  const near = ring(radius + gap)
  return { spots: [...near, ...ring(radius + gap + 22), ...far(radius + gap + 46)], nearSpots: near.length }
}

/**
 * Places every request: the first spot (in its own preference order) that stays inside
 * `bounds` and clear of markers and higher-priority labels, else the least-overlapping spot.
 */
export function layoutLabels(requests: readonly LabelRequest[], obstacles: readonly Rect[], bounds: Rect): LabelPlacement[] {
  const placed: Rect[] = []
  const order = requests.map((request, index) => ({ request, index })).sort((a, b) => b.request.priority - a.request.priority || a.index - b.index)
  const result: LabelPlacement[] = []
  for (const { request } of order) {
    let best: { spot: LabelSpot; rect: Rect; cost: number; index: number } | null = null
    for (const [index, spot] of request.spots.entries()) {
      const rect = rectAt(spot, request.width, request.height)
      let cost = outsideArea(rect, bounds) * 4
      for (const other of placed) cost += overlapArea(rect, other)
      for (const other of obstacles) cost += overlapArea(rect, other)
      if (!best || cost < best.cost) best = { spot, rect, cost, index }
      if (cost === 0) break
    }
    if (!best || (best.cost > 0 && request.optional)) continue
    placed.push(best.rect)
    result.push({
      key: request.key, spot: best.spot, rect: best.rect, overlap: best.cost,
      displaced: request.marker !== undefined && best.index >= (request.nearSpots ?? request.spots.length),
    })
  }
  return result
}
