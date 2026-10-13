import type { Scenario, SimulationState, TurnPresentation } from '../contracts/private'
import type {
  CommitResult, GameController, GameView, OrderValidation, OwnRoutePreview, PlanOpponent, PlaybackCommand,
  PreviewRoute, PublicReplayFrame, ReplayPrefix, RestartCommand, Ruleset, SideObservation, Tick, TurnOrders,
  ValidateOrders, VisibleEvent,
} from '../contracts/public'
import type { InitialiseSession, ResolveTurn } from '../contracts/private'
import { freezeData } from '../scenarios/freeze'
import { DUEL_SCENARIO } from '../scenarios/private'
import { DUEL_RULES } from '../scenarios/public'
import { initialiseSession, observeSide, previewRoute, resolveTurn, validateOrders } from '../simulation'
import { browserClock, type PresentationClock } from './presentationClock'
import { scriptedPatrol } from './scriptedPatrol'

type Speed = ReplayPrefix['playback']['speed']

/** The engine functions the controller calls; injectable so tests can count or wrap them. */
export interface EngineApi {
  readonly initialiseSession: InitialiseSession
  readonly observeSide: (state: SimulationState, side: 'player' | 'patrol', rules: Ruleset, scenario: Scenario) => SideObservation
  readonly validateOrders: ValidateOrders
  readonly previewRoute: PreviewRoute
  readonly resolveTurn: ResolveTurn
}

export const SIMULATION_ENGINE: EngineApi = { initialiseSession, observeSide, validateOrders, previewRoute, resolveTurn }

export interface GameControllerOptions {
  /** Seed for the first encounter and every same-seed restart until a new seed is drawn. */
  readonly seed: number
  /** Entropy for new-seed restarts (application responsibility, never the engine). */
  readonly newSeed: () => number
  readonly clock?: PresentationClock
  readonly engine?: EngineApi
  /** Opponent planner from its own observation/memory/stream. Defaults to the interim drill script. */
  readonly planOpponent?: PlanOpponent
  readonly scenario?: Scenario
  readonly rules?: Ruleset
}

/** The public controller plus application lifecycle. UI receives only the GameController part. */
export interface ApplicationController extends GameController {
  /** Cancels presentation timers and pauses playback (unmount). Commands remain usable. */
  dispose(): void
}

interface Planning {
  readonly observation: SideObservation
  readonly frame: PublicReplayFrame
  readonly draft: TurnOrders
  readonly validation: OrderValidation
  readonly preview: OwnRoutePreview
  /** Opponent plan made once at planning entry; editing the draft never re-plans it. */
  readonly opponent: ReturnType<PlanOpponent>
}

interface ResolvedTurn {
  readonly locked: TurnOrders
  readonly presentation: TurnPresentation
}

interface Encounter {
  readonly id: string
  readonly seed: number
  state: SimulationState
  phase: GameView['phase']
  planning: Planning | null
  turn: ResolvedTurn | null
  cursor: Tick
  replayOf: null | 'assessment'
  /** Last frame published to the player; abandon freezes on it rather than revealing more. */
  lastFrame: PublicReplayFrame | null
}

const freezeArray = <T>(items: T[]): readonly T[] => Object.freeze(items)

