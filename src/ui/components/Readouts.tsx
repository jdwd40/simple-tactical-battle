import type { ReactNode } from 'react'

export interface Readout {
  label: string
  value: ReactNode
}

export function Readouts({ items }: { items: readonly Readout[] }) {
  return (
    <dl className="readouts">
      {items.map(({ label, value }) => (
        <div key={label} className="contents">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Placeholder value for a readout with no data, announced as words rather than a dash. */
export function NoData() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">No data</span>
    </>
  )
}
