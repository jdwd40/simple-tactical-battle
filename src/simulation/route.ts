import type {
  Cell, HeadingMilliDegrees, MovementOrder, OwnRoutePreview, Position, PreviewRoute, PublicMap, RouteProgress, Ruleset,
} from '../contracts/public'
import { freezeData } from '../scenarios/freeze'
import { cellCentre, isAsteroidCell, isMapCell } from '../scenarios/geometry'
import { cellOf, distanceUnits, headingOf, interpolate, lastSafePoint, samePosition } from './geometry'
import { findPath } from './pathfinding'

/** Shared by the engine and previews so the UI never duplicates path logic. */
export function idleRoute(): RouteProgress {
  return { waypoints: [], segmentIndex: 0, distanceAlongSegmentUnits: 0, remainingDistanceUnits: 0 }
}
function segmentLength(waypoints: readonly Position[], index: number): number {
  return distanceUnits(waypoints[index], waypoints[index + 1])
}
function routeFromWaypoints(waypoints: readonly Position[]): RouteProgress {
  if (waypoints.length < 2) return idleRoute()
  let total = 0
  for (let index = 0; index + 1 < waypoints.length; index++) total += segmentLength(waypoints, index)
  return { waypoints, segmentIndex: 0, distanceAlongSegmentUnits: 0, remainingDistanceUnits: total }
}
export function routePosition(route: RouteProgress): Position | null {
  const { waypoints, segmentIndex } = route
  if (waypoints.length === 0) return null
  if (segmentIndex >= waypoints.length - 1) return waypoints[waypoints.length - 1]
  return interpolate(waypoints[segmentIndex], waypoints[segmentIndex + 1], route.distanceAlongSegmentUnits, segmentLength(waypoints, segmentIndex))
}
/** Heading of the segment being travelled (the last one once complete). */
export function routeHeading(route: RouteProgress): HeadingMilliDegrees | null {
  if (route.waypoints.length < 2) return null
  const index = Math.min(route.segmentIndex, route.waypoints.length - 2)
  return headingOf(route.waypoints[index], route.waypoints[index + 1])
}
/** Integer distance progress across segment boundaries; positions are always recomputed from waypoints. */
export function advanceRoute(route: RouteProgress, distance: number): RouteProgress {
  const last = route.waypoints.length - 1
  let budget = Math.min(distance, route.remainingDistanceUnits)
  const remaining = route.remainingDistanceUnits - budget
  let index = route.segmentIndex
  let along = route.distanceAlongSegmentUnits
  while (budget > 0 && index < last) {
    const left = segmentLength(route.waypoints, index) - along
    if (budget < left) {
      along += budget
      budget = 0
    } else {
      budget -= left
      index += 1
      along = 0
    }
  }
  return { waypoints: route.waypoints, segmentIndex: index, distanceAlongSegmentUnits: along, remainingDistanceUnits: remaining }
}

/**
 * Route from the current position: connect to the current free cell centre, follow the
 * A* cell centres, and sweep each segment so the ship stops at the last safe point.
 */
export function buildRoute(position: Position, destination: Cell, map: PublicMap, rules: Ruleset): RouteProgress | null {
  const path = findPath(cellOf(position, rules), destination, map, rules)
  if (path === null) return null
  const points: Position[] = [{ x: position.x, y: position.y }]
  for (const cell of path) {
    const centre = cellCentre(cell, rules)
    if (!samePosition(centre, points[points.length - 1])) points.push(centre)
  }
  const safe: Position[] = [points[0]]
  for (let index = 1; index < points.length; index++) {
    const end = lastSafePoint(safe[safe.length - 1], points[index], rules.geometry.shipRadiusUnits, map, rules)
    if (!samePosition(end, safe[safe.length - 1])) safe.push(end)
    if (!samePosition(end, points[index])) break
  }
  return routeFromWaypoints(safe)
}

export type MovementPlan =
  | { readonly destination: Cell | null; readonly route: RouteProgress }
  | { readonly error: 'out-of-bounds' | 'obstacle' | 'unreachable' }

interface Mover { readonly position: Position; readonly destination: Cell | null; readonly route: RouteProgress }

/** Hold cancels movement; the same destination keeps its progress; a new one is routed afresh. */
export function planMovement(ship: Mover, movement: MovementOrder, map: PublicMap, rules: Ruleset): MovementPlan {
  if (movement.kind === 'hold') return { destination: null, route: idleRoute() }
  const cell = { column: movement.cell.column, row: movement.cell.row }
  if (!isMapCell(cell, map)) return { error: 'out-of-bounds' }
  if (isAsteroidCell(cell, map)) return { error: 'obstacle' }
  if (ship.destination !== null && ship.destination.column === cell.column && ship.destination.row === cell.row) {
    return { destination: cell, route: ship.route }
  }
  const route = buildRoute(ship.position, cell, map, rules)
  return route === null ? { error: 'unreachable' } : { destination: cell, route }
}

/** Own observation/public map/rules only. The reachable point assumes propulsion stays funded. */
export const previewRoute: PreviewRoute = (movement, ownShip, map, rules) => {
  const position = { x: ownShip.position.x, y: ownShip.position.y }
  if (ownShip.status === 'destroyed') {
    return { kind: 'unavailable', issues: [{ field: 'orders', severity: 'error', code: 'invalid-turn' }] }
  }
  if (movement.kind === 'hold') return { kind: 'hold', position }
  const plan = planMovement(ownShip, movement, map, rules)
  if ('error' in plan) {
    return { kind: 'unavailable', issues: [{ field: 'movement', severity: 'error', code: plan.error, details: { cell: { column: movement.cell.column, row: movement.cell.row } } }] }
  }
  const { route } = plan
  const remaining = route.waypoints.length === 0 ? [] : route.waypoints.slice(route.segmentIndex + 1)
  const reach = routePosition(advanceRoute(route, rules.ships[ownShip.shipClass].speedUnitsPerTick * rules.timing.turnTicks))
  const preview: OwnRoutePreview = {
    kind: 'destination', destination: { column: movement.cell.column, row: movement.cell.row },
    waypoints: [position, ...remaining.map(({ x, y }) => ({ x, y }))],
    nominalReachablePoint: reach === null ? position : { x: reach.x, y: reach.y },
    predicted: true, conditionalOnPropulsionFunding: true,
  }
  return freezeData(preview)
}
