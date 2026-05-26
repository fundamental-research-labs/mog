/**
 * Grid Renderer Primitives
 *
 * Pure primitive types (`LayerName`, `RenderPriority`) extracted from
 * `grid-renderer.ts` so modules that only need the primitive (e.g.
 * `machines/types.ts`) don't pull in the full renderer contract
 * (including `render-context.ts`, which itself transitively re-imports
 * `machines/`).
 *
 * `grid-renderer.ts` re-exports these so existing consumers' import
 * paths don't change.
 */

/**
 * Logical render layer names.
 * Layers are rendered in z-order (lower index = behind).
 */
export type LayerName =
  | 'background'
  | 'cells'
  | 'validationCircles'
  | 'pageBreaks'
  | 'selection'
  | 'traceArrows'
  | 'remoteCursors'
  | 'ui'
  | 'drawing'
  | 'overlay'
  | 'sticky-headers'
  | 'headers'
  | 'dividers';

/**
 * Render priority levels.
 * Lower number = higher priority = executed first.
 *
 * Priority behaviors:
 * - CRITICAL: Always immediate, never deferred
 * - USER_BLOCKING: Execute within frame budget (16ms)
 * - NORMAL: Time-sliced, yields if frame budget exceeded
 * - LOW: Scheduled during idle time
 * - IDLE: Uses requestIdleCallback
 */
export enum RenderPriority {
  /** Selection, cursor blink - always immediate */
  CRITICAL = 0,

  /** Scroll feedback, edit preview - within 16ms frame */
  USER_BLOCKING = 1,

  /** Visible cell content - time-sliced */
  NORMAL = 2,

  /** Prefetch adjacent cells - during idle */
  LOW = 3,

  /** Background formatting - requestIdleCallback */
  IDLE = 4,
}
