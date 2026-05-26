/**
 * Capability Taxonomy Types
 *
 * Type definitions for the capability taxonomy system.
 *
 */

// =============================================================================
// Composite Capabilities Type
// =============================================================================

/**
 * Composite capability identifier type.
 * These are shortcuts that expand to multiple capabilities.
 */
export type CompositeCapability =
  | 'spreadsheet:full'
  | 'spreadsheet:readonly'
  | 'tables:full'
  | 'tables:readwrite'
  | 'tables:readonly'
  | 'filesystem:full'
  | 'filesystem:readwrite'
  | 'services:basic';
