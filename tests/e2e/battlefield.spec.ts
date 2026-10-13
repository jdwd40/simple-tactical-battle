import { expect, test, type Page } from '@playwright/test'
import type { DrawSummary, RendererDiagnostics } from '../../src/rendering/BattlefieldRenderer'

// TSB-11B: the PixiJS plot and movement/playback controls against static public fixture
// frames in tests/fixtures/battlefield. No engine or controller is connected here.
const HARNESS = '/tests/fixtures/battlefield/index.html'

function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    const text = message.text()
    if (message.type() === 'error' || /too many active webgl contexts|context lost/i.test(text)) errors.push(text)
  })
  return errors
}

async function open(page: Page, query = '') {
  await page.goto(`${HARNESS}${query}`)
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

const diagnostics = (page: Page) => page.evaluate(() => window.__plotDiagnostics()) as Promise<RendererDiagnostics>
async function drawn(page: Page): Promise<DrawSummary> {
  const last = (await diagnostics(page)).last
  if (!last) throw new Error('Nothing drawn yet')
  return last
}
const log = (page: Page) => page.getByTestId('harness-log').locator('li')

async function cellPoint(page: Page, column: number, row: number) {
  const { origin, cellPx } = await drawn(page)
  const box = (await page.locator('.battlefield-canvas canvas').boundingBox())!
  return { x: box.x + origin.x + (column + 0.5) * cellPx, y: box.y + origin.y + (row + 0.5) * cellPx }
}

/** Reads actual rendered pixels from a page screenshot (the WebGL canvas included). */
async function pixelsAt(page: Page, points: readonly { x: number; y: number }[]) {
  const png = (await page.screenshot()).toString('base64')
  return page.evaluate(async ({ png, points }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${png}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const scale = image.width / window.innerWidth
    return points.map(({ x, y }) => Array.from(context.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data.slice(0, 3)))
  }, { png, points })
}
const isAmber = ([r, g, b]: number[]) => r > 200 && g > 140 && b < 120
const isCoral = ([r, g, b]: number[]) => r > 180 && g > 90 && g < 170 && b > 70 && b < 150

async function seek(page: Page, tick: number) {
  await page.getByLabel('Playback position').fill(String(tick))
  await expect.poll(async () => (await drawn(page)).tick).toBe(tick)
}

test('draws the planning plot from public fixture data at 1366x768', async ({ page }, testInfo) => {
  const errors = trackErrors(page)
  await open(page)

  const overflow = await page.evaluate(() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight])
  expect(overflow).toEqual([0, 0])
  await expect(page.locator('canvas')).toHaveCount(1)
  expect((await diagnostics(page)).live).toBe(1)

  const summary = await drawn(page)
  expect(summary.canvas.width).toBeGreaterThanOrEqual(700)
  expect(summary.canvas.height).toBeGreaterThanOrEqual(600)
  expect(summary.cellPx).toBeGreaterThanOrEqual(28)
  expect(summary.plan).toBe('preview')
  expect(summary.contacts.map(({ alias, kind }) => ({ alias, kind }))).toEqual([{ alias: 'contact-1', kind: 'stale' }])

  const box = (await page.locator('.battlefield-canvas canvas').boundingBox())!
  const [ship, asteroid, open_] = await pixelsAt(page, [
    { x: box.x + summary.ownShip.x, y: box.y + summary.ownShip.y },
    await cellPoint(page, 8, 5),
    await cellPoint(page, 2, 2),
  ])
  expect(isAmber(ship)).toBe(true)
  expect(asteroid).not.toEqual(open_)

  await expect(page.getByRole('img', { name: 'Tactical plot' })).toHaveAccessibleDescription(/Position\s*column 12, row 8/)
  await page.screenshot({ path: testInfo.outputPath('planning-1366x768.png') })
  expect(errors).toEqual([])
})

