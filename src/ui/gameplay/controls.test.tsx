import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DUEL_MAP, type ReplayPrefix } from '../../contracts'
import { MovementOrders } from './MovementOrders'
import { PlaybackControls } from './PlaybackControls'

const prefix = (cursorTick: number, playing = false): ReplayPrefix => ({
  scope: 'latest-player-turn-with-aftermath', startTick: 200, endTick: 300, cursorTick, frames: [], events: [], playback: { playing, speed: 2 },
})
const buttonState = (html: string, name: string) => new RegExp(`<button[^>]*aria-disabled="true"[^>]*>(<svg.*?</svg>)?${name}</button>`).test(html)

describe('PlaybackControls', () => {
  it('is unavailable without a prefix and says why', () => {
    const html = renderToStaticMarkup(<PlaybackControls replay={null} tickMs={100} unavailableReason="Playback is available after you commit the turn" onCommand={() => {}} />)
    for (const name of ['Back', 'Play', 'Forward', 'Skip to end']) expect(buttonState(html, name)).toBe(true)
    expect(html).toContain('<fieldset class="speed" disabled="">')
    expect(html).toContain('Playback is available after you commit the turn')
    expect(html).not.toContain('type="range"')
  })

  it('bounds the seek control by the prefix and reports elapsed time', () => {
    const html = renderToStaticMarkup(<PlaybackControls replay={prefix(240, true)} tickMs={100} unavailableReason="" onCommand={() => {}} />)
    expect(html).toMatch(/type="range"[^>]*min="200"[^>]*max="300"[^>]*value="240"/)
    expect(html).toContain('aria-valuetext="4.0 s of 10.0 s"')
    expect(html).toContain('4.0 / 10.0 s')
    expect(buttonState(html, 'Pause')).toBe(false)
    expect(html).toMatch(/checked="" value="2"/)
  })

  it('disables stepping past the bounds', () => {
    expect(buttonState(renderToStaticMarkup(<PlaybackControls replay={prefix(200)} tickMs={100} unavailableReason="" onCommand={() => {}} />), 'Back')).toBe(true)
    const end = renderToStaticMarkup(<PlaybackControls replay={prefix(300)} tickMs={100} unavailableReason="" onCommand={() => {}} />)
    expect(buttonState(end, 'Forward')).toBe(true)
    expect(buttonState(end, 'Skip to end')).toBe(true)
    expect(buttonState(end, 'Play')).toBe(true)
  })
})

describe('MovementOrders', () => {
  const props = { issues: [], preview: null, map: DUEL_MAP, unitsPerCell: 1000, tickMs: 100, tick: 0, onMovementIntent: () => {} }

  it('locks entry with a reason outside planning', () => {
    const html = renderToStaticMarkup(<MovementOrders {...props} movement={{ kind: 'hold' }} lockedReason="Orders are locked while the turn plays." />)
    expect(html).toContain('Hold position')
    expect(html.match(/readOnly=""|readonly=""/g)).toHaveLength(2)
    expect(html).toContain('Orders are locked while the turn plays.')
  })

  it('shows only movement-related issues', () => {
    const html = renderToStaticMarkup(<MovementOrders {...props} movement={{ kind: 'destination', cell: { column: 7, row: 4 } }} lockedReason={null}
      issues={[{ field: 'movement', severity: 'error', code: 'obstacle', details: { cell: { column: 7, row: 4 } } }, { field: 'cloak', severity: 'warning', code: 'activity-breaks-cloak' }]} />)
    expect(html).toContain('Column 7, row 4 is an asteroid.')
    expect(html).not.toContain('breaks cloak')
    expect(html).toContain('value="7"')
  })
})
