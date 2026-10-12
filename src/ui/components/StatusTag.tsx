import type { ReactNode } from 'react'

/** Dashed tag for a state that is not live: pending, unavailable or no data. */
export function StatusTag({ children }: { children: ReactNode }) {
  return <span className="status-tag">{children}</span>
}
