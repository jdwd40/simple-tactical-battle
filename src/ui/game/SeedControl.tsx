import { useState } from 'react'
import { ConsoleButton } from '../components/ConsoleButton'

/** Copies text, falling back to a selected textarea where the async clipboard is unavailable (plain http). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the selection-based copy.
  }
  // The selection-based copy has to focus a temporary field; give focus back to whatever had it
  // (the copy button), so keyboard order continues exactly as after a secure-origin copy.
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-hidden', 'true')
  area.tabIndex = -1
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  let copied: boolean
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  area.remove()
  window.getSelection()?.removeAllRanges()
  previous?.focus({ preventScroll: true })
  return copied
}

/** The encounter seed as plain reproduction data, with a link that reopens the same encounter. */
export function SeedControl({ seed }: { seed: number }) {
  const [status, setStatus] = useState('')
  const link = `${window.location.origin}${window.location.pathname}?seed=${seed}`
  const copy = async () => setStatus(await copyText(link) ? 'Seed link copied.' : `Copy failed. The link is ${link}`)
  return (
    <div className="seed-control">
      <span className="seed-readout">Seed <span data-testid="seed">{seed}</span></span>
      <ConsoleButton variant="quiet" aria-describedby="seed-help" onClick={copy}>Copy seed link</ConsoleButton>
      <span id="seed-help" className="sr-only">Copies a link that starts this same encounter again.</span>
      <span className="sr-only" role="status">{status}</span>
    </div>
  )
}
