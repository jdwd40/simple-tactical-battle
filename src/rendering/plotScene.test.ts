import { describe, expect, it } from 'vitest'
import { DUEL_RULES, type OwnRoutePreview } from '../contracts'
import { buildScene, interpolateScene, splitPathAt } from './plotScene'
import { current, frameAt, stale } from './testFrames'

describe('buildScene', () => {
  it('draws the trail from the supplied prefix only, ending at the current frame', () => {
    const frames = [frameAt(0, { x: 3500, y: 10_500 }), frameAt(1, { x: 3600, y: 10_500 }), frameAt(2, { x: 3600, y: 10_500 }), frameAt(3, { x: 3700, y: 10_500 })]
    const scene = buildScene({ frames: frames.slice(0, 2) })
    expect(scene.tick).toBe(1)
    expect(scene.trail).toEqual([{ x: 3500, y: 10_500 }, { x: 3600, y: 10_500 }])
    expect(buildScene({ frames }).trail).toHaveLength(3)
  })

  it('uses the supplied draft preview, marked as a prediction', () => {
    const preview: OwnRoutePreview = {
      kind: 'destination', destination: { column: 8, row: 10 }, waypoints: [{ x: 8500, y: 10_500 }],
      nominalReachablePoint: { x: 8500, y: 10_500 }, predicted: true, conditionalOnPropulsionFunding: true,
    }
    const scene = buildScene({ frames: [frameAt(0, { x: 3500, y: 10_500 })], routePreview: preview })
    expect(scene.plan).toEqual({ kind: 'preview', destination: { column: 8, row: 10 }, path: [{ x: 3500, y: 10_500 }, { x: 8500, y: 10_500 }], nominal: { x: 8500, y: 10_500 } })
  })

  it('shows no planned course when the preview is unavailable', () => {
    const scene = buildScene({ frames: [frameAt(0, { x: 3500, y: 10_500 })], routePreview: { kind: 'unavailable', issues: [] } })
    expect(scene.plan).toBeNull()
  })

  it('shows the committed remaining route from the current segment onward', () => {
    const route = { waypoints: [{ x: 3500, y: 10_500 }, { x: 9500, y: 10_500 }, { x: 11_500, y: 8500 }], segmentIndex: 1, distanceAlongSegmentUnits: 500, remainingDistanceUnits: 2328 }
    const frame = frameAt(70, { x: 9850, y: 10_150 }, [], { destination: { column: 11, row: 8 }, route })
    expect(buildScene({ frames: [frame] }).plan).toEqual({ kind: 'committed', destination: { column: 11, row: 8 }, path: [{ x: 9850, y: 10_150 }, { x: 11_500, y: 8500 }] })
  })

  it('copies contact memory without inventing positions', () => {
    const frame = frameAt(30, { x: 3500, y: 10_500 }, [stale('contact-1', { x: 15_000, y: 12_000 }, 10, 20, 2000)])
    expect(buildScene({ frames: [frame] }).contacts).toEqual([{
      alias: 'contact-1', kind: 'stale', position: { x: 15_000, y: 12_000 }, measurementTick: 10, ageTicks: 20,
      uncertaintyRadiusUnits: 2000, velocity: null, destroyed: false, selected: false,
    }])
  })

  it('marks only a selected alias the shown frame knows', () => {
    const frame = frameAt(30, { x: 3500, y: 10_500 }, [current('contact-1', { x: 9000, y: 9000 }, 30), stale('contact-2', { x: 15_000, y: 12_000 }, 10, 20, 2000)])
    expect(buildScene({ frames: [frame], selectedAlias: 'contact-2' }).contacts.map((contact) => contact.selected)).toEqual([false, true])
    expect(buildScene({ frames: [frameAt(5, { x: 3500, y: 10_500 })], selectedAlias: 'contact-2' }).contacts).toEqual([])
  })

  it('draws nominal sensor reach from public rules only, with the draft pulse as a prediction', () => {
    const sensors = DUEL_RULES.sensors
    const planning = frameAt(0, { x: 3500, y: 10_500 })
    expect(buildScene({ frames: [planning] }).sensorRings).toEqual([])
    expect(buildScene({ frames: [planning], sensors }).sensorRings).toEqual([{ kind: 'passive', radiusUnits: 7000 }])
    expect(buildScene({ frames: [planning], sensors, draftSensor: 'activePulse' }).sensorRings).toEqual([
      { kind: 'passive', radiusUnits: 7000 }, { kind: 'pulse-preview', radiusUnits: 10_000 },
    ])
    const tracking = frameAt(12, { x: 3500, y: 10_500 }, [], { sensor: 'tracking', clocks: { laserReadyTick: 0, missileReadyTick: 0, trackingUntilTick: 21, exposureUntilTick: 31 } })
    expect(buildScene({ frames: [tracking], sensors }).sensorRings).toEqual([{ kind: 'tracking', radiusUnits: 10_000 }])
    expect(buildScene({ frames: [frameAt(12, { x: 3500, y: 10_500 }, [], { status: 'destroyed' })], sensors }).sensorRings).toEqual([])
  })

  it('reports actual cloak and exposure at the shown frame, not the request', () => {
    const cloaked = buildScene({ frames: [frameAt(0, { x: 3500, y: 10_500 })] }).ownShip
    expect(cloaked).toMatchObject({ cloaked: true, exposed: false })
    const exposed = frameAt(12, { x: 3500, y: 10_500 }, [], {
      cloak: { requested: true, actual: false, state: 'latched-activity' },
      clocks: { laserReadyTick: 0, missileReadyTick: 0, trackingUntilTick: 21, exposureUntilTick: 31 },
    })
    expect(buildScene({ frames: [exposed] }).ownShip).toMatchObject({ cloaked: false, exposed: true })
    const expired = frameAt(31, { x: 3500, y: 10_500 }, [], { cloak: { requested: false, actual: false, state: 'off' }, clocks: { laserReadyTick: 0, missileReadyTick: 0, trackingUntilTick: 21, exposureUntilTick: 31 } })
    expect(buildScene({ frames: [expired] }).ownShip).toMatchObject({ cloaked: false, exposed: false })
  })
})