test('clicking a cell emits a typed destination intent and shows the supplied preview or issue', async ({ page }) => {
  await open(page)
  const target = await cellPoint(page, 10, 12)
  await page.mouse.move(target.x, target.y)
  await expect(page.locator('#plot-readout')).toContainText('Pointercolumn 10, row 12')
  await page.mouse.click(target.x, target.y)

  await expect(log(page).first()).toHaveText('plot: {"kind":"destination","cell":{"column":10,"row":12}}')
  await expect(page.getByTestId('movement-order')).toHaveText('Column 10, row 12')
  await expect(page.getByLabel('Column')).toHaveValue('10')
  await expect(page.getByLabel('Row')).toHaveValue('12')
  await expect.poll(async () => (await drawn(page)).plan).toBe('preview')
  await expect(page.getByText('Movement pauses on any tick without propulsion energy.')).toBeVisible()

  const rock = await cellPoint(page, 7, 4)
  await page.mouse.click(rock.x, rock.y)
  await expect(log(page).first()).toHaveText('plot: {"kind":"destination","cell":{"column":7,"row":4}}')
  await expect(page.locator('.issue[data-severity="error"]')).toContainText('InvalidColumn 7, row 4 is an asteroid. Choose open space.')
  await expect.poll(async () => (await drawn(page)).plan).toBeNull()
})

test('keyboard grid entry and hold emit the same typed intents', async ({ page }, testInfo) => {
  await open(page)
  const column = page.getByLabel('Column')
  await column.focus()
  await expect(column).toBeFocused()
  expect(await column.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none')

  await column.fill('25')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Row')).toBeFocused()
  await page.keyboard.type('2')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toHaveText('Enter a column from 0 to 19 and a row from 0 to 19.')
  await expect(log(page)).toHaveCount(0)

  await column.fill('4')
  await page.getByLabel('Row').press('Enter')
  await expect(log(page).first()).toHaveText('movement: {"kind":"destination","cell":{"column":4,"row":2}}')
  await expect(page.getByRole('alert')).toHaveCount(0)

  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Set destination' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Hold position' })).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('keyboard-hold-focus.png') })
  await page.keyboard.press('Enter')
  await expect(log(page).first()).toHaveText('movement: {"kind":"hold"}')
  await expect(page.getByTestId('movement-order')).toHaveText('Hold position')
  await expect.poll(async () => (await drawn(page)).plan).toBe('hold')
})

test('playback controls emit typed commands and the plot holds only the cursor prefix', async ({ page }) => {
  await open(page, '?mode=execution')
  await expect(page.getByRole('button', { name: 'Back' })).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByLabel('Column')).toHaveAttribute('readonly', '')

  await page.getByRole('button', { name: 'Play' }).click()
  await expect(log(page).first()).toHaveText('playback: {"kind":"play"}')
  await expect.poll(async () => (await drawn(page)).tick).toBeGreaterThanOrEqual(3)
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(log(page).first()).toHaveText('playback: {"kind":"pause"}')

  await page.locator('.speed-option', { hasText: '2×' }).click()
  await expect(log(page).first()).toHaveText('playback: {"kind":"speed","speed":2}')
  await page.getByRole('button', { name: 'Forward' }).click()
  await expect(log(page).first()).toHaveText('playback: {"kind":"step","direction":1}')
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(log(page).first()).toHaveText('playback: {"kind":"skipToEnd"}')
  await expect.poll(async () => (await drawn(page)).tick).toBe(100)
  expect((await drawn(page)).trailPoints).toBe(101)
  await expect(page.getByRole('button', { name: 'Forward' })).toHaveAttribute('aria-disabled', 'true')

  await seek(page, 30)
  await expect(log(page).first()).toHaveText('playback: {"kind":"seek","tick":30}')
  expect((await drawn(page)).trailPoints).toBe(31)
  await expect(page.getByLabel('Playback position')).toHaveAttribute('aria-valuetext', '3.0 s of 10.0 s')
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(log(page).first()).toHaveText('playback: {"kind":"step","direction":-1}')
  await expect.poll(async () => (await drawn(page)).tick).toBe(29)
})

