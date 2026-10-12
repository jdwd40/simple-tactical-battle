/** Explicit uint32 random streams. No Math.random, clocks or draws shared between purposes. */
export const STREAM_PURPOSE = { simulation: 1, playerPlanner: 2, patrolPlanner: 3 } as const

export function assertSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new Error('Seed must be a uint32 integer')
}

/** Derives an independent stream state from the encounter seed and a fixed purpose key (murmur3 finaliser). */
export function deriveStream(seed: number, purpose: number): number {
  assertSeed(seed)
  let z = (seed + Math.imul(purpose, 0x9e37_79b9)) >>> 0
  z = Math.imul(z ^ (z >>> 16), 0x85eb_ca6b) >>> 0
  z = Math.imul(z ^ (z >>> 13), 0xc2b2_ae35) >>> 0
  return (z ^ (z >>> 16)) >>> 0
}

/** Pure mulberry32 step: returns a uint32 draw and the next explicit state. */
export function nextRandom(state: number): { readonly value: number; readonly state: number } {
  assertSeed(state)
  const next = (state + 0x6d2b_79f5) >>> 0
  let t = next
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return { value: (t ^ (t >>> 14)) >>> 0, state: next }
}
