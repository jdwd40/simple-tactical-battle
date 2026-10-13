/** Explicit uint32 planner stream (mulberry32 step). The caller threads the state; nothing is global. */
export function nextRandom(state: number): { readonly value: number; readonly state: number } {
  if (!Number.isSafeInteger(state) || state < 0 || state > 0xffff_ffff) throw new Error('plannerRandomState must be a uint32')
  const next = (state + 0x6d2b_79f5) >>> 0
  let t = next
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return { value: (t ^ (t >>> 14)) >>> 0, state: next }
}

/** Draws for one planning call; `state` is returned to the caller as the new plannerRandomState. */
export function randomStream(initial: number) {
  let state = initial
  const draw = () => {
    const step = nextRandom(state)
    state = step.state
    return step.value / 0x1_0000_0000
  }
  return {
    /** Integer in [0, size). */
    index: (size: number) => Math.floor(draw() * size),
    chance: (probability: number) => draw() < probability,
    get state() { return state },
  }
}
