/**
 * ActorManager
 *
 * Manages the lifecycle of all XState actors in the coordinator.
 * Extracts actor creation/start/stop logic from SheetCoordinator for:
 * - Single responsibility (actor lifecycle only)
 * - Testability (can test actor lifecycle in isolation)
 * - Reusability (same actors, different coordinator configurations)
 *
 */

import { createActor, type InspectionEvent } from 'xstate';

import type { IClipboardService } from '@mog-sdk/contracts/services';
import { focusMachine } from '@mog/shell';
import { clipboardMachine } from '../grid-editing/machines/clipboard-machine';
import { commentMachine } from '../grid-editing/machines/comment-machine';
import {
  drawBorderMachine,
  type DrawBorderActor,
} from '../grid-editing/machines/draw-border-machine';
import { findReplaceMachine } from '../grid-editing/machines/find-replace-machine';
import { editorMachine } from '../grid-editing/machines/grid-editor-machine';
import { selectionMachine } from '../grid-editing/machines/grid-selection-machine';
import { paneFocusMachine, type PaneFocusActor } from '../input/machines/pane-focus-machine';
import { chartMachine } from '../objects/machines/chart-machine';
import { objectInteractionMachine } from '../objects/machines/object-interaction-machine';
import { diagramMachine, type DiagramActor } from '../objects/machines/diagram-machine';
import { rendererMachine } from '../renderer/machines/grid-renderer-machine';
import { pageBreakMachine, type PageBreakActor } from '../renderer/machines/page-break-machine';
import type {
  ChartActor,
  ClipboardActor,
  CommentActor,
  EditorActor,
  FindReplaceActor,
  FocusActor,
  ObjectInteractionActor,
  RendererActor,
  SelectionActor,
} from './actor-types';

/**
 * Configuration for ActorManager.
 */
export interface ActorManagerConfig {
  /**
   * Optional inspection callback for metrics/debugging.
   * Called for every actor state transition.
   */
  inspect?: (event: InspectionEvent) => void;

  /**
   * Optional kernel clipboard service for storage delegation.
   * When provided, shell clipboard operations are also delegated to the kernel service.
   * This enables cross-app clipboard support.
   */
  kernelClipboardService?: IClipboardService;
}

/**
 * Manages all XState actors for the sheet coordinator.
 *
 * Usage:
 * ```typescript
 * const actors = new ActorManager({ inspect: metricsCallback });
 * actors.start();
 *
 * // Access actors
 * const selection = actors.selection;
 * selection.send({ type: 'MOUSE_DOWN', cell: { row: 0, col: 0 } });
 *
 * // Clean up
 * actors.stop();
 * ```
 */
export class ActorManager {
  // All actors are readonly - created once, never replaced
  readonly selection: SelectionActor;
  readonly editor: EditorActor;
  readonly clipboard: ClipboardActor;
  readonly renderer: RendererActor;
  readonly focus: FocusActor;
  readonly objectInteraction: ObjectInteractionActor;
  readonly chart: ChartActor;
  readonly findReplace: FindReplaceActor;
  readonly comment: CommentActor;
  readonly paneFocus: PaneFocusActor;
  readonly drawBorder: DrawBorderActor;
  readonly pageBreak: PageBreakActor;
  readonly diagram: DiagramActor;

  private started = false;
  private stopped = false;

  constructor(config: ActorManagerConfig = {}) {
    const { kernelClipboardService } = config;

    // Use provided inspect callback, or fall back to devtools global hook
    const inspect =
      config.inspect ??
      ((evt: InspectionEvent) => {
        window.__OS_DEVTOOLS__?.reportActor?.(evt.actorRef?.sessionId ?? 'anonymous', evt);
      });

    // Create all actors with optional inspection
    // Note: Most machines are PURE - they don't require input context.
    // The coordinator provides context through event payloads.
    // The clipboard machine accepts optional input for kernel service delegation.
    this.selection = createActor(selectionMachine, { inspect });
    this.editor = createActor(editorMachine, { inspect });
    this.clipboard = createActor(clipboardMachine, {
      inspect,
      input: { kernelClipboardService },
    });
    this.renderer = createActor(rendererMachine, { inspect });
    this.focus = createActor(focusMachine, { inspect });
    this.objectInteraction = createActor(objectInteractionMachine, { inspect });
    this.chart = createActor(chartMachine, { inspect });
    this.findReplace = createActor(findReplaceMachine, { inspect });
    this.comment = createActor(commentMachine, { inspect });
    this.paneFocus = createActor(paneFocusMachine, { inspect });
    this.drawBorder = createActor(drawBorderMachine, { inspect });
    this.pageBreak = createActor(pageBreakMachine, { inspect });
    this.diagram = createActor(diagramMachine, { inspect });
  }

  /**
   * Start all actors.
   * Must be called before sending events to actors.
   * Idempotent - calling multiple times has no effect after first call.
   * Throws if called after stop.
   */
  start(): void {
    // Check stopped first to detect restart attempts after stop
    if (this.stopped) {
      throw new Error('ActorManager: Cannot restart after stop. Create a new instance.');
    }
    if (this.started) return;

    this.selection.start();
    this.editor.start();
    this.clipboard.start();
    this.renderer.start();
    this.focus.start();
    this.objectInteraction.start();
    this.chart.start();
    this.findReplace.start();
    this.comment.start();
    this.paneFocus.start();
    this.drawBorder.start();
    this.pageBreak.start();
    this.diagram.start();

    this.started = true;
  }

  /**
   * Stop all actors.
   * Stops in reverse order of start (LIFO) to ensure proper cleanup.
   * Idempotent - calling multiple times has no effect after first call.
   */
  stop(): void {
    if (!this.started || this.stopped) return;

    // Stop in reverse order (LIFO)
    this.diagram.stop();
    this.pageBreak.stop();
    this.drawBorder.stop();
    this.paneFocus.stop();
    this.comment.stop();
    this.findReplace.stop();
    this.chart.stop();
    this.objectInteraction.stop();
    this.focus.stop();
    this.renderer.stop();
    this.clipboard.stop();
    this.editor.stop();
    this.selection.stop();

    this.stopped = true;
  }

  /**
   * Check if actors have been started.
   */
  isStarted(): boolean {
    return this.started;
  }

  /**
   * Check if actors have been stopped.
   */
  isStopped(): boolean {
    return this.stopped;
  }

  /**
   * Get all actors as an object.
   * Useful for passing to setup functions that need multiple actors.
   */
  getActorRefs() {
    return {
      selectionActor: this.selection,
      editorActor: this.editor,
      clipboardActor: this.clipboard,
      rendererActor: this.renderer,
      focusActor: this.focus,
      objectInteractionActor: this.objectInteraction,
      chartActor: this.chart,
      findReplaceActor: this.findReplace,
      commentActor: this.comment,
      paneFocusActor: this.paneFocus,
      drawBorderActor: this.drawBorder,
      pageBreakActor: this.pageBreak,
      diagramActor: this.diagram,
    };
  }
}
