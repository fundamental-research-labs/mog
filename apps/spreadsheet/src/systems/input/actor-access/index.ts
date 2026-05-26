/**
 * Input Actor Access Module
 *
 * Barrel export for all input-related accessors and commands.
 * Part of the Actor Access Layer pattern.
 *
 * Decomposed from coordinator/actor-access/
 *
 * @module systems/input/actor-access
 */

// =============================================================================
// ACCESSORS
// =============================================================================

export { createPaneFocusAccessor } from './pane-focus-accessor';

// =============================================================================
// COMMANDS
// =============================================================================

export { createPaneFocusCommands } from './pane-focus-accessor';