test('current and last-known contacts follow the frame at the cursor, never later frames', async ({ page }, testInfo) => {
  await open(page, '?mode=execution')
  const readout = page.locator('#plot-readout')

  await seek(page, 19)
  expect((await drawn(page)).contacts).toEqual([])
  await expect(readout).toContainText('No contacts.')

  await seek(page, 30)
  const currentContact = (await drawn(page)).contacts[0]
  expect(currentContact).toMatchObject({ alias: 'contact-1', kind: 'current', radiusPx: 0 })
  await expect(readout.locator('[data-alias="contact-1"]')).toContainText('Current')
  await expect(readout.locator('[data-alias="contact-1"]')).toContainText('moving north-west at 0.7 cells/s')
  // Sample around the midpoint of the diamond's solid upper-right edge (half-size >= 0.3 cell).
  const box = (await page.locator('.battlefield-canvas canvas').boundingBox())!
  const half = Math.max(7, (await drawn(page)).cellPx * 0.3) / 2
  const edge = { x: box.x + currentContact.at.x + half, y: box.y + currentContact.at.y - half }
  const around = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ x: edge.x + dx, y: edge.y + dy })))
  expect((await pixelsAt(page, around)).some(isCoral)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('contact-current-tick30.png') })

  // Control: before first detection the same pixels are not hostile-coloured.
  await seek(page, 19)
  expect((await pixelsAt(page, around)).some(isCoral)).toBe(false)

  await seek(page, 70)
  const staleContact = (await drawn(page)).contacts[0]
  const { cellPx } = await drawn(page)
  expect(staleContact.kind).toBe('stale')
  expect(staleContact.radiusPx).toBeCloseTo(1.5 * cellPx, 1)
  await expect(readout.locator('[data-alias="contact-1"]')).toContainText('Last known')
  await expect(readout.locator('[data-alias="contact-1"]')).toContainText('Seen 1.5 s ago at column 15, row 12, now anywhere within 1.5 cells.')
  await page.screenshot({ path: testInfo.outputPath('contact-stale-tick70.png') })

  // Paused wall time never grows the published uncertainty.
  await page.waitForTimeout(1200)
  expect((await drawn(page)).contacts[0].radiusPx).toBeCloseTo(staleContact.radiusPx, 6)
})

test('smooths only known one-tick steps while playing, and snaps under reduced motion', async ({ page }) => {
  const sampleTransitions = async () => {
    const seen = new Set<string>()
    for (let i = 0; i < 25; i += 1) {
      seen.add((await drawn(page)).transition)
      await page.waitForTimeout(40)
    }
    return seen
  }

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await open(page, '?mode=execution')
  await page.getByRole('button', { name: 'Play' }).click()
  expect(await sampleTransitions()).toContain('smooth')
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Forward' }).click()
  await expect.poll(async () => (await drawn(page)).transition).toBe('snap')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page, '?mode=execution')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect.poll(async () => (await drawn(page)).tick).toBeGreaterThanOrEqual(2)
  expect(await sampleTransitions()).toEqual(new Set(['snap']))
})

type Sample = { readonly t: number; readonly transition: string; readonly x: number; readonly tick: number }
type SamplerWindow = { __samples: Sample[]; __plotDiagnostics: () => RendererDiagnostics }

