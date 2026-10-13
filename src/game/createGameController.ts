import type { Scenario, SimulationState, TurnPresentation } from '../contracts/private'
import type {
  CommitResult, GameController, GameView, OrderValidation, OwnRoutePreview, PlanOpponent, PlaybackCommand,
  PreviewRoute, PublicReplayFrame, ReplayPrefix, RestartCommand, RevealedOutcome, Ruleset, SideObservation, Tick, TurnOrders,
  ValidateOrders, VisibleEvent,
} from '../contracts/public'
import type { InitialiseSession, ResolveTurn } from '../contracts/private'
import { freezeData } from '../scenarios/freeze'
import { DUEL_SCENARIO } from '../scenarios/private'
import { DUEL_RULES } from '../scenarios/public'
import { aftermathWindowBound } from '../scenarios/rules'
import { ENGINE_CAPABILITIES, initialiseSession, observeSide, previewRoute, resolveTurn, validateOrders } from '../simulation'
import { browserClock, type PresentationClock } from './presentationClock'
import { scriptedPatrol } from './scriptedPatrol'

type Speed = ReplayPrefix['playback']['speed']

/** Order kinds the engine actually performs; controls offer only these. */
export interface EngineCapabilities {
  readonly activePulse: boolean
  readonly laser: boolean
  readonly missile: boolean
}

/** The engine functions the controller calls; injectable so tests can count or wrap them. */
export interface EngineApi {
  readonly capabilities: EngineCapabilities
  readonly initialiseSession: InitialiseSession
  readonly observeSide: (state: SimulationState, side: 'player' | 'patrol', rules: Ruleset, scenario: Scenario) => SideObservation
  readonly validateOrders: ValidateOrders
  readonly previewRoute: PreviewRoute
  readonly resolveTurn: ResolveTurn
}

export const SIMULATION_ENGINE: EngineApi = { capabilities: ENGINE_CAPABILITIES, initialiseSession, observeSide, validateOrders, previewRoute, resolveTurn }

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
  /** The injected engine's capabilities, for the composition root to hand to the console. */
  readonly capabilities: EngineCapabilities
  /**
   * Seed of the given encounter while it is the current one, as plain reproduction data; null
   * for any other id. A primitive only: no session or world state is reachable through it.
   */
  seedOf(encounterId: string): number | null
  /** Cancels presentation timers and pauses playback (unmount). Commands remain usable. */
  dispose(): void
}

interface Planning {
  readonly observation: SideObservation
  readonly frame: PublicReplayFrame
  readonly draft: TurnOrders
  readonly validation: OrderValidation
  readonly preview: OwnRoutePreview
  /** Opponent plan made once at planning entry; editing the draft never re-plans it. Null for a destroyed opponent. */
  readonly opponent: ReturnType<PlanOpponent> | null
}

interface ResolvedTurn {
  /** The player's committed orders for the latest player turn. */
  readonly locked: TurnOrders
  /** That turn's presentation, then each automatic window, appended only as it begins. */
  readonly windows: TurnPresentation[]
}

type Ending = { readonly kind: 'abandoned' } | { readonly kind: 'combat' }

interface Encounter {
  readonly id: string
  readonly seed: number
  state: SimulationState
  phase: GameView['phase']
  planning: Planning | null
  turn: ResolvedTurn | null
  cursor: Tick
  replayOf: null | 'assessment' | 'terminal'
  /** Last frame published to the player; abandon freezes on it rather than revealing more. */
  lastFrame: PublicReplayFrame | null
  /** Recorded combat ending, held privately until the cursor reaches its reveal tick. */
  outcome: RevealedOutcome | null
  /** Automatic windows begun after own destruction, against the approved aftermath bound. */
  aftermath: { count: number; readonly bound: number } | null
  ending: Ending | null
}

const holdOrders = (turnIndex: number): TurnOrders => ({ turnIndex, movement: { kind: 'hold' }, sensor: 'passive', cloak: false, weapon: { kind: 'hold' } })
const lastWindow = (turn: ResolvedTurn) => turn.windows[turn.windows.length - 1]
const startTickOf = (turn: ResolvedTurn) => turn.windows[0].startTick
const endTickOf = (turn: ResolvedTurn) => lastWindow(turn).endTick

/** The latest player turn and its attached automatic windows as one frame sequence through the cursor. */
function framesThrough(turn: ResolvedTurn, cursor: Tick): PublicReplayFrame[] {
  const frames: PublicReplayFrame[] = []
  for (const [index, window] of turn.windows.entries()) {
    // A window's starting frame repeats the previous window's recorded final tick.
    for (const frame of index === 0 ? window.frames : window.frames.slice(1)) {
      if (frame.tick > cursor) return frames
      frames.push(frame)
    }
  }
  return frames
}

/** Subtrees already frozen all the way down, so recorded frames are walked only once. */
const deepFrozen = new WeakSet<object>()

