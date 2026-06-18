/**
 * Actor Access Layer
 *
 * Provides type-safe access to XState actors for handlers and hooks.
 * - Accessors: Point-in-time reads (for handlers)
 * - Commands: Event sending (for handlers and hooks)
 *
 * Selectors are exported from contracts for use with useSelector in hooks.
 *
 * of Actor Access Layer refactor.
 *
 * @module engine/state/coordinator/actor-access
 */

import type {
  ActorAccessors,
  ActorCommands,
  ChartState,
  ClipboardState,
  CommentState,
  DrawBorderState,
  EditorState,
  ObjectState,
  PaneFocusState,
  SelectionState,
  DiagramState,
} from '@mog-sdk/contracts/actors';
import type { FindReplaceState } from '@mog-sdk/contracts/search';

// =============================================================================
// RE-EXPORT INDIVIDUAL FACTORIES (for flexibility)
// =============================================================================

// Accessor factories — re-exported from system actor-access directories
export { createClipboardAccessor } from '../../systems/grid-editing/actor-access/clipboard-accessor';
export { createCommentAccessor } from '../../systems/grid-editing/actor-access/comment-accessor';
export { createDrawBorderAccessor } from '../../systems/grid-editing/actor-access/draw-border-accessor';
export { createEditorAccessor } from '../../systems/grid-editing/actor-access/editor-accessor';
export { createFindReplaceAccessor } from '../../systems/grid-editing/actor-access/find-replace-accessor';
export {
  createSelectionAccessor,
  DataBoundsCache,
} from '../../systems/grid-editing/actor-access/selection-accessor';
export { createPaneFocusAccessor } from '../../systems/input/actor-access/pane-focus-accessor';
export { createChartAccessor } from '../../systems/objects/actor-access/chart-accessor';
export { createObjectAccessor } from '../../systems/objects/actor-access/object-accessor';
export { createDiagramAccessor } from '../../systems/objects/actor-access/diagram-accessor';

// Command factories — re-exported from system actor-access directories
export { createClipboardCommands } from '../../systems/grid-editing/actor-access/clipboard-commands';
export { createCommentCommands } from '../../systems/grid-editing/actor-access/comment-commands';
export { createDrawBorderCommands } from '../../systems/grid-editing/actor-access/draw-border-commands';
export { createEditorCommands } from '../../systems/grid-editing/actor-access/editor-commands';
export { createFindReplaceCommands } from '../../systems/grid-editing/actor-access/find-replace-commands';
export { createSelectionCommands } from '../../systems/grid-editing/actor-access/selection-commands';
export { createPaneFocusCommands } from '../../systems/input/actor-access/pane-focus-accessor';
export { createChartCommands } from '../../systems/objects/actor-access/chart-commands';
export { createObjectCommands } from '../../systems/objects/actor-access/object-commands';
export { createDiagramCommands } from '../../systems/objects/actor-access/diagram-commands';
export { createRendererCommands } from '../../systems/renderer/actor-access/renderer-commands';

// =============================================================================
// ACTOR BUNDLE TYPE
// =============================================================================

/**
 * Minimal actor interface required for creating accessors.
 * Uses getSnapshot() to capture point-in-time state.
 */
interface ActorWithSnapshot {
  getSnapshot(): unknown;
}

/**
 * Minimal actor interface required for creating commands.
 * Uses send() to dispatch events to state machines.
 */
interface ActorWithSend {
  send(event: unknown): void;
}

/**
 * Actor bundle type - what coordinator holds.
 * Minimal interface for actors (getSnapshot + send).
 *
 * This decouples the Actor Access Layer from XState-specific types,
 * making it easier to test and allowing potential future migrations.
 */
