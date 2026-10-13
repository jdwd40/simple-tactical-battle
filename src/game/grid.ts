import type { Vec } from './types';

export const key = (p: Vec): string => `${p.x},${p.y}`;
export const same = (a: Vec, b: Vec): boolean => a.x === b.x && a.y === b.y;
export const cheb = (a: Vec, b: Vec): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const angle = (from: Vec, to: Vec): number => Math.atan2(to.y - from.y, to.x - from.x);

const DIRS: Vec[] = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
];

export interface GridInfo {
  cols: number;
  rows: number;
  blocked: Set<string>;
}

export function inBounds(g: GridInfo, p: Vec): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < g.cols && p.y < g.rows;
}

/** Eight-neighbour steps, no cutting diagonally between two blocked cells. */
export function neighbours(g: GridInfo, p: Vec): Vec[] {
  const out: Vec[] = [];
  for (const d of DIRS) {
    const n = { x: p.x + d.x, y: p.y + d.y };
    if (!inBounds(g, n) || g.blocked.has(key(n))) continue;
    if (d.x !== 0 && d.y !== 0) {
      const a = g.blocked.has(key({ x: p.x + d.x, y: p.y }));
      const b = g.blocked.has(key({ x: p.x, y: p.y + d.y }));
      if (a || b) continue;
    }
    out.push(n);
  }
  return out;
}

/** Breadth-first distances from `start`, limited to `maxSteps` when given. */
export function floodFill(g: GridInfo, start: Vec, maxSteps = Infinity): Map<string, { dist: number; prev: Vec | null }> {
  const seen = new Map<string, { dist: number; prev: Vec | null }>();
  seen.set(key(start), { dist: 0, prev: null });
  const queue: Vec[] = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = seen.get(key(cur))!.dist;
    if (d >= maxSteps) continue;
    for (const n of neighbours(g, cur)) {
      if (seen.has(key(n))) continue;
      seen.set(key(n), { dist: d + 1, prev: cur });
      queue.push(n);
    }
  }
  return seen;
}

/** Shortest path from `from` to `to` (exclusive of `from`), or null when unreachable. */
export function findPath(g: GridInfo, from: Vec, to: Vec, maxSteps = Infinity): Vec[] | null {
  const fill = floodFill(g, from, maxSteps);
  if (!fill.has(key(to))) return null;
  const path: Vec[] = [];
  let cur: Vec | null = to;
  while (cur && !same(cur, from)) {
    path.push(cur);
    cur = fill.get(key(cur))!.prev;
  }
  return path.reverse();
}

/** Cells visited by a straight line between two cell centres (supercover-ish Bresenham). */
export function lineCells(a: Vec, b: Vec): Vec[] {
  const cells: Vec[] = [];
  let x0 = a.x, y0 = a.y;
  const x1 = b.x, y1 = b.y;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    cells.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
  return cells;
}

/** True when no asteroid lies strictly between the two cells. */
export function hasLineOfSight(g: GridInfo, a: Vec, b: Vec): boolean {
  const cells = lineCells(a, b);
  for (let i = 1; i < cells.length - 1; i++) {
    if (g.blocked.has(key(cells[i]))) return false;
  }
  return true;
}