/** Recursively freezes everything the controller publishes; engine output is not trusted to be. */
function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object' || deepFrozen.has(value)) return value
  for (const child of Object.values(value)) freezeDeep(child)
  Object.freeze(value)
  deepFrozen.add(value)
  return value
}

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
    const opponent = planPatrol(target.state)
    const frame: PublicReplayFrame = freezeData({ tick: observation.tick, observation, events: [] })
    target.planning = {
      observation, frame, draft, opponent: opponent && freezeData(opponent),
      validation: engine.validateOrders(draft, observation, rules),
      preview: engine.previewRoute(draft.movement, own, observation.map, rules),
    }
    target.turn = null
    target.replayOf = null
    target.cursor = observation.tick
    target.lastFrame = frame
    target.phase = 'planning'
  }

  /** The living opponent plans from its own observation, memory and stream only; a destroyed one is never asked. */
  function planPatrol(state: SimulationState): ReturnType<PlanOpponent> | null {
    if (!state.ships.patrol.alive) return null
    const observation = engine.observeSide(state, 'patrol', rules, scenario)
    const planned = planOpponent(observation, state.plannerMemory.patrol, state.random.planners.patrol)
    return engine.validateOrders(planned.orders, observation, rules).structurallyValid ? planned : { ...planned, orders: holdOrders(observation.turnIndex) }
  }

  /** The state handed to resolution, carrying the opponent's updated planner memory and stream. */
  function withOpponentPlan(state: SimulationState, opponent: ReturnType<PlanOpponent> | null): SimulationState {
    if (!opponent) return state
    return freezeData({
      ...state,
      plannerMemory: { ...state.plannerMemory, patrol: opponent.memory },
      random: { ...state.random, planners: { ...state.random.planners, patrol: opponent.plannerRandomState } },
    })
  }

  function newEncounter(): Encounter {
    encounterCount += 1
    const created: Encounter = {
      id: `encounter-${encounterCount}`, seed,
      state: engine.initialiseSession(scenario, rules, seed),
      phase: 'planning', planning: null, turn: null, cursor: 0, replayOf: null, lastFrame: null,
      outcome: null, aftermath: null, ending: null,
    }
    enterPlanning(created)
    return created
  }

  function prefix(turn: ResolvedTurn, cursor: Tick): ReplayPrefix {
    const frames = framesThrough(turn, cursor)
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
    return {
      scope: 'latest-player-turn-with-aftermath',
      startTick: startTickOf(turn),
      // Only windows already begun: the horizon extends as each automatic window starts.
      endTick: endTickOf(turn),
      cursorTick: cursor,
      frames,
      events,
      playback: { playing, speed },
    }
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
        const frame = replay.frames[replay.frames.length - 1]
        const common = { ...base, phase: 'execution' as const, frame, replay, replayOf: encounter.replayOf }
        // Past the player's committed turn, only automatic windows after own destruction remain.
        return encounter.cursor > turn!.windows[0].endTick
          ? { ...common, automatic: true, reason: 'own-destroyed', lockedOwnOrders: null }
          : { ...common, automatic: false, lockedOwnOrders: turn!.locked }
      }
      case 'assessment': {
        const replay = prefix(turn!, endTickOf(turn!))
        return { ...base, phase: 'assessment', frame: replay.frames[replay.frames.length - 1], lockedOwnOrders: turn!.locked, replay, assessment: lastWindow(turn!).assessment }
      }
      case 'terminal': {
        if (encounter.ending?.kind === 'combat') {
          const replay = prefix(turn!, endTickOf(turn!))
          return {
            ...base, phase: 'terminal', frame: replay.frames[replay.frames.length - 1], lockedOwnOrders: turn!.locked, replay,
            result: { kind: 'combat', outcome: encounter.outcome!, assessment: lastWindow(turn!).assessment },
          }
        }
        return { ...base, phase: 'terminal', frame: encounter.lastFrame!, lockedOwnOrders: null, replay: null, result: { kind: 'abandoned' } }
      }
    }
  }

  /** Publishes a new immutable view and returns its revision (listeners may publish again). */
  function publish(): number {
    revision += 1
    const published = revision
    view = freezeDeep(buildView())
    encounter.lastFrame = view.frame
    for (const listener of [...listeners]) listener()
    return published
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

  /**
   * Moves the presentation cursor. Reaching the end reveals what the recording holds for that
   * tick: the outcome at its reveal tick, the next automatic window after own destruction, or
   * the assessment. Nothing is revealed or resolved earlier.
   */
  function moveCursor(tick: Tick) {
    const turn = encounter.turn!
    const endTick = endTickOf(turn)
    encounter.cursor = Math.min(endTick, Math.max(startTickOf(turn), Math.trunc(tick)))
    if (encounter.cursor >= endTick) {
      if (encounter.outcome && encounter.outcome.revealTick <= encounter.cursor) {
        encounter.phase = 'terminal'
        encounter.ending = { kind: 'combat' }
        encounter.replayOf = null
        playing = false
        stopTimer()
      } else if (!encounter.state.ships.player.alive) {
        beginAutomaticWindow(encounter)
      } else {
        encounter.phase = 'assessment'
        encounter.replayOf = null
        playing = false
        stopTimer()
      }
    } else if (encounter.phase === 'assessment' || encounter.phase === 'terminal') {
      encounter.replayOf = encounter.phase
      encounter.phase = 'execution'
    }
    publish()
  }

  /**
   * After own destruction, resolves the next bounded automatic WEGO window exactly once, when it
   * begins. The living opponent plans from its own observation only; a destroyed one is not asked.
   */
  function beginAutomaticWindow(owner: Encounter) {
    const state = owner.state
    const survivorAmmunition = (['player', 'patrol'] as const).reduce((sum, side) => sum + (state.ships[side].alive ? state.ships[side].ammunition : 0), 0)
    owner.aftermath ??= { count: 0, bound: aftermathWindowBound(rules, survivorAmmunition) }
    if (owner.aftermath.count >= owner.aftermath.bound) {
      // Internal invariant failure: stop rather than invent a draw.
      playing = false
      stopTimer()
      console.error(`Automatic aftermath exceeded its bound of ${owner.aftermath.bound} windows without an outcome`)
      return
    }
    const opponent = planPatrol(state)
    const resolution = engine.resolveTurn(withOpponentPlan(state, opponent), {
      turnIndex: state.turnIndex, startTick: state.tick, automatic: true,
      orders: { player: null, patrol: opponent?.orders ?? null },
    }, rules, scenario)
    owner.aftermath.count += 1
    owner.state = resolution.nextState
    owner.outcome = resolution.nextState.outcome
    owner.turn!.windows.push(resolution.presentations.player)
    owner.phase = 'execution'
  }

  function startEncounter() {
    stopTimer()
    playing = false
    encounter = newEncounter()
    publish()
  }

  const controller: ApplicationController = {
    // Whitelisted immutable booleans only; nothing else of the engine reaches the console.
    capabilities: Object.freeze({
      activePulse: engine.capabilities.activePulse === true,
      laser: engine.capabilities.laser === true,
      missile: engine.capabilities.missile === true,
    }),

    getView: () => view,

    seedOf: (encounterId) => (encounter.id === encounterId ? encounter.seed : null),

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

      // Both envelopes are already frozen; resolve exactly once, privately, before publishing.
      const owner = encounter
      const state = owner.state
      const resolution = engine.resolveTurn(withOpponentPlan(state, planning.opponent), {
        turnIndex: state.turnIndex, startTick: state.tick, automatic: false,
        orders: { player: planning.draft, patrol: planning.opponent?.orders ?? null },
      }, rules, scenario)

      owner.phase = 'commit'
      publish()
      // A subscriber may have restarted or abandoned during that publication; never resume it.
      if (encounter !== owner || owner.phase !== 'commit') return { kind: 'ignored', reason: 'wrong-phase' }

      owner.state = resolution.nextState
      owner.turn = { locked: planning.draft, windows: [resolution.presentations.player] }
      owner.outcome = resolution.nextState.outcome
      owner.aftermath = null
      owner.planning = null
      owner.phase = 'execution'
      owner.replayOf = null
      owner.cursor = resolution.presentations.player.startTick
      playing = true
      const accepted = publish()
      scheduleTick()
      return { kind: 'accepted', turnIndex: expectedTurnIndex, revision: accepted }
    },

    playback(command: PlaybackCommand) {
      const replayable = encounter.phase === 'execution' || encounter.phase === 'assessment' || (encounter.phase === 'terminal' && encounter.ending?.kind === 'combat')
      if (!encounter.turn || !replayable) return
      const turn = encounter.turn
      switch (command.kind) {
        case 'play':
          if (encounter.phase === 'assessment' || encounter.phase === 'terminal') {
            // Replay the recorded turn (and any aftermath) from its start; nothing resolves again.
            playing = true
            moveCursor(startTickOf(turn))
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
        case 'skipToEnd': {
          // Through every window as it begins, to the assessment or the revealed ending.
          let end: Tick
          do {
            end = endTickOf(turn)
            moveCursor(end)
          } while (encounter.turn === turn && encounter.phase === 'execution' && endTickOf(turn) > end)
          break
        }
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
      // A recorded combat ending stays final, including while its replay plays.
      if (encounter.phase === 'terminal' || encounter.ending) return
      stopTimer()
      playing = false
      encounter.phase = 'terminal'
      encounter.ending = { kind: 'abandoned' }
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
  view = freezeDeep(buildView())
  encounter.lastFrame = view.frame
  return controller
}
