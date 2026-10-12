import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vite copies public/ verbatim into dist/, so this file ships beside the bundled fonts.
const root = resolve(import.meta.dirname, '../../..')
const licence = readFileSync(resolve(root, 'public/assets/barlow-fonts-OFL.txt'), 'utf8')

describe('vendored font licence', () => {
  it('ships the Barlow copyright notice and the full OFL 1.1 text', () => {
    expect(licence).toContain('Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow)')
    expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1')
    for (const section of ['PREAMBLE', 'DEFINITIONS', 'PERMISSION & CONDITIONS', 'TERMINATION', 'DISCLAIMER']) {
      expect(licence).toMatch(new RegExp(`^${section}$`, 'm'))
    }
  })

  it('covers every font file the stylesheet loads', () => {
    const styles = readFileSync(resolve(root, 'src/styles.css'), 'utf8')
    const referenced = [...styles.matchAll(/url\("\.\/ui\/fonts\/([^"]+)"\)/g)].map((match) => match[1]).sort()
    const vendored = readdirSync(resolve(root, 'src/ui/fonts')).filter((name) => name.endsWith('.woff2')).sort()
    expect(referenced).toEqual(vendored)
    expect(vendored.every((name) => /^barlow-(semi-)?condensed-/.test(name))).toBe(true)
  })
})
