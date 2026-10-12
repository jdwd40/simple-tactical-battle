import { useId, type ReactNode } from 'react'

interface PanelProps {
  title: string
  /** Short state shown beside the title, such as "No data" or "Locked". */
  status?: ReactNode
  className?: string
  children: ReactNode
}

export function Panel({ title, status, className, children }: PanelProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={className ? `panel ${className}` : 'panel'}>
      <div className="panel-header">
        <h2 id={headingId} className="panel-title">{title}</h2>
        {status}
      </div>
      {children}
    </section>
  )
}
