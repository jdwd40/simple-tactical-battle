import { describe, expect, it } from 'vitest'
import type { SideObservation, TurnOrders } from '../../contracts/public'
import { aftermathWindowBound } from '../../scenarios/rules'
import { observeSide, previewRoute, validateOrders } from '../../simulation'
import { resolveTurnInOrder } from '../../simulation/resolve'
import { at, BATCH_RULES, CROSS_TURN_RULES, envelope, expiryRules, fixture, hold, laser, missile, PRIVACY_RULES, reproduce, resolutions, scenario, TAIL_RULES } from './combatFixtures'

describe('complementary combat and persistence regressions', () => {
  it('sums two simultaneous direct/splash impacts and a laser, preserving a dying launcher across reversed enumeration', () => {
    const f = fixture(BATCH_RULES, scenario(BATCH_RULES, { column: 4, row: 10 }, { column: 5, row: 10 }))
    reproduce([f], () => {
      let state = f.run(f.initial, hold(0), hold(0)).nextState // Real contact-1 on both sides.
      state = f.run(state, laser(1), laser(1)).nextState // Tick 3: shields now 5 / 25; laser ready at 9.
      state = f.run(state, missile(2, 5), missile(2, 4)).nextState // Tick 5: two opposing projectiles.
      state = f.run(state, hold(3), hold(3)).nextState
      expect(state.missiles).toHaveLength(2)
      expect(state.missiles.map((m) => m.position.x)).toEqual([5100, 4900])
      const before = JSON.stringify(state)
      const player = laser(4)
      const patrol = missile(4, 19)
      const result = f.run(state, player, patrol)
      // Tick 9: 200/tick sweeps hit at fraction .25, 650 from the OTHER victim.
      // Each 45-point missile therefore hits each ship once. Patrol also takes the 35-point laser.
      expect(resolutions(result).map((e) => [e.tick, e.fraction, e.position.x, e.directVictimId])).toEqual([
        [9, 0.25, 5150, 'patrol-ship'], [9, 0.25, 4850, 'player-ship'],
      ])
      expect(at(result, 'player', 9).events.filter((e) => e.kind === 'own-damage')).toMatchObject([{ shieldsLost: 5, hullLost: 85 }])
      expect(at(result, 'patrol', 9).events.filter((e) => e.kind === 'own-damage')).toMatchObject([{ shieldsLost: 25, hullLost: 100 }])
      expect(result.internalEvents.filter((e) => e.kind === 'damage').map((e) => [...e.sourceIds].sort())).toEqual([
        ['patrol-missile-1', 'player-missile-1'], ['patrol-missile-1', 'player-missile-1', 'player-ship'],
      ])
      expect(result.nextState.ships.player.hull).toBe(15)
      expect(result.nextState.ships.patrol).toMatchObject({ alive: false, destructionTick: 9, ammunition: 2 })
      expect(result.presentations.player.assessment.weaponAttempt).toEqual({ kind: 'fired', tick: 9, weapon: 'laser' })
      expect(result.presentations.patrol.assessment.weaponAttempt).toEqual({ kind: 'fired', tick: 9, weapon: 'missile' })
      expect(result.nextState.missiles).toMatchObject([{ id: 'patrol-missile-2', launchTick: 9, position: { x: 5700, y: 10500 } }])
      for (const sides of [['player', 'patrol'], ['patrol', 'player']] as const) {
        const permuted = { ...state, ships: { patrol: state.ships.patrol, player: state.ships.player }, missiles: [...state.missiles].reverse() }
        const reversed = resolveTurnInOrder(permuted, envelope(state, player, patrol), f.rules, f.scenario, sides)
        // Reversing projectile resolutions also reverses their damage-effect enumeration.
        expect(reversed.nextState.ships).toEqual(result.nextState.ships)
        expect(reversed.nextState.missiles).toEqual(result.nextState.missiles)
        expect(reversed.presentations).toEqual(result.presentations) // Includes canonical per-side event IDs/order.
      }
      expect(JSON.stringify(state)).toBe(before)
    })
  })

  it.each([900, 1000])('moving-target collision wins on the final lifetime tick; earlier expiry is harmless, lifetime=%sms', (lifetime) => {
    const rules = expiryRules(lifetime)
    const f = fixture(rules, scenario(rules, { column: 3, row: 10 }, { column: 6, row: 10 }))
    reproduce([f], () => {
      const result = f.run(f.initial, missile(0, 19), { ...hold(0), movement: { kind: 'destination', cell: { column: 3, row: 10 } } })
      // At tick 10: missile x=5300, moving patrol x=5700, gap 400. During tick 11
      // they close by 200+80; the 350-unit contact is inside that last valid sweep.
      expect(at(result, 'patrol', 10).ownShip.position.x).toBe(5700)
      expect(resolutions(result)).toHaveLength(1)
      const end = resolutions(result)[0]
      expect(end.tick).toBe(1 + rules.timing.missileLifetimeTicks)
      if (lifetime === 1000) {
        expect(end).toMatchObject({ reason: 'ship', position: { x: 5336, y: 10500 }, directVictimId: 'patrol-ship' })
        expect(end.fraction).toBeCloseTo(5 / 28)
        expect(at(result, 'patrol', 11).events.find((e) => e.kind === 'own-damage')).toMatchObject({ shieldsLost: 45, hullLost: 0 })
        expect(at(result, 'player', 11).ownMissiles[0].status).toBe('detonated')
      } else {
        expect(end).toMatchObject({ reason: 'expiry', fraction: 1, position: { x: 5300, y: 10500 } })
        expect(result.presentations.patrol.assessment.deltas).toMatchObject({ shields: 0, hull: 0 })
        expect(result.presentations.player.assessment.events.some((e) => e.kind === 'observed-impact')).toBe(false)
        expect(at(result, 'player', 10).ownMissiles[0].status).toBe('expired')
      }
      expect(result.nextState.missiles).toEqual([])
    })
  })

  it('an energy-delayed boundary launch and later absolute cooldown survive JSON round trips and multiple travel windows', () => {
    const f = fixture(CROSS_TURN_RULES, scenario(CROSS_TURN_RULES, { column: 3, row: 10 }, { column: 16, row: 16 }))
    reproduce([f], () => {
      let state = f.initial
      for (let turn = 0; turn < 4; turn++) {
        const draft = turn < 3 ? missile(turn, 19) : hold(turn)
        const result = f.run(state, draft, hold(turn))
        state = JSON.parse(JSON.stringify(result.nextState))
      }
      const [first, waiting, second, drained] = f.results
      expect(first.presentations.player.assessment.weaponAttempt).toEqual({ kind: 'fired', tick: 50, weapon: 'missile' })
      expect(first.nextState.missiles).toMatchObject([{ launchTick: 50, distanceTravelledUnits: 0, position: { x: 3500, y: 10500 } }])
      expect(at(waiting, 'player', 51).ownMissiles[0].position.x).toBe(3700)
      // The tick-50 discharge emptied energy; early ticks of the next window lack both energy and cooldown.
      expect(waiting.presentations.player.assessment.weaponAttempt).toEqual({ kind: 'unfired', weapon: 'missile', reasons: ['cooldown', 'insufficient-energy'] })
      expect(waiting.nextState.missiles[0].distanceTravelledUnits).toBe(10000)
      expect(second.presentations.player.assessment.weaponAttempt).toEqual({ kind: 'fired', tick: 110, weapon: 'missile' })
      expect(resolutions(second)).toMatchObject([{ tick: 130, reason: 'arrival', missileId: 'player-missile-1' }])
      expect(second.nextState.missiles).toMatchObject([{ launchTick: 110, distanceTravelledUnits: 8000 }])
      expect(resolutions(drained)).toMatchObject([{ tick: 190, reason: 'arrival', missileId: 'player-missile-2' }])
      expect(state).toMatchObject({ tick: 200, turnIndex: 4, missiles: [], outcome: null, ships: { player: { ammunition: 4, missileReadyTick: 170 } } })
      expect(f.results.flatMap((r) => r.internalEvents.filter((e) => e.kind === 'shot').map((e) => e.tick))).toEqual([50, 110])
    })
  })

  it('keeps stale enemy knowledge and incoming-threat publication identical after an unseen death until the permitted result boundary', () => {
    const world = scenario(PRIVACY_RULES, { column: 6, row: 10 }, { column: 16, row: 10 })
    const fragile = fixture(PRIVACY_RULES, world, { hull: 45, shields: 0 })
    const sturdy = fixture(PRIVACY_RULES, world)
    reproduce([fragile, sturdy], () => {
      const player: TurnOrders = { ...missile(0, 16), sensor: 'activePulse', cloak: true }
      const dead = fragile.run(fragile.initial, player, missile(0, 6))
      const alive = sturdy.run(sturdy.initial, player, missile(0, 6))
      expect(dead.nextState).toMatchObject({ outcome: null, terminalPending: true, ships: { patrol: { alive: false, destructionTick: 50 } } })
      expect(alive.nextState.ships.patrol.alive).toBe(true)
      expect(dead.nextState.missiles).toMatchObject([{ launcherSide: 'patrol', launchTick: 40, aim: { column: 6, row: 10 } }])
      expect(dead.presentations.player).toEqual(alive.presentations.player)
      expect(dead.presentations.player.assessment.ordnancePending).toBeNull()
      const hidden = observeSide(dead.nextState, 'player', PRIVACY_RULES, world)
      const control = observeSide(alive.nextState, 'player', PRIVACY_RULES, world)
      expect(hidden).toEqual(control)
      expect(hidden.contacts).toMatchObject([{ kind: 'stale', measurement: { tick: 44 }, ageTicks: 6 }])
      expect(hidden.observedOpponentDestructionTick).toBeUndefined()
      for (const draft of [laser(1), missile(1, 16, 9), { ...hold(1), movement: { kind: 'destination', cell: { column: 6, row: 9 } } } as TurnOrders]) {
        expect(validateOrders(draft, hidden, PRIVACY_RULES)).toEqual(validateOrders(draft, control, PRIVACY_RULES))
        expect(validateOrders(draft, hidden, PRIVACY_RULES).structurallyValid).toBe(true)
        expect(previewRoute(draft.movement, hidden.ownShip, hidden.map, PRIVACY_RULES)).toEqual(previewRoute(draft.movement, control.ownShip, control.map, PRIVACY_RULES))
      }
      const nextDead = fragile.run(dead.nextState, { ...hold(1), cloak: true }, null)
      const nextAlive = sturdy.run(alive.nextState, { ...hold(1), cloak: true }, hold(1))
      expect(nextDead.presentations.player.frames.filter((f) => f.tick < 100)).toEqual(nextAlive.presentations.player.frames.filter((f) => f.tick < 100))
      expect(at(nextDead, 'player', 55).hostileMissiles).toMatchObject([{ alias: 'missile-1', kind: 'current', measurement: { tick: 55, position: { x: 13500, y: 10500 } } }])
      expect(at(nextDead, 'player', 89).events.find((e) => e.kind === 'own-damage')).toMatchObject({ shieldsLost: 40, hullLost: 5 })
      expect(nextDead.nextState.outcome).toEqual({ outcome: 'victory', revealTick: 100 })
      expect(nextAlive.nextState.outcome).toBeNull()
      for (const result of [dead, nextDead]) {
        for (const frame of result.presentations.player.frames) {
          const enemyOnly = JSON.stringify({ contacts: frame.observation.contacts, hostileMissiles: frame.observation.hostileMissiles })
          expect(enemyOnly).not.toMatch(/aim|launcher|entityId|patrol-missile|energy|hull|shields/)
          expect(frame.observation.ownMissiles.every((m) => m.id.startsWith('player-missile-'))).toBe(true)
          if (frame.tick < 100) expect(frame.observation.outcome).toBeUndefined()
        }
      }
    })
  })

  it.each([false, true])('drains finite automatic blind-launch tails from own knowledge; destruction observed=%s', (observed) => {
    const f = fixture(TAIL_RULES, scenario(TAIL_RULES, { column: 6, row: 10 }, { column: 16, row: 10 }))
    reproduce([f], () => {
      const patrol: TurnOrders = { ...missile(0, 6), sensor: observed ? 'activePulse' : 'passive' }
      let state = f.run(f.initial, missile(0, 6, 0), patrol).nextState
      expect(state).toMatchObject({ outcome: null, terminalPending: true, ships: { player: { alive: false, destructionTick: 50 } } })
      expect(observeSide(state, 'patrol', f.rules, f.scenario).observedOpponentDestructionTick).toBe(observed ? 50 : undefined)
      const bound = aftermathWindowBound(f.rules, state.ships.patrol.ammunition)
      let windows = 0
      const blindLaunchTicks: number[] = []
      while (state.outcome === null && windows < bound) {
        const own = observeSide(state, 'patrol', f.rules, f.scenario)
        // This tiny policy receives only an observation: no alive flag, terminalPending or private missile list.
        const draft = blindPolicy(own)
        expect(validateOrders(draft, own, f.rules).structurallyValid).toBe(true)
        if (observed && own.ownShip.ammunition.current > 0) {
          expect(validateOrders(missile(own.turnIndex, 19, 0), own, f.rules).issues).toContainEqual({ field: 'weapon', severity: 'error', code: 'observed-opponent-destroyed' })
        }
        const result = f.run(state, null, draft)
        expect(result.locked.orders.player).toBeNull()
        expect(result.presentations.player.automatic).toBe(true)
        blindLaunchTicks.push(...result.internalEvents.filter((e) => e.kind === 'shot' && e.weapon === 'missile').map((e) => e.tick))
        for (const frame of result.presentations.patrol.frames) {
          expect(frame.observation.ownShip.ammunition.current).toBeGreaterThanOrEqual(0)
          expect(frame.observation.ownShip.energy.currentMilli).toBeGreaterThanOrEqual(0)
          expect(frame.observation.ownShip.energy.currentMilli).toBeLessThanOrEqual(f.rules.ships['patrol-frigate'].maxEnergyMilli)
        }
        state = result.nextState
        windows++
      }
      expect(windows).toBe(observed ? 1 : 4)
      expect(windows).toBeLessThanOrEqual(bound)
      expect(blindLaunchTicks).toEqual(observed ? [] : [61, 121, 181])
      expect(state.missiles).toEqual([])
      expect(state.outcome).toEqual({ outcome: 'defeat', revealTick: observed ? 100 : 250 })
      expect(state.ships.patrol.ammunition).toBe(observed ? 3 : 0)
      expect(f.results.flatMap((r) => resolutions(r))).toHaveLength(observed ? 2 : 5)
    })
  })
})

function blindPolicy(own: SideObservation): TurnOrders {
  return own.observedOpponentDestructionTick !== undefined || own.ownShip.ammunition.current === 0
    ? hold(own.turnIndex) : missile(own.turnIndex, 19, 0)
}