export function createGameController(options: GameControllerOptions): ApplicationController {
  const engine = options.engine ?? SIMULATION_ENGINE
  const clock = options.clock ?? browserClock
  const planOpponent = options.planOpponent ?? scriptedPatrol
  const scenario = options.scenario ?? DUEL_SCENARIO
  const rules = options.rules ?? DUEL_RULES
  const listeners = new Set<() => void>()

  let encounterCount = 0
  let seed = options.seed
  let revision = 0
  let playing = false
  let speed: Speed = 1
  let cancelTimer: (() => void) | null = null
  let encounter: Encounter
  let view: GameView

  function enterPlanning(target: Encounter) {
    const observation = engine.observeSide(target.state, 'player', rules, scenario)
    const own = observation.ownShip
    const draft: TurnOrders = freezeData({
      turnIndex: observation.turnIndex,
      movement: own.destination ? { kind: 'destination', cell: { ...own.destination } } : { kind: 'hold' },
      sensor: 'passive',
      cloak: own.cloak.actual,
      weapon: { kind: 'hold' },
    })
    const patrolObservation = engine.observeSide(target.state, 'patrol', rules, scenario)
    const planned = planOpponent(patrolObservation, target.state.plannerMemory.patrol, target.state.random.planners.patrol)
    const opponentValid = engine.validateOrders(planned.orders, patrolObservation, rules).structurallyValid
    const opponent = opponentValid ? planned : {
      ...planned,
      orders: { turnIndex: patrolObservation.turnIndex, movement: { kind: 'hold' }, sensor: 'passive', cloak: false, weapon: { kind: 'hold' } } as const,
    }
    const frame: PublicReplayFrame = freezeData({ tick: observation.tick, observation, events: [] })
    target.planning = {
      observation, frame, draft, opponent: freezeData(opponent),
      validation: engine.validateOrders(draft, observation, rules),
      preview: engine.previewRoute(draft.movement, own, observation.map, rules),
    }
    target.turn = null
    target.replayOf = null
    target.cursor = observation.tick
    target.lastFrame = frame
    target.phase = 'planning'
  }

  function newEncounter(): Encounter {
    encounterCount += 1
    const created: Encounter = {
      id: `encounter-${encounterCount}`, seed,
      state: engine.initialiseSession(scenario, rules, seed),
      phase: 'planning', planning: null, turn: null, cursor: 0, replayOf: null, lastFrame: null,
    }
    enterPlanning(created)
    return created
  }

  function prefix(turn: ResolvedTurn, cursor: Tick): ReplayPrefix {
    const { presentation } = turn
    const frames = presentation.frames.slice(0, cursor - presentation.startTick + 1)
    const seen = new Set<string>()
    const events: VisibleEvent[] = []
    for (const frame of frames) {
      for (const event of frame.events) {
        if (seen.has(event.id)) continue
        seen.add(event.id)
        events.push(event)
      }
    }
    events.sort((a, b) => a.tick - b.tick || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return Object.freeze({
      scope: 'latest-player-turn-with-aftermath',
      startTick: presentation.startTick,
      endTick: presentation.endTick,
      cursorTick: cursor,
      frames: freezeArray(frames),
      events: freezeArray(events),
      playback: Object.freeze({ playing, speed }),
    })
  }

  function buildView(): GameView {
    const base = { encounterId: encounter.id, revision, rules }
    const { planning, turn } = encounter
    switch (encounter.phase) {
      case 'planning':
        return { ...base, phase: 'planning', frame: planning!.frame, draft: planning!.draft, validation: planning!.validation, routePreview: planning!.preview, replay: null }
      case 'commit':
        return { ...base, phase: 'commit', frame: planning!.frame, lockedOwnOrders: planning!.draft, replay: null }
      case 'execution': {
        const replay = prefix(turn!, encounter.cursor)
        return { ...base, phase: 'execution', frame: replay.frames[replay.frames.length - 1], replay, replayOf: encounter.replayOf, automatic: false, lockedOwnOrders: turn!.locked }
      }
      case 'assessment': {
        const replay = prefix(turn!, turn!.presentation.endTick)
        return { ...base, phase: 'assessment', frame: replay.frames[replay.frames.length - 1], lockedOwnOrders: turn!.locked, replay, assessment: turn!.presentation.assessment }
      }
      case 'terminal':
        return { ...base, phase: 'terminal', frame: encounter.lastFrame!, lockedOwnOrders: null, replay: null, result: { kind: 'abandoned' } }
    }
  }

  function publish() {
    revision += 1
    view = Object.freeze(buildView())
    encounter.lastFrame = view.frame
    for (const listener of [...listeners]) listener()
  }

  function stopTimer() {
    cancelTimer?.()
    cancelTimer = null
  }

  /** Schedules the next cursor tick for this encounter only; a stale callback is a no-op. */
  function scheduleTick() {
    stopTimer()
    if (!playing || encounter.phase !== 'execution') return
    const owner = encounter
    cancelTimer = clock.schedule(rules.timing.tickMs / speed, () => {
      cancelTimer = null
      if (owner !== encounter || !playing || encounter.phase !== 'execution') return
      moveCursor(encounter.cursor + 1)
      scheduleTick()
    })
  }

  /** Moves the presentation cursor; reaching the end reveals the assessment. */
  function moveCursor(tick: Tick) {
    const { startTick, endTick } = encounter.turn!.presentation
    encounter.cursor = Math.min(endTick, Math.max(startTick, Math.trunc(tick)))
    if (encounter.cursor >= endTick) {
      encounter.phase = 'assessment'
      encounter.replayOf = null
      playing = false
      stopTimer()
    } else if (encounter.phase === 'assessment') {
      encounter.phase = 'execution'
      encounter.replayOf = 'assessment'
    }
    publish()
  }

  function startEncounter() {
    stopTimer()
    playing = false
    encounter = newEncounter()
    publish()
  }

  const controller: ApplicationController = {
    getView: () => view,

    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    setDraft(orders) {
      const planning = encounter.planning
      if (encounter.phase !== 'planning' || !planning) return
      const draft = freezeData(structuredClone(orders))
      encounter.planning = {
        ...planning, draft,
        validation: engine.validateOrders(draft, planning.observation, rules),
        preview: engine.previewRoute(draft.movement, planning.observation.ownShip, planning.observation.map, rules),
      }
      publish()
    },

    commit(expectedTurnIndex): CommitResult {
      const planning = encounter.planning
      if (encounter.phase !== 'planning' || !planning) return { kind: 'ignored', reason: 'wrong-phase' }
      if (expectedTurnIndex !== encounter.state.turnIndex || planning.draft.turnIndex !== expectedTurnIndex) {
        return { kind: 'ignored', reason: 'stale-turn' }
      }
      const validation = engine.validateOrders(planning.draft, planning.observation, rules)
      if (!validation.structurallyValid) return { kind: 'rejected', validation }

      // Lock both envelopes before any tick runs, then resolve exactly once.
      encounter.phase = 'commit'
      publish()
      const state = encounter.state
      const prepared: SimulationState = freezeData({
        ...state,
        plannerMemory: { ...state.plannerMemory, patrol: planning.opponent.memory },
        random: { ...state.random, planners: { ...state.random.planners, patrol: planning.opponent.plannerRandomState } },
      })
      let resolution
      try {
        resolution = engine.resolveTurn(prepared, {
          turnIndex: state.turnIndex, startTick: state.tick, automatic: false,
          orders: { player: planning.draft, patrol: planning.opponent.orders },
        }, rules, scenario)
      } catch (error) {
        encounter.phase = 'planning'
        publish()
        throw error
      }
      encounter.state = resolution.nextState
      encounter.turn = { locked: planning.draft, presentation: resolution.presentations.player }
      encounter.planning = null
      encounter.phase = 'execution'
      encounter.replayOf = null
      encounter.cursor = resolution.presentations.player.startTick
      playing = true
      publish()
      scheduleTick()
      return { kind: 'accepted', turnIndex: expectedTurnIndex, revision }
    },

    playback(command: PlaybackCommand) {
      if (!encounter.turn || (encounter.phase !== 'execution' && encounter.phase !== 'assessment')) return
      const { startTick, endTick } = encounter.turn.presentation
      switch (command.kind) {
        case 'play':
          if (encounter.phase === 'assessment') {
            // Replay from the start of the assessed turn.
            playing = true
            moveCursor(startTick)
          } else {
            playing = true
            publish()
          }
          break
        case 'pause':
          if (!playing) return
          playing = false
          publish()
          break
        case 'speed':
          if (![0.5, 1, 2, 4].includes(command.speed) || command.speed === speed) return
          speed = command.speed
          publish()
          break
        case 'seek':
          if (!Number.isFinite(command.tick)) return
          moveCursor(command.tick)
          break
        case 'step':
          playing = false
          moveCursor(encounter.cursor + (command.direction === -1 ? -1 : 1))
          break
        case 'skipToEnd':
          moveCursor(endTick)
          break
      }
      scheduleTick()
    },

    finishAssessment() {
      const assessed = encounter.phase === 'assessment' || (encounter.phase === 'execution' && encounter.replayOf === 'assessment')
      if (!assessed) return
      stopTimer()
      playing = false
      enterPlanning(encounter)
      publish()
    },

    abandon() {
      if (encounter.phase === 'terminal') return
      stopTimer()
      playing = false
      encounter.phase = 'terminal'
      encounter.planning = null
      encounter.turn = null
      publish()
    },

    restart(command: RestartCommand) {
      if (command.kind === 'new-seed') seed = options.newSeed()
      startEncounter()
    },

    dispose() {
      stopTimer()
      if (playing) {
        playing = false
        publish()
      }
    },
  }

  encounter = newEncounter()
  view = Object.freeze(buildView())
  encounter.lastFrame = view.frame
  return controller
}
