/**
 * Page Break Actor Access
 *
 * Selectors (the primitive) + Accessor interface (the contract for handlers).
 * Co-located to prevent drift.
 *
 * States:
 * - idle: No drag in progress, waiting for user interaction
 * - dragging: User is actively dragging a page break line
 *
 * @see state-machines/src/page-break-machine.ts
 */

import type { PageBreakInfo } from '@mog/types-viewport/rendering/bounds';

// =============================================================================
// STATE TYPE (matches XState snapshot shape)
// =============================================================================

/**
 * Minimal state type for selectors - matches XState snapshot shape.
 */
export interface PageBreakState {
  context: {
    /** Information about the page break being dragged (null when idle) */
    pageBreak: PageBreakInfo | null;
    /** Starting mouse position in pixels */
    startPosition: { x: number; y: number };
    /** Current mouse position in pixels during drag */
    currentPosition: { x: number; y: number };
    /** Current target position (row/col index the break would move to) */
    targetPosition: number | null;
  };
  // Use `any` for state parameter to be compatible with XState's specific union type
  matches(state: any): boolean;
  value: string;
}

// =============================================================================
// SELECTORS - Moved to @mog-sdk/kernel/selectors
// Import from '@mog-sdk/kernel/selectors' instead.
// =============================================================================

// =============================================================================
// ACCESSOR INTERFACE (mirrors selectors 1:1 for handlers)
// =============================================================================

export interface PageBreakAccessor {
  // Value accessors
  getPageBreak(): PageBreakInfo | null;
  getStartPosition(): { x: number; y: number };
  getCurrentPosition(): { x: number; y: number };
  getTargetPosition(): number | null;

  // State matching accessors
  isIdle(): boolean;
  isDragging(): boolean;

  // Derived accessors
  hasMoved(): boolean;
  hasPageBreak(): boolean;
  getMachineState(): string;
}

// =============================================================================
// COMMANDS INTERFACE
// =============================================================================

export interface PageBreakCommands {
  /** Start dragging a page break */
  startDrag(pageBreak: PageBreakInfo, startX: number, startY: number): void;

  /** Update drag position */
  drag(x: number, y: number, targetPosition: number): void;

  /** End the drag operation */
  endDrag(): void;

  /** Cancel the drag operation */
  cancel(): void;
}
