import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConsoleButton } from './ConsoleButton'
import { Panel } from './Panel'
import { PhaseTrack } from './PhaseTrack'
import { NoData, Readouts } from './Readouts'

describe('ConsoleButton', () => {
  it('keeps an unavailable button focusable and describes why', () => {
    const html = renderToStaticMarkup(<ConsoleButton unavailable aria-describedby="why">Commit turn</ConsoleButton>)
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('aria-describedby="why"')
    expect(html).toContain('type="button"')
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/)
  })

  it('omits aria-disabled when available', () => {
    expect(renderToStaticMarkup(<ConsoleButton variant="commit">Commit turn</ConsoleButton>)).not.toContain('aria-disabled')
  })
})

describe('PhaseTrack', () => {
  it('marks only the current phase', () => {
    const html = renderToStaticMarkup(<PhaseTrack phases={['Planning', 'Commit']} current="Commit" />)
    expect(html.match(/aria-current="step"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-current="step"[^>]*>.*Commit<\/li>/)
  })

  it('marks no phase when no turn is in progress', () => {
    expect(renderToStaticMarkup(<PhaseTrack phases={['Planning', 'Commit']} />)).not.toContain('aria-current')
  })
})

describe('Panel', () => {
  it('names its region from the visible heading', () => {
    const html = renderToStaticMarkup(<Panel title="Orders"><p>Body</p></Panel>)
    const headingId = html.match(/<h2 id="([^"]+)"/)?.[1]
    expect(headingId).toBeTruthy()
    expect(html).toContain(`aria-labelledby="${headingId}"`)
  })
})

describe('Readouts', () => {
  it('announces missing values as words rather than a dash', () => {
    const html = renderToStaticMarkup(<Readouts items={[{ label: 'Energy', value: <NoData /> }]} />)
    expect(html).toContain('<dt>Energy</dt>')
    expect(html).toContain('<span aria-hidden="true">—</span><span class="sr-only">No data</span>')
  })
})
