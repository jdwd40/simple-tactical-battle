import type { Ruleset, SideObservation, TurnOrders } from '../../src/contracts'
import { cellCentre } from '../../src/contracts'
import { best, cellAt, clampToMap, distance, reachableCells, segmentClear } from '../../src/ai/navigation'

export const POLICY_NAMES = ['concealed-search', 'scan-search', 'pursuit-laser', 'predictive-missile'] as const
export type PolicyName = typeof POLICY_NAMES[number]
export type PlayerPolicy = (view: SideObservation) => TurnOrders
export const holdOrders = (view: SideObservation): TurnOrders => ({ turnIndex: view.turnIndex,
  movement: { kind: 'hold' }, sensor: 'passive', cloak: false, weapon: { kind: 'hold' } })

/** Diagnostic examples, not optimal players. Only public rules are bound; the sole input is own observation. */
export function playerPolicy(name: PolicyName, rules: Ruleset): PlayerPolicy {
  return (view) => {
    const own = view.ownShip
    const cells = reachableCells(cellAt(own.position, rules), view.map)
    const contacts = view.contacts.filter((c) => c.observedDestructionTick === undefined)
    const target = [...contacts].sort((a, b) => a.ageTicks - b.ageTicks || a.alias.localeCompare(b.alias))[0]
    const loop = [[0.4, 0.5], [0.5, 0.35], [0.6, 0.5], [0.5, 0.7]] as const
    const [x, y] = loop[view.turnIndex % loop.length]
    const search = { x: Math.floor(view.map.columns * x) * rules.geometry.unitsPerCell + rules.geometry.unitsPerCell / 2,
      y: Math.floor(view.map.rows * y) * rules.geometry.unitsPerCell + rules.geometry.unitsPerCell / 2 }
    const goal = target && (name === 'pursuit-laser' || name === 'predictive-missile') ? target.measurement.position : search
    let destination = best(cells, (_, centre) => distance(centre, goal), rules)
    const threat = view.hostileMissiles.find((m) => m.ageTicks <= rules.timing.trackingTicks
      && distance(m.measurement.position, own.position) <= rules.sensors.passiveMissileRangeUnits)
    if (name === 'predictive-missile' && threat) {
      const nearby = cells.filter((c) => distance(cellCentre(c, rules), own.position) <= 4 * rules.geometry.unitsPerCell)
      destination = best(nearby, (_, p) => -distance(p, threat.measurement.position), rules)
    }
    const canFire = view.observedOpponentDestructionTick === undefined
    let weapon: TurnOrders['weapon'] = { kind: 'hold' }
    if (canFire && target && own.equipment.laser && name !== 'predictive-missile'
      && (name === 'pursuit-laser' || (target.kind === 'current' && distance(target.measurement.position, own.position) <= rules.laser.rangeUnits))) {
      weapon = { kind: 'laser', contactAlias: target.alias }
    }
    if (canFire && target && name === 'predictive-missile' && own.equipment.missileLauncher
      && own.ammunition.current > 0 && own.energy.currentMilli >= rules.missile.costMilli
      && own.clocks.missileReadyTick <= view.tick + 1) {
      const flightTicks = Math.min(rules.timing.missileLifetimeTicks, Math.ceil(distance(own.position, target.measurement.position) / rules.missile.speedUnitsPerTick))
      const v = target.estimatedVelocity
      let dx = (v?.xUnitsPerTick ?? 0) * flightTicks
      let dy = (v?.yUnitsPerTick ?? 0) * flightTicks
      const offset = Math.hypot(dx, dy)
      if (target.kind === 'stale' && offset > target.uncertaintyRadiusUnits) {
        dx *= target.uncertaintyRadiusUnits / offset; dy *= target.uncertaintyRadiusUnits / offset
      }
      const predicted = clampToMap({ x: target.measurement.position.x + dx, y: target.measurement.position.y + dy }, view.map, rules)
      const aim = best(cells, (_, p) => distance(p, predicted), rules)
      if (aim && distance(cellCentre(aim, rules), own.position) > rules.missile.blastRadiusUnits + rules.geometry.shipRadiusUnits
        && segmentClear(own.position, cellCentre(aim, rules), view.map, rules, rules.geometry.missileRadiusUnits)) weapon = { kind: 'missile', aim }
    }
    const reserve = rules.ships[own.shipClass].propulsionMilliPerTick * rules.timing.turnTicks
    const pulse = name === 'scan-search' && canFire && own.equipment.activeSensor
      && (!target || target.kind === 'stale') && view.turnIndex % 2 === 0 && own.energy.currentMilli >= reserve + rules.sensors.pulseCostMilli
    const cloak = name === 'concealed-search' && own.equipment.cloak && weapon.kind === 'hold'
      && own.energy.currentMilli >= reserve + rules.ships[own.shipClass].cloakMilliPerTick * rules.timing.turnTicks
    return { ...holdOrders(view), movement: destination ? { kind: 'destination', cell: destination } : { kind: 'hold' },
      sensor: pulse ? 'activePulse' : 'passive', cloak, weapon }
  }
}
