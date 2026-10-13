import { describe, expect, it } from 'vitest';
import { findPath, floodFill, hasLineOfSight, lineCells, neighbours, type GridInfo } from './grid';

const grid = (blocked: string[] = [], cols = 8, rows = 10): GridInfo => ({ cols, rows, blocked: new Set(blocked) });

describe('grid', () => {
  it('lists eight neighbours in the open and clips at edges', () => {
    expect(neighbours(grid(), { x: 3, y: 3 })).toHaveLength(8);
    expect(neighbours(grid(), { x: 0, y: 0 })).toHaveLength(3);
  });

  it('does not cut corners between two asteroids', () => {
    const g = grid(['1,0', '0,1']);
    expect(neighbours(g, { x: 0, y: 0 })).toEqual([]);
  });

  it('finds the shortest path and respects step limits', () => {
    const g = grid(['1,0']);
    const path = findPath(g, { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(path).not.toBeNull();
    expect(path!.at(-1)).toEqual({ x: 2, y: 0 });
    expect(path!.length).toBe(4);
    expect(findPath(g, { x: 0, y: 0 }, { x: 2, y: 0 }, 3)).toBeNull();
  });

  it('flood fill limits distance', () => {
    expect(floodFill(grid(), { x: 4, y: 4 }, 1).size).toBe(9);
  });

  it('line of sight is blocked only by cells strictly between', () => {
    expect(lineCells({ x: 0, y: 0 }, { x: 3, y: 0 })).toHaveLength(4);
    expect(hasLineOfSight(grid(['1,0']), { x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
    expect(hasLineOfSight(grid(['3,0']), { x: 0, y: 0 }, { x: 3, y: 0 })).toBe(true);
    expect(hasLineOfSight(grid(['2,2']), { x: 0, y: 0 }, { x: 4, y: 4 })).toBe(false);
  });
});