export interface ActorBundle {
  selectionActor: ActorWithSnapshot & ActorWithSend;
  editorActor: ActorWithSnapshot & ActorWithSend;
  clipboardActor: ActorWithSnapshot & ActorWithSend;
  chartActor: ActorWithSnapshot & ActorWithSend;
  objectActor: ActorWithSnapshot & ActorWithSend;
  /** Find-replace actor is optional - not all contexts have it */
  findReplaceActor?: ActorWithSnapshot & ActorWithSend;
  /** Pane focus actor is optional - not all contexts have it */
  paneFocusActor?: ActorWithSnapshot & ActorWithSend;
  /** Comment actor is optional - not all contexts have it */
  commentActor?: ActorWithSnapshot & ActorWithSend;
  /** Draw border actor is optional - not all contexts have it */
  drawBorderActor?: ActorWithSnapshot & ActorWithSend;
  /** Diagram actor is optional - not all contexts have it */
  diagramActor?: ActorWithSnapshot & ActorWithSend;
  /** Renderer actor is optional - not all contexts have it */
  rendererActor?: ActorWithSnapshot & ActorWithSend;
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

// Import factories for use in createActorAccessLayer
import { createClipboardAccessor } from '../../systems/grid-editing/actor-access/clipboard-accessor';
import { createClipboardCommands } from '../../systems/grid-editing/actor-access/clipboard-commands';
import { createCommentAccessor } from '../../systems/grid-editing/actor-access/comment-accessor';
import { createCommentCommands } from '../../systems/grid-editing/actor-access/comment-commands';
import { createDrawBorderAccessor } from '../../systems/grid-editing/actor-access/draw-border-accessor';
import { createDrawBorderCommands } from '../../systems/grid-editing/actor-access/draw-border-commands';
import { createEditorAccessor } from '../../systems/grid-editing/actor-access/editor-accessor';
import { createEditorCommands } from '../../systems/grid-editing/actor-access/editor-commands';
import {
  createFindReplaceAccessor,
  type FindReplaceActor,
} from '../../systems/grid-editing/actor-access/find-replace-accessor';
import { createFindReplaceCommands } from '../../systems/grid-editing/actor-access/find-replace-commands';
import { createSelectionAccessor } from '../../systems/grid-editing/actor-access/selection-accessor';
import { createSelectionCommands } from '../../systems/grid-editing/actor-access/selection-commands';
import {
  createPaneFocusAccessor,
  createPaneFocusCommands,
} from '../../systems/input/actor-access/pane-focus-accessor';
import { createChartAccessor } from '../../systems/objects/actor-access/chart-accessor';
import { createChartCommands } from '../../systems/objects/actor-access/chart-commands';
import { createObjectAccessor } from '../../systems/objects/actor-access/object-accessor';
import { createObjectCommands } from '../../systems/objects/actor-access/object-commands';
import { createDiagramAccessor } from '../../systems/objects/actor-access/diagram-accessor';
import { createRendererCommands } from '../../systems/renderer/actor-access/renderer-commands';

/**
 * Creates the complete Actor Access Layer from an actor bundle.
 *
 * @deprecated Use createActorAccessLayer(coordinator) instead.
 * This version is kept for existing callers that still pass an ActorBundle.
 *
 * @param actors - Bundle of XState actors from coordinator
 * @returns Object with accessors and commands for all actors
 */
export function createActorAccessLayerFromBundle(actors: ActorBundle): {
  accessors: ActorAccessors;
  commands: ActorCommands;
} {
  const objectCommands = createObjectCommands(actors.objectActor);

  return {
    accessors: {
      selection: createSelectionAccessor(
        actors.selectionActor as { getSnapshot(): SelectionState },
      ),
      editor: createEditorAccessor(actors.editorActor as { getSnapshot(): EditorState }),
      clipboard: createClipboardAccessor(
        actors.clipboardActor as { getSnapshot(): ClipboardState },
      ),
      chart: createChartAccessor(actors.chartActor as { getSnapshot(): ChartState }),
      object: createObjectAccessor(actors.objectActor as { getSnapshot(): ObjectState }),
      // Find-replace accessor is optional - only include if actor is provided
      findReplace: actors.findReplaceActor
        ? createFindReplaceAccessor(actors.findReplaceActor as FindReplaceActor)
        : undefined,
      // Pane focus accessor is optional - only include if actor is provided
      paneFocus: actors.paneFocusActor
        ? createPaneFocusAccessor(actors.paneFocusActor as { getSnapshot(): PaneFocusState })
        : undefined,
      // Comment accessor is optional - only include if actor is provided
      comment: actors.commentActor
        ? createCommentAccessor(actors.commentActor as { getSnapshot(): CommentState })
        : undefined,
      // Draw border accessor is optional - only include if actor is provided
      drawBorder: actors.drawBorderActor
        ? createDrawBorderAccessor(actors.drawBorderActor as { getSnapshot(): DrawBorderState })
        : undefined,
      // Diagram accessor is optional - only include if actor is provided
      diagram: actors.diagramActor
        ? createDiagramAccessor(actors.diagramActor as { getSnapshot(): DiagramState })
        : undefined,
    },
    commands: {
      selection: createSelectionCommands(actors.selectionActor),
      editor: createEditorCommands(actors.editorActor),
      clipboard: createClipboardCommands(actors.clipboardActor),
      chart: createChartCommands(actors.chartActor, objectCommands),
      object: objectCommands,
      // Find-replace commands are optional - only include if actor is provided
      findReplace: actors.findReplaceActor
        ? createFindReplaceCommands(
            actors.findReplaceActor as {
              getSnapshot(): FindReplaceState;
              send(event: unknown): void;
            },
          )
        : undefined,
      // Pane focus commands are optional - only include if actor is provided
      paneFocus: actors.paneFocusActor ? createPaneFocusCommands(actors.paneFocusActor) : undefined,
      // Comment commands are optional - only include if actor is provided
      comment: actors.commentActor ? createCommentCommands(actors.commentActor) : undefined,
      // Draw border commands are optional - only include if actor is provided
      drawBorder: actors.drawBorderActor
        ? createDrawBorderCommands(actors.drawBorderActor)
        : undefined,
      // Renderer commands are optional - only include if actor is provided
      renderer: actors.rendererActor ? createRendererCommands(actors.rendererActor) : undefined,
    },
  };
}

// =============================================================================
// BACKWARDS-COMPATIBLE ALIAS
// =============================================================================

/**
 * Backwards-compatible alias for createActorAccessLayerFromBundle.
 * Existing callers that pass an ActorBundle continue to work.
 *
 * Overload 1: Takes an ActorBundle (legacy).
 * Overload 2: Takes a SheetCoordinator (new, system-based).
 */
export function createActorAccessLayer(actors: ActorBundle): {
  accessors: ActorAccessors;
  commands: ActorCommands;
};
export function createActorAccessLayer(coordinator: {
  grid: {
    access: {
      accessors: Record<string, unknown>;
      commands: Record<string, unknown>;
      selectors: Record<string, unknown>;
    };
  };
  objects: {
    access: {
      accessors: Record<string, unknown>;
      commands: Record<string, unknown>;
      selectors: Record<string, unknown>;
    };
  };
  renderer: {
    access: {
      accessors: Record<string, unknown>;
      commands: Record<string, unknown>;
      selectors: Record<string, unknown>;
    };
  };
  input: {
    access: {
      accessors: Record<string, unknown>;
      commands: Record<string, unknown>;
      selectors: Record<string, unknown>;
    };
  };
  ink: {
    access: {
      accessors: Record<string, unknown>;
      commands: Record<string, unknown>;
      selectors: Record<string, unknown>;
    };
  };
}): {
  accessors: Record<string, unknown>;
  commands: Record<string, unknown>;
  selectors: Record<string, unknown>;
};
export function createActorAccessLayer(input: unknown): unknown {
  // Detect ActorBundle by looking for selectionActor property
  if (input && typeof input === 'object' && 'selectionActor' in input) {
    return createActorAccessLayerFromBundle(input as ActorBundle);
  }

  // New coordinator-based path: merge access from all systems
  const coordinator = input as {
    grid: {
      access: {
        accessors: Record<string, unknown>;
        commands: Record<string, unknown>;
        selectors: Record<string, unknown>;
      };
    };
    objects: {
      access: {
        accessors: Record<string, unknown>;
        commands: Record<string, unknown>;
        selectors: Record<string, unknown>;
      };
    };
    renderer: {
      access: {
        accessors: Record<string, unknown>;
        commands: Record<string, unknown>;
        selectors: Record<string, unknown>;
      };
    };
    input: {
      access: {
        accessors: Record<string, unknown>;
        commands: Record<string, unknown>;
        selectors: Record<string, unknown>;
      };
    };
    ink: {
      access: {
        accessors: Record<string, unknown>;
        commands: Record<string, unknown>;
        selectors: Record<string, unknown>;
      };
    };
  };

  return {
    accessors: {
      ...coordinator.grid.access.accessors,
      ...coordinator.objects.access.accessors,
      ...coordinator.renderer.access.accessors,
      ...coordinator.input.access.accessors,
      ...coordinator.ink.access.accessors,
    },
    commands: {
      ...coordinator.grid.access.commands,
      ...coordinator.objects.access.commands,
      ...coordinator.renderer.access.commands,
      ...coordinator.input.access.commands,
      ...coordinator.ink.access.commands,
    },
    selectors: {
      ...coordinator.grid.access.selectors,
      ...coordinator.objects.access.selectors,
      ...coordinator.renderer.access.selectors,
      ...coordinator.input.access.selectors,
      ...coordinator.ink.access.selectors,
    },
  };
}
