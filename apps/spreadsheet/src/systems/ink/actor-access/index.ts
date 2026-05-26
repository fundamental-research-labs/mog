/**
 * Ink Actor Access Module
 *
 * Barrel export for ink accessors and commands.
 * Part of the Actor Access Layer pattern.
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Actor Access Layer
 */

// =============================================================================
// ACCESSORS
// =============================================================================

export { createInkAccessor, type InkAccessor } from './accessors';

// =============================================================================
// COMMANDS
// =============================================================================

export { createInkCommands, type InkCommands } from './commands';
