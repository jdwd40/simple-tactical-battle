/** Engine/application entry point. Imports private contracts; never import from UI, rendering or the AI planner. */
export { initialiseSession } from './session'
export { resolveTurn } from './resolve'
export { observeSide } from './observation'
export { validateOrders, ENGINE_CAPABILITIES } from './validation'
export { previewRoute } from './route'
