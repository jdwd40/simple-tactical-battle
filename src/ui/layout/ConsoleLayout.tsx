import type { ReactNode } from 'react'

interface ConsoleLayoutProps {
  header: ReactNode
  /** Own ship status and the textual plot readout. */
  shipRail: ReactNode
  /** The plotting table; the dominant surface. */
  battlefield: ReactNode
  /** Playback controls and timeline beneath the plot. */
  transport: ReactNode
  /** Orders, Commit Turn and the event log. */
  commandRail: ReactNode
}

/**
 * Battlefield-first console frame. Source order follows the planning flow
 * (status → plot → playback → orders → commit), which is also the tab order.
 */
export function ConsoleLayout({ header, shipRail, battlefield, transport, commandRail }: ConsoleLayoutProps) {
  return (
    <div className="console">
      <header className="console-header">{header}</header>
      <main className="console-deck">
        <div className="rail deck-ship">{shipRail}</div>
        <div className="deck-plot plot-well">{battlefield}</div>
        <div className="deck-transport">{transport}</div>
        <div className="rail deck-command" id="command-rail" tabIndex={-1}>{commandRail}</div>
      </main>
    </div>
  )
}
