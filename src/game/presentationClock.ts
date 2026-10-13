/**
 * Presentation-only timer used by the controller's playback cursor. It never drives the
 * engine: a turn is fully resolved at commit and the clock only reveals recorded frames.
 */
export interface PresentationClock {
  /** Runs `callback` once after `delayMs`; the returned function cancels it. */
  schedule(delayMs: number, callback: () => void): () => void
}

export const browserClock: PresentationClock = {
  schedule(delayMs, callback) {
    const id = setTimeout(callback, delayMs)
    return () => clearTimeout(id)
  },
}

/** Deterministic clock for tests: time moves only through advance(). */
export interface ManualClock extends PresentationClock {
  advance(ms: number): void
  readonly pending: number
  readonly now: number
}

export function createManualClock(): ManualClock {
  let now = 0
  let nextId = 0
  const timers = new Map<number, { readonly at: number; readonly callback: () => void }>()
  return {
    schedule(delayMs, callback) {
      const id = nextId++
      timers.set(id, { at: now + Math.max(0, delayMs), callback })
      return () => { timers.delete(id) }
    },
    advance(ms) {
      const target = now + ms
      for (;;) {
        let due: [number, { readonly at: number; readonly callback: () => void }] | undefined
        for (const entry of timers) {
          if (entry[1].at <= target && (!due || entry[1].at < due[1].at)) due = entry
        }
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].callback()
      }
      now = target
    },
    get pending() { return timers.size },
    get now() { return now },
  }
}
