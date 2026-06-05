/**
 * Page Break Actor Selectors
 *
 * Pure functions that extract data from page break state.
 * Moved from contracts to kernel (contracts holds types only).
 *
 * @module @mog-sdk/kernel/selectors
 */

import type { PageBreakState } from '@mog-sdk/contracts/actors/page-break';

export { type PageBreakState } from '@mog-sdk/contracts/actors/page-break';

type PageBreakContext = PageBreakState['context'];

export interface PageBreakSelectors {
  pageBreak: (state: PageBreakState) => PageBreakContext['pageBreak'];
  startPosition: (state: PageBreakState) => PageBreakContext['startPosition'];
  currentPosition: (state: PageBreakState) => PageBreakContext['currentPosition'];
  targetPosition: (state: PageBreakState) => PageBreakContext['targetPosition'];
  isIdle: (state: PageBreakState) => boolean;
  isDragging: (state: PageBreakState) => boolean;
  hasMoved: (state: PageBreakState) => boolean;
  hasPageBreak: (state: PageBreakState) => boolean;
  machineState: (state: PageBreakState) => string;
}

export const pageBreakSelectors: PageBreakSelectors = {
  // ---------------------------------------------------------------------------
  // Value selectors
  // ---------------------------------------------------------------------------
  pageBreak: (state: PageBreakState) => state.context.pageBreak,
  startPosition: (state: PageBreakState) => state.context.startPosition,
  currentPosition: (state: PageBreakState) => state.context.currentPosition,
  targetPosition: (state: PageBreakState) => state.context.targetPosition,

  // ---------------------------------------------------------------------------
  // State matching selectors
  // ---------------------------------------------------------------------------
  isIdle: (state: PageBreakState): boolean => state.matches('idle'),
  isDragging: (state: PageBreakState): boolean => state.matches('dragging'),

  // ---------------------------------------------------------------------------
  // Derived selectors
  // ---------------------------------------------------------------------------
  hasMoved: (state: PageBreakState): boolean =>
    state.context.pageBreak !== null &&
    state.context.targetPosition !== null &&
    state.context.targetPosition !== state.context.pageBreak.originalPosition,

  /** Check if there is a page break being dragged */
  hasPageBreak: (state: PageBreakState): boolean => state.context.pageBreak !== null,

  /** Get the current machine state value */
  machineState: (state: PageBreakState): string => state.value,
};
