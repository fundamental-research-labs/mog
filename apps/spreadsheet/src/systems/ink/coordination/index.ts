/**
 * Ink Feature Module
 *
 * Provides ink input handling and coordination for the drawing engine.
 * This module bridges pointer events to the ink state machine and
 * persistence layer.
 *
 * Components:
 * - InkInputHandler: Pointer event processing with coalescing
 * - TouchDiscriminator: Palm rejection for stylus input
 * - InkCoordination: Wiring input to machine and persistence
 *
 * @example
 * import {
 * createInkCoordination,
 * createInkInputHandler,
 * createTouchDiscriminator
 * } from './features/ink';
 *
 */

// =============================================================================
// INPUT HANDLER
// =============================================================================

export {
  createInkInputHandler,
  extractCoalescedPoints,
  extractPointFromEvent,
  type InkInputCallbacks,
  type InkInputHandler,
  type InkInputHandlerConfig,
} from './ink-input-handler';

// =============================================================================
// TOUCH DISCRIMINATOR
// =============================================================================

export {
  createTouchDiscriminator,
  toPointerInputType,
  type PointerInputType,
  type TouchDiscriminator,
  type TouchDiscriminatorConfig,
} from './ink-touch-discriminator';

// =============================================================================
// COORDINATION
// =============================================================================

export {
  createInkCoordination,
  type InkCoordination,
  type InkCoordinationConfig,
} from './ink-coordination';
