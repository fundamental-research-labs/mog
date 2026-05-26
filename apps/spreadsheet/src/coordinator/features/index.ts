/**
 * Features Module
 *
 * Barrel file for all feature-based coordination modules.
 * Each feature handles a specific user-facing concern.
 *
 * All coordination modules now live in their respective system directories
 * under systems/. This barrel re-exports from those locations.
 *
 * Note: Actor/State types (SelectionActor, EditorActor, etc.) are defined in
 * multiple modules. The canonical exports come from grid-editing/coordination/cross-coordination.
 * Other modules import these types rather than re-exporting.
 *
 */

// Selection + Editing + Clipboard + Range Selection coordination
export * from '../../systems/grid-editing/coordination';

// Grid editing features
export * from '../../systems/grid-editing/features/fill';
export * from '../../systems/grid-editing/features/find-replace';
export * from '../../systems/grid-editing/features/flash-fill';
export * from '../../systems/grid-editing/features/resize';
export * from '../../systems/grid-editing/features/structure';
export * from '../../systems/grid-editing/features/table-resize';

// Input + Pane navigation coordination
export * from '../../systems/input/coordination';

// Objects + Chart + Diagram coordination
export * from '../../systems/objects/coordination';

// Feature coordination modules
export * from '../../systems/grid-editing/features/checkbox';
export * from '../../systems/grid-editing/features/comment';
export * from '../../systems/grid-editing/features/split';
export * from '../../systems/grid-editing/features/table';
export * from '../../systems/grid-editing/features/toolbar';
export * from '../../systems/grid-editing/features/validation';
export * from '../../systems/ink/coordination';

// Renderer + Sparkline + CF + Layout coordination
export * from '../../systems/renderer/coordination';
export * from '../../systems/renderer/features/page-break';

// Auto-scroll feature coordination
export * from '../../systems/grid-editing/features/auto-scroll';

// Sheet switch coordination (re-export from subscriptions)
export {
  setupSheetSwitchCoordination,
  type OnSheetSwitchCallback,
  type SheetSwitchCoordinationConfig,
} from '../../systems/grid-editing/subscriptions/sheet-switch-coordination';
