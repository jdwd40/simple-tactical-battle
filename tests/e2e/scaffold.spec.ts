import { expect, test } from '@playwright/test'

test('launches the labelled scaffold with keyboard-accessible information', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })

  await page.goto('/')
  await expect(page).toHaveTitle('Shadow-Dancer — Tactical Space Battle')
  await expect(page.getByRole('heading', { name: 'Shadow-Dancer', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Console scaffold ready' })).toBeVisible()
  await expect(page.getByText('Scenario loading and gameplay are not implemented yet.', { exact: false })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to console' })).toBeFocused()
  await page.keyboard.press('Tab')
  const summary = page.locator('summary')
  await expect(summary).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText('The planned encounter uses simultaneous timed turns:', { exact: false })).toBeVisible()
  await testInfo.attach('scaffold', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  await page.screenshot({ path: testInfo.outputPath('scaffold.png'), fullPage: true })
  expect(errors).toEqual([])
})
