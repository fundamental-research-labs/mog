/**
 * Coordinator Module - Barrel File
 *
 * This file re-exports all public APIs from the coordinator module.
 * The SheetCoordinator class lives in sheet-coordinator.ts.
 *
 * @see COORDINATOR-DECOMPOSITION.md
 */

// =============================================================================
// MAIN CLASS & FACTORY
// =============================================================================

export { createSheetCoordinator } from './factory';
export { SheetCoordinator } from './sheet-coordinator';

// =============================================================================
// TYPES (from ./types.ts - the single source of truth)
// =============================================================================

export type {
  ActorRefs,
  ChartActor,
  ChartState,
  ClipboardActor,
  ClipboardState,
  EditorActor,
  EditorState,
  FocusActor,
  FocusState,
  Metric,
  ObjectInteractionActor,
  ObjectInteractionState_,
  RendererActor,
  RendererDependencies,
  RendererFactory,
  RendererState,
  SelectionActor,
  SelectionState,
  SheetCoordinatorConfig,
  SheetStateProvider,
  ToolbarDependencies,
} from './types';

// =============================================================================
// CROSS-COORDINATION TYPES
// =============================================================================

export type { RenderInvalidation } from '../systems/grid-editing/coordination/cross-coordination';

// =============================================================================
// KEYBOARD COORDINATOR
// =============================================================================

export {
  KeyboardCoordinator,
  createKeyboardCoordinator,
  type KeyboardCoordinatorDependencies,
  type KeyboardHandleResult,
} from '../systems/input/keyboard/keyboard-coordinator';

// =============================================================================
// UTILITIES (smart positioning, etc.)
// =============================================================================

export {
  CHART_POSITION_PRESET,
  PIVOT_POSITION_PRESET,
  getSmartPosition,
  type AnchorPosition,
  type PositionOffset,
  type SmartPositionConfig,
  type SourceRange,
} from '../systems/objects/utils/smart-positioning';

// =============================================================================
// ACTOR ACCESS LAYER
// =============================================================================

export {
  createActorAccessLayer,
  createActorAccessLayerFromBundle,
  type ActorBundle,
} from './actor-access';
