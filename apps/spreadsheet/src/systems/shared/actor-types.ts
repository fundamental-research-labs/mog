/**
 * Shared Actor Type Aliases
 *
 * Co-locates all actor type re-exports and the ActorRefs container interface.
 * Systems import actor types from here (or directly from machine files)
 * instead of from coordinator/types, fixing the DAG violation.
 *
 */

import type { focusMachine } from '@mog/shell';
import type { ActorRefFrom } from 'xstate';

// Re-export actor types from their machine files
export type { ClipboardActor, ClipboardState } from '../grid-editing/machines/clipboard-machine';
export type { CommentActor, CommentState } from '../grid-editing/machines/comment-machine';
export type {
  DrawBorderActor,
  DrawBorderState,
} from '../grid-editing/machines/draw-border-machine';
export type {
  FindReplaceActor,
  FindReplaceState,
} from '../grid-editing/machines/find-replace-machine';
export type { EditorActor, EditorState } from '../grid-editing/machines/grid-editor-machine';
export type {
  SelectionActor,
  SelectionState,
} from '../grid-editing/machines/grid-selection-machine';
export type { SlicerActor } from '../grid-editing/machines/slicer-machine';
export type { PaneFocusActor } from '../input/machines/pane-focus-machine';
export type { ChartActor, ChartState } from '../objects/machines/chart-machine';
export type {
  ObjectInteractionActor,
  ObjectInteractionState_,
} from '../objects/machines/object-interaction-machine';
export type { DiagramActor } from '../objects/machines/diagram-machine';
export type { RendererActor, RendererState } from '../renderer/machines/grid-renderer-machine';
export type { PageBreakActor } from '../renderer/machines/page-break-machine';

// FocusActor is derived from @mog/shell's focusMachine
export type FocusActor = ActorRefFrom<typeof focusMachine>;

// Import actor types for the ActorRefs interface
import type { ClipboardActor } from '../grid-editing/machines/clipboard-machine';
import type { CommentActor } from '../grid-editing/machines/comment-machine';
import type { DrawBorderActor } from '../grid-editing/machines/draw-border-machine';
import type { FindReplaceActor } from '../grid-editing/machines/find-replace-machine';
import type { EditorActor } from '../grid-editing/machines/grid-editor-machine';
import type { SelectionActor } from '../grid-editing/machines/grid-selection-machine';
import type { PaneFocusActor } from '../input/machines/pane-focus-machine';
import type { ChartActor } from '../objects/machines/chart-machine';
import type { ObjectInteractionActor } from '../objects/machines/object-interaction-machine';
import type { DiagramActor } from '../objects/machines/diagram-machine';
import type { RendererActor } from '../renderer/machines/grid-renderer-machine';
import type { PageBreakActor } from '../renderer/machines/page-break-machine';

/**
 * Container for all actor references.
 * Used by modules that need access to multiple actors.
 */
export interface ActorRefs {
  selectionActor: SelectionActor;
  editorActor: EditorActor;
  clipboardActor: ClipboardActor;
  rendererActor: RendererActor;
  objectInteractionActor: ObjectInteractionActor;
  focusActor: FocusActor;
  chartActor: ChartActor;
  findReplaceActor: FindReplaceActor;
  commentActor: CommentActor;
  paneFocusActor: PaneFocusActor;
  drawBorderActor: DrawBorderActor;
  pageBreakActor: PageBreakActor;
  diagramActor: DiagramActor;
}