describe('interpolateScene', () => {
  const at = (tick: number, x: number, contacts = [current('contact-1', { x: 15_000 - tick * 50, y: 12_000 }, tick)]) =>
    buildScene({ frames: [frameAt(tick, { x, y: 10_500 }, contacts)] })

  it('smooths the own ship and contacts current in both contiguous frames', () => {
    const mid = interpolateScene(at(4, 4000), at(5, 4100), 0.5)
    expect(mid.ownShip.position).toEqual({ x: 4050, y: 10_500 })
    expect(mid.contacts[0].position).toEqual({ x: 15_000 - 4.5 * 50, y: 12_000 })
    expect(mid.trail.at(-1)).toEqual({ x: 4050, y: 10_500 })
  })

  it('never bridges a contact that was not current in the previous frame', () => {
    const from = at(4, 4000, [stale('contact-1', { x: 14_000, y: 12_000 }, 1, 3, 300)])
    const to = at(5, 4100)
    expect(interpolateScene(from, to, 0.5).contacts[0].position).toEqual(to.contacts[0].position)
    expect(interpolateScene(at(4, 4000, []), to, 0.5).contacts[0].position).toEqual(to.contacts[0].position)
  })

  it('keeps stale uncertainty exactly as published, however much wall time passes', () => {
    const from = at(4, 4000, [stale('contact-1', { x: 14_000, y: 12_000 }, 1, 3, 300)])
    const to = at(5, 4100, [stale('contact-1', { x: 14_000, y: 12_000 }, 1, 4, 400)])
    for (const t of [0, 0.25, 0.9, 5]) {
      expect(interpolateScene(from, to, t).contacts[0]).toEqual(to.contacts[0])
    }
  })

  it('snaps on non-contiguous frames such as a seek, and never extrapolates past frame n', () => {
    const from = at(4, 4000)
    const jump = at(9, 4500)
    expect(interpolateScene(from, jump, 0.5)).toBe(jump)
    const to = at(5, 4100)
    expect(interpolateScene(from, to, 1)).toBe(to)
  })
})

describe('splitPathAt', () => {
  it('splits the route at the predicted turn-end point', () => {
    const path = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }]
    expect(splitPathAt(path, { x: 1000, y: 400 })).toEqual({
      reach: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 400 }],
      beyond: [{ x: 1000, y: 400 }, { x: 1000, y: 1000 }],
    })
  })
})
