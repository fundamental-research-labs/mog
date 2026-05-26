/**
 * Objects Actor Access Module
 *
 * Barrel export for all object-related accessors and commands.
 * Part of the Actor Access Layer pattern.
 *
 * Decomposed from coordinator/actor-access/
 *
 * @module systems/objects/actor-access
 */

// =============================================================================
// ACCESSORS
// =============================================================================

export { createChartAccessor } from './chart-accessor';
export { createObjectAccessor } from './object-accessor';
export { createDiagramAccessor } from './diagram-accessor';

// =============================================================================
// COMMANDS
// =============================================================================

export { createChartCommands } from './chart-commands';
export { createObjectCommands } from './object-commands';
export { createDiagramCommands } from './diagram-commands';
