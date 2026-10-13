/**
 * Pixi colours mirroring the console tokens in src/styles.css. Hue carries the same
 * meaning as in the DOM (amber = own, coral = hostile, sea-glass = sensors); line style carries it without
 * colour (solid = measured/known, dashed = predicted, stale or uncertain).
 */
export const PLOT_COLOURS = {
  well: 0x0a1314,
  grid: 0x22383a,
  gridMajor: 0x35504f,
  edge: 0x64807d,
  asteroidFill: 0x2a3534,
  asteroidHatch: 0x6b7f7a,
  ink: 0xe2eae5,
  inkMuted: 0xa6bab4,
  command: 0xf0b44a,
  commandInk: 0x1b1407,
  hostile: 0xef9078,
  sonar: 0x86c9bd,
  space: 0x071012,
  star: 0xb7cbc6,
  rock: 0x3b4a48,
  rockLight: 0x8a9d98,
  rockShadow: 0x1a2423,
} as const

export const PLOT_FONT = '"Barlow Semi Condensed", "Arial Narrow", system-ui, sans-serif'
