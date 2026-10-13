import { useId, type ReactNode } from 'react'

export type MobileTab = 'orders' | 'ship' | 'log'
const TABS: readonly { readonly id: MobileTab; readonly label: string }[] = [
  { id: 'orders', label: 'Orders' }, { id: 'ship', label: 'Ship' }, { id: 'log', label: 'Log' },
]

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
  /** Compact status strip shown above the plot on phones only. */
  hud?: ReactNode
  /** Phone panel choice; panels carry data-mobile-panel and CSS shows the chosen one. */
  mobileTab?: MobileTab
  onMobileTab?: (tab: MobileTab) => void
}

/**
 * Battlefield-first console frame. Source order follows the planning flow
 * (status → plot → playback → orders → commit), which is also the tab order. On phones the
 * same single set of panels is arranged under the plot and switched by tabs; nothing is
 * duplicated, so each control, canvas and listener exists once.
 */
export function ConsoleLayout({ header, shipRail, battlefield, transport, commandRail, hud, mobileTab = 'orders', onMobileTab }: ConsoleLayoutProps) {
  const id = useId()
  return (
    <div className="console">
      <header className="console-header">{header}</header>
      <main className="console-deck" data-mobile-tab={mobileTab}>
        {hud && <div className="deck-hud" aria-hidden="true">{hud}</div>}
        {/* Named, because a rail that overflows becomes a keyboard scroll stop. */}
        <div className="rail deck-ship" id={`${id}-ship`} data-mobile-panel="ship" role="region" aria-label="Ship status">{shipRail}</div>
        <div className="deck-plot plot-well">{battlefield}</div>
        <div className="deck-transport">{transport}</div>
        {onMobileTab && (
          <div className="deck-tabs" role="tablist" aria-label="Console panels">
            {TABS.map((tab) => (
              <button
                key={tab.id} type="button" role="tab" className="deck-tab" aria-selected={mobileTab === tab.id}
                aria-controls={tab.id === 'ship' ? `${id}-ship` : 'command-rail'} onClick={() => onMobileTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
        <div className="rail deck-command" id="command-rail" tabIndex={-1}>{commandRail}</div>
      </main>
    </div>
  )
}
