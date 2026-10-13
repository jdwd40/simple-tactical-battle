import { useId, type ReactNode } from 'react'

interface PanelProps {
  title: string
  /** Short state shown beside the title, such as "No data" or "Locked". */
  status?: ReactNode
  className?: string
  /** Phone tab this panel belongs to (see ConsoleLayout). */
  mobilePanel?: 'orders' | 'ship' | 'log'
  children: ReactNode
}

export function Panel({ title, status, className, mobilePanel, children }: PanelProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={className ? `panel ${className}` : 'panel'} data-mobile-panel={mobilePanel}>
      <div className="panel-header">
        <h2 id={headingId} className="panel-title">{title}</h2>
        {status}
      </div>
      {children}
    </section>
  )
}
