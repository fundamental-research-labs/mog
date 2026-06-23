/**
 * Capability Types - Core type definitions for capability-based permissioning
 *
 * This file defines ONLY type definitions:
 * - CapabilityType union type (all capabilities from tiers 0-5)
 * - CapabilityInfo interface (name, description, tier, risk level)
 *
 * Runtime code (CAPABILITY_REGISTRY, helper functions) has been moved to
 * @mog-sdk/kernel/services/capabilities (cap-types.ts).
 *
 */

// =============================================================================
// Risk Level
// =============================================================================

/**
 * Risk level for a capability.
 * Affects UI presentation (warning colors, confirmation dialogs).
 */
export type CapabilityRiskLevel = 'low' | 'medium' | 'high' | 'critical';

// =============================================================================
// Capability Tiers
// =============================================================================

/**
 * Capability tier determines the security boundary and UI treatment.
 *
 * - Tier 0-2: Core spreadsheet and data operations
 * - Tier 3: Platform/filesystem access
 * - Tier 4: External network/database access
 * - Tier 5: Sensitive operations requiring re-authentication
 */
export type CapabilityTier = 0 | 1 | 2 | 3 | 4 | 5;

// =============================================================================
// Capability Type Union
// =============================================================================

/**
 * Tier 0: Spreadsheet Core
 * Basic spreadsheet operations - cells, sheets, formulas, formatting.
 */
export type Tier0Capability =
  | 'cells:read'
  | 'cells:write'
  | 'sheets:read'
  | 'sheets:create'
  | 'sheets:delete'
  | 'sheets:rename'
  | 'formulas:read'
  | 'formulas:write'
  | 'formatting:read'
  | 'formatting:write'
  | 'recalc:trigger';

/**
 * Tier 1: Data
 * Table and record operations.
 */
export type Tier1Capability =
  | 'tables:read'
  | 'tables:write'
  | 'tables:create'
  | 'tables:delete'
  | 'columns:schema';

/**
 * Tier 2: Services
 * Platform services - events, clipboard, undo, notifications, checkpoints.
 */
export type Tier2Capability =
  | 'events:subscribe'
  | 'clipboard:read'
  | 'clipboard:write'
  | 'undo:read'
  | 'undo:write'
  | 'notifications:send'
  | 'checkpoints:read'
  | 'checkpoints:create'
  | 'checkpoints:restore'
  | 'version:read'
  | 'version:diff'
  | 'version:commit'
  | 'version:branch'
  | 'version:checkout'
  | 'version:reviewRead'
  | 'version:reviewWrite'
  | 'version:proposal'
  | 'version:mergePreview'
  | 'version:mergeApply'
  | 'version:revert'
  | 'version:provenance'
  | 'version:remotePromote';

/**
 * Tier 3: Platform
 * Filesystem and shell access.
 */
export type Tier3Capability =
  | 'filesystem:read'
  | 'filesystem:write'
  | 'filesystem:delete'
  | 'dialogs:open'
  | 'dialogs:save'
  | 'shell:windowTitle'
  | 'shell:openExternal';

/**
 * Tier 4: External
 * Network and external database access.
 */
export type Tier4Capability =
  | 'connections:read'
  | 'connections:write'
  | 'connections:create'
  | 'connections:native'
  | 'network:sameorigin'
  | 'network:allowlist'
  | 'network:localhost'
  | 'network:any';

/**
 * Tier 5: Sensitive
 * Operations requiring re-authentication.
 */
export type Tier5Capability =
  | 'credentials:use'
  | 'tables:readAll'
  | 'tables:writeAll'
  | 'cells:readAll'
  | 'cells:writeAll';

/**
 * Union of all capability types.
 * This is the primary type used throughout the system.
 */
export type CapabilityType =
  | Tier0Capability
  | Tier1Capability
  | Tier2Capability
  | Tier3Capability
  | Tier4Capability
  | Tier5Capability;

// =============================================================================
// Capability Info
// =============================================================================

/**
 * Metadata about a capability for UI and documentation.
 */
export interface CapabilityInfo {
  /** Display name for UI */
  readonly name: string;

  /** User-facing description of what this capability grants */
  readonly description: string;

  /** Security tier (0-5) */
  readonly tier: CapabilityTier;

  /** Risk level for UI treatment */
  readonly riskLevel: CapabilityRiskLevel;

  /**
   * Whether this capability requires re-authentication.
   * Only applies to Tier 5 capabilities.
   */
  readonly requiresAuth?: boolean;

  /**
   * Whether grants of this capability should be session-only (not persisted).
   * Used for highly sensitive operations like credentials:use.
   */
  readonly sessionOnly?: boolean;

  /**
   * Default session duration in milliseconds for session-only grants.
   * Default: 30 minutes (1800000ms)
   */
  readonly sessionDuration?: number;
}
