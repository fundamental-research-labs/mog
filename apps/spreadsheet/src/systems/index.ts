/**
 * Systems Barrel Exports
 *
 * Re-exports all system interfaces and types from the subsystem architecture.
 *
 */

// =============================================================================
// GRID EDITING SYSTEM
// =============================================================================

export type {
  CommentHoverCoordinator,
  DragFeatureConfig,
  DrawBorderCoordinator,
  FindReplaceCoordinator,
  GridEditingActorAccess,
  GridEditingConfig,
  GridFeatureConfig,
  IGridEditingSystem,
} from './grid-editing/types';

// =============================================================================
// RENDER SYSTEM
// =============================================================================

export type {
  EventSubscriptionResult,
  IRenderSystem,
  PageBreakDragState,
  PageBreakHitResult,
  RenderActorAccess,
  RenderContextConfig,
  RenderContextCoordinationConfig,
  RenderSystemConfig,
  RendererSnapshot,
  SparklineManager,
} from './renderer/types';

// =============================================================================
// OBJECT SYSTEM
// =============================================================================

export type {
  ChartUISnapshot,
  EffectiveObjectState,
  EffectiveStateService,
  IObjectSystem,
  ObjectActorAccess,
  ObjectHitResult,
  ObjectInteractionSnapshot,
  ObjectSystemConfig,
} from './objects/types';

// =============================================================================
// INPUT SYSTEM
// =============================================================================

export type {
  IInputSystem,
  InputActorAccess,
  InputDependencies,
  InputSystemConfig,
} from './input/types';

// =============================================================================
// INK SYSTEM
// =============================================================================

export type { IInkSystem, InkActorAccess, InkSystemConfig } from './ink/types';

// =============================================================================
// SHARED UTILITIES
// =============================================================================

export type { DragTerminator } from './shared/drag-terminator';
