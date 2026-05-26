/**
 * Ink Machines Module
 *
 * Barrel export for ink state machine, types, and selectors.
 *
 */

// =============================================================================
// MACHINE
// =============================================================================

export { inkMachine, type InkActor, type InkMachine, type InkState } from './machine';

// =============================================================================
// SELECTORS
// =============================================================================

export { inkSelectors } from './selectors';

// =============================================================================
// TYPES AND UTILITIES
// =============================================================================

export type { InkContext, InkEvent, InkSelectionMode } from './types';

export {
  addPointToBuffer,
  createInitialInkContext,
  getCurrentStrokeCopy,
  resetStrokeBuffer,
} from './types';
