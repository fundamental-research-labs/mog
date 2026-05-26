/**
 * Actor Access Layer
 *
 * Exports for actor-related types and interfaces.
 * Runtime selectors have been moved to @mog-sdk/kernel/selectors.
 *
 * ARCHITECTURE: Selectors are the single primitive for extraction logic.
 * - Snapshots compose selectors (no duplication)
 * - Accessors wrap selectors + getSnapshot() (no duplication)
 * - Hooks use selectors directly with useSelector (no duplication)
 *
 * @module @mog-sdk/contracts/actors
 */

// =============================================================================
// TYPE EXPORTS (types remain in contracts)
// =============================================================================

// Selection actor types
export type { SelectionAccessor, SelectionState } from './selection';

// Editor actor types
export type { EditorAccessor, EditorState, FormulaContext, FunctionStackEntry } from './editor';

// Clipboard actor types
export { EXTERNAL_SOURCE_SHEET_ID } from './clipboard';
export type {
  ClipboardAccessor,
  CellCoord as ClipboardCellCoord,
  ClipboardCellData,
  ClipboardData,
  ClipboardState,
  ExternalPastePayload,
  PasteMenuOption,
  PasteSpecialOptions,
  PasteValidationViolation,
  RelativeComment,
  RelativeConditionalFormat,
  RelativeMerge,
  RelativeValidation,
} from './clipboard';

// Chart actor types
export type { ChartAccessor, ChartElementType, ChartState, ChartType } from './chart';

// Object actor types
export type { ObjectAccessor, Point as ObjectPoint, ObjectState } from './object';

// Find-Replace actor types
export type { FindReplaceAccessor, FindReplaceCommands, FindReplaceState } from './find-replace';

// Input actor types
export type { InputAccessor, InputCommands, InputState } from './input';

// Slicer actor types
export type {
  SlicerAccessor,
  SlicerActor,
  SlicerCommands,
  SlicerEvent,
  SlicerState,
} from './slicer';

// Page-Break actor types
export type { PageBreakAccessor, PageBreakCommands, PageBreakState } from './page-break';

// Comment actor types
export type { CommentAccessor, CommentState, CommentTarget } from './comment';

// Pane Focus actor types
export type { PaneFocusAccessor, PaneFocusCommands, PaneFocusState, PaneType } from './pane-focus';

// Draw Border actor types
export type {
  DrawBorderAccessor,
  DrawBorderMode,
  DrawBorderState,
  DrawBorderStyle,
} from './draw-border';

// Diagram actor types
export type {
  DiagramAccessor,
  NodeId as DiagramNodeId,
  DiagramState,
  DiagramUIState,
} from './diagram';

// Renderer actor types
export type {
  PendingAction,
  RendererAccessor,
  RendererCommands,
  RendererState,
  RendererStatus,
} from './renderer';

// Focus actor types
export type { FocusAccessor, FocusState } from './focus';

// Object interaction operation types (unified operation model)
export type {
  CancelOperationEvent,
  ClearOperationEvent,
  CompleteOperationEvent,
  FloatingObjectOperation,
  OperationEvent,
  OperationObjectState,
  OperationResizeHandle,
  StartDragEvent,
  StartResizeEvent,
  StartRotateEvent,
  UpdatePositionEvent,
} from './object-interaction';

// =============================================================================
// COMMAND INTERFACES (for state machine writes)
// =============================================================================

export type {
  ActorCommands,
  ChartCommands,
  ClipboardCommands,
  CommentCommands,
  DrawBorderCommands,
  DrawBorderStyleConfig,
  EditorCommands,
  ObjectCommands,
  PasteOption,
  ResizeHandle,
  SelectionCommands,
  DiagramCommands,
  // Note: DiagramNodeId is already exported from './diagram' above
} from './commands';

// Point is re-exported from viewport via commands.ts
export type { Point } from './commands';

// =============================================================================
// AGGREGATED ACCESSOR INTERFACE
// =============================================================================

import type { ChartAccessor } from './chart';
import type { ClipboardAccessor } from './clipboard';
import type { CommentAccessor } from './comment';
import type { DrawBorderAccessor } from './draw-border';
import type { EditorAccessor } from './editor';
import type { FindReplaceAccessor } from './find-replace';
import type { FocusAccessor } from './focus';
import type { ObjectAccessor } from './object';
import type { PaneFocusAccessor } from './pane-focus';
import type { RendererAccessor } from './renderer';
import type { SelectionAccessor } from './selection';
import type { DiagramAccessor } from './diagram';

/**
 * Aggregated interface containing all actor accessors.
 * This is the main interface used by handlers to read actor state.
 *
 * @example
 * ```ts
 * const MOVE_UP: ActionHandler = (deps) => {
 *   const activeCell = deps.accessors.selection.getActiveCell();
 *   if (deps.accessors.editor.isEditing()) {
 *     deps.commands.editor.commit('up');
 *   } else {
 *     deps.commands.selection.keyArrow('up', false);
 *   }
 * };
 * ```
 */
export interface ActorAccessors {
  /** Selection machine accessors (point-in-time reads) */
  selection: SelectionAccessor;
  /** Editor machine accessors (point-in-time reads) */
  editor: EditorAccessor;
  /** Clipboard machine accessors (point-in-time reads) */
  clipboard: ClipboardAccessor;
  /** Chart machine accessors (point-in-time reads) */
  chart: ChartAccessor;
  /** Object interaction machine accessors (point-in-time reads) */
  object: ObjectAccessor;
  /** Find-replace machine accessors (optional - not all contexts have it) */
  findReplace?: FindReplaceAccessor;
  /** Pane focus machine accessors (optional - not all contexts have it) */
  paneFocus?: PaneFocusAccessor;
  /** Comment machine accessors (optional - not all contexts have it) */
  comment?: CommentAccessor;
  /** Draw border machine accessors (optional - not all contexts have it) */
  drawBorder?: DrawBorderAccessor;
  /** Renderer machine accessors (optional - not all contexts have it) */
  renderer?: RendererAccessor;
  /** Focus machine accessors (optional - not all contexts have it) */
  focus?: FocusAccessor;
  /** Diagram machine accessors (optional - not all contexts have it) */
  diagram?: DiagramAccessor;
}
