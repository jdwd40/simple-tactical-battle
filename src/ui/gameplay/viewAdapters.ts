import type { GameView, MovementOrder, OwnRoutePreview, PublicReplayFrame, ReplayPrefix, TurnOrders, ValidationIssue } from '../../contracts'

/** Everything the plot and movement controls need from one published GameView. */
export interface GameplayPresentation {
  readonly frames: readonly PublicReplayFrame[]
  readonly routePreview: OwnRoutePreview | null
  readonly replay: ReplayPrefix | null
  readonly movement: MovementOrder | null
  readonly issues: readonly ValidationIssue[]
  /** Planning only: plot clicks and grid entry change the draft. */
  readonly editable: boolean
  readonly lockedReason: string | null
  readonly playbackUnavailableReason: string
}

const lockedOrders = (view: { readonly lockedOwnOrders: TurnOrders | null }) => view.lockedOwnOrders?.movement ?? null

/**
 * Pure mapping from the controller's view. Frames come only from the view's current frame
 * or its cursor-bounded replay prefix, so nothing here can reach future or private state.
 */
export function presentGameView(view: GameView): GameplayPresentation {
  const prefixFrames = (replay: ReplayPrefix | null) => (replay && replay.frames.length > 0 ? replay.frames : [view.frame])
  switch (view.phase) {
    case 'planning':
      return {
        frames: [view.frame], routePreview: view.routePreview, replay: null, movement: view.draft.movement,
        issues: view.validation.issues, editable: true, lockedReason: null,
        playbackUnavailableReason: 'Playback is available after you commit the turn',
      }
    case 'commit':
      return {
        frames: [view.frame], routePreview: null, replay: null, movement: view.lockedOwnOrders.movement,
        issues: [], editable: false, lockedReason: 'Orders are committed for this turn.',
        playbackUnavailableReason: 'Resolving the committed turn',
      }
    case 'execution':
      return {
        frames: prefixFrames(view.replay), routePreview: null, replay: view.replay, movement: lockedOrders(view),
        issues: [], editable: false,
        lockedReason: view.automatic ? 'Your ship was destroyed; remaining ordnance resolves automatically.' : 'Orders are locked while the turn plays.',
        playbackUnavailableReason: '',
      }
    case 'assessment':
      return {
        frames: prefixFrames(view.replay), routePreview: null, replay: view.replay, movement: lockedOrders(view),
        issues: [], editable: false, lockedReason: 'Continue to planning to give new orders.',
        playbackUnavailableReason: '',
      }
    case 'terminal':
      return {
        frames: prefixFrames(view.replay), routePreview: null, replay: view.replay, movement: lockedOrders(view),
        issues: [], editable: false, lockedReason: 'The encounter has ended.',
        playbackUnavailableReason: 'No replay is available',
      }
  }
}