/** Records the drawn summary on every animation frame, so mid-tween behaviour is observable. */
async function startSampler(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as SamplerWindow
    w.__samples = []
    const loop = () => {
      const last = w.__plotDiagnostics().last
      if (last) w.__samples.push({ t: performance.now(), transition: last.transition, x: last.ownShip.x, tick: last.tick })
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
}
const samplesAfter = (page: Page, at: number) =>
  page.evaluate((at) => (window as unknown as SamplerWindow).__samples.filter((sample) => sample.t > at), at)

async function waitForTween(page: Page) {
  await expect.poll(async () => (await drawn(page)).transition, { intervals: [10] }).toBe('smooth')
}

test('pausing or enabling reduced motion mid-tween snaps at once to the known frame', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await open(page, '?mode=execution')
  await page.locator('.speed-option', { hasText: '0.5×' }).click()
  await startSampler(page)

  // Pause while a 200ms tween is in flight.
  await page.getByRole('button', { name: 'Play' }).click()
  await waitForTween(page)
  const pausedAt = await page.evaluate(() => {
    const at = performance.now()
    document.querySelector<HTMLButtonElement>('.playback button:nth-child(2)')!.click()
    return at
  })
  await page.waitForTimeout(400)
  const afterPause = await samplesAfter(page, pausedAt + 50)
  expect(afterPause.length).toBeGreaterThan(5)
  expect(new Set(afterPause.map((sample) => sample.transition))).toEqual(new Set(['snap']))
  expect(new Set(afterPause.map((sample) => sample.x)).size).toBe(1)
  const paused = await drawn(page)
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('paused-mid-tween.png') })

  // The snapped position is frame n exactly: stepping back and forward redraws the same point.
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Forward' }).click()
  await expect.poll(async () => (await drawn(page)).tick).toBe(paused.tick)
  expect((await drawn(page)).ownShip).toEqual(paused.ownShip)

  // Enable reduced motion while playback continues and a tween is in flight. The check is
  // anchored to when the page itself observes the preference change, not when it was requested.
  await page.evaluate(() => {
    const w = window as unknown as SamplerWindow & { __reducedAt?: number }
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { w.__reducedAt ??= performance.now() })
  })
  await page.getByRole('button', { name: 'Play' }).click()
  await waitForTween(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reducedAt = await expect.poll(() => page.evaluate(() => (window as unknown as { __reducedAt?: number }).__reducedAt ?? null)).not.toBeNull()
    .then(() => page.evaluate(() => (window as unknown as { __reducedAt: number }).__reducedAt))
  await page.waitForTimeout(600)
  // Allow two animation frames for React to commit the preference before the plot must snap.
  const afterReduce = await samplesAfter(page, reducedAt + 34)
  expect(afterReduce.length).toBeGreaterThan(5)
  const lateSmooth = afterReduce.filter((sample) => sample.transition === 'smooth').map((sample) => Math.round(sample.t - reducedAt))
  expect(lateSmooth, 'ms after the page observed reduced motion').toEqual([])
  expect(Math.max(...afterReduce.map((sample) => sample.tick))).toBeGreaterThan(paused.tick)
  await page.getByRole('button', { name: 'Pause' }).click()
})

test('mounting, unmounting and changing encounter never accumulates renderers or canvases', async ({ page }) => {
  const errors = trackErrors(page)
  await open(page)
  const start = await diagnostics(page)

  for (let i = 0; i < 5; i += 1) {
    await page.getByRole('button', { name: 'Unmount plot' }).click()
    await expect(page.locator('canvas')).toHaveCount(0)
    await expect.poll(async () => (await diagnostics(page)).live).toBe(0)
    await page.getByRole('button', { name: 'Mount plot' }).click()
    await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
    await expect(page.locator('canvas')).toHaveCount(1)
  }

  const encounters = new Set<string | null>()
  for (let i = 0; i < 5; i += 1) {
    await page.getByRole('button', { name: 'New encounter' }).click()
    await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
    encounters.add(await page.locator('.battlefield-canvas').getAttribute('data-encounter'))
    await expect(page.locator('canvas')).toHaveCount(1)
  }
  expect(encounters.size).toBe(5)

  // Unmount while a fresh renderer may still be initialising.
  await page.getByRole('button', { name: 'Unmount plot' }).click()
  await page.getByRole('button', { name: 'Mount plot' }).click()
  await page.getByRole('button', { name: 'Unmount plot' }).click()
  await expect.poll(async () => (await diagnostics(page)).live).toBe(0)
  await expect(page.locator('canvas')).toHaveCount(0)

  const end = await diagnostics(page)
  expect(end.created - start.created).toBeGreaterThanOrEqual(11)
  expect(end.created).toBe(end.destroyed)
  expect(errors).toEqual([])
})
