import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Cell, PublicMap, Ruleset } from '../../contracts'
import { BattlefieldRenderer } from '../../rendering/BattlefieldRenderer'
import type { PlotScene } from '../../rendering/plotScene'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'
import './gameplay.css'

export interface BattlefieldPlayback {
  readonly playing: boolean
  readonly speed: number
}

export interface BattlefieldProps {
  /** A new encounter gets a fresh renderer; nothing drawn for the old one survives. */
  readonly encounterId: string
  readonly map: PublicMap
  readonly rules: Ruleset
  readonly scene: PlotScene
  /** Playback state from the controller; smoothing happens only while playing forward. */
  readonly playback: BattlefieldPlayback | null
  /** True only while planning, when a click on the plot sets the draft destination. */
  readonly selectable: boolean
  readonly onSelectCell?: (cell: Cell) => void
  /** Pointer position for a text readout; called with null when the pointer leaves the map. */
  readonly onHoverCell?: (cell: Cell | null) => void
  /** Id of the text readout that describes the plot for assistive technology. */
  readonly describedBy?: string
}

/**
 * React-managed host for the PixiJS plot. The renderer is created per encounter and
 * disposed on unmount or encounter change, including while its async init is pending.
 */
export function Battlefield({ encounterId, map, rules, scene, playback, selectable, onSelectCell, onHoverCell, describedBy }: BattlefieldProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<BattlefieldRenderer | null>(null)
  const previousSceneRef = useRef<PlotScene | null>(null)
  const callbacksRef = useRef({ onSelectCell, onHoverCell })
  const reducedMotion = usePrefersReducedMotion()
  const [ready, setReady] = useState<string | null>(null)

  useLayoutEffect(() => { callbacksRef.current = { onSelectCell, onHoverCell } })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const renderer = new BattlefieldRenderer({
      onHoverCell: (cell) => callbacksRef.current.onHoverCell?.(cell),
      onSelectCell: (cell) => callbacksRef.current.onSelectCell?.(cell),
    })
    let active = true
    renderer.init(host).then((started) => {
      if (!active || !started) return
      rendererRef.current = renderer
      previousSceneRef.current = null
      setReady(encounterId)
    }, (error: unknown) => {
      if (active) console.error('Tactical plot failed to start', error)
    })
    return () => {
      active = false
      rendererRef.current = null
      previousSceneRef.current = null
      renderer.dispose()
      setReady(null)
      callbacksRef.current.onHoverCell?.(null)
    }
  }, [encounterId])

  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || ready !== encounterId) return
    const previous = previousSceneRef.current
    const smoothing = previous && playback?.playing && !reducedMotion && scene.tick === previous.tick + 1
      ? { from: previous, durationMs: rules.timing.tickMs / playback.speed }
      : null
    renderer.update({ map, unitsPerCell: rules.geometry.unitsPerCell, scene, smoothing, selectable })
    previousSceneRef.current = scene
  }, [ready, encounterId, map, rules, scene, playback, selectable, reducedMotion])

  return (
    <div className="battlefield">
      <div
        key={encounterId}
        ref={hostRef}
        className="battlefield-canvas"
        role="img"
        aria-label="Tactical plot"
        aria-describedby={describedBy}
        data-encounter={encounterId}
        data-ready={ready === encounterId ? 'true' : 'false'}
      />
    </div>
  )
}
