/** New-seed entropy belongs to the application, never the engine. */
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}

/** Optional `?seed=` for reproducible sessions (tests, bug reports). Ignored unless a uint32. */
export function seedFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get('seed')
  if (raw === null || !/^\d+$/.test(raw)) return null
  const seed = Number(raw)
  return Number.isSafeInteger(seed) && seed <= 0xffff_ffff ? seed : null
}
