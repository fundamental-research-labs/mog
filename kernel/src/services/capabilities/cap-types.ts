/**
 * Capability Types - Core type definitions for capability-based permissioning
 *
 * This file defines:
 * - CapabilityType union type (all capabilities from tiers 0-5)
 * - CapabilityInfo interface (name, description, tier, risk level)
 * - CAPABILITY_REGISTRY: Record<CapabilityType, CapabilityInfo>
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

// =============================================================================
// Capability Registry
// =============================================================================

/** Default session duration: 30 minutes */
const SESSION_30_MINUTES = 30 * 60 * 1000;

/**
 * Registry of all capabilities with their metadata.
 * This is the single source of truth for capability definitions.
 */
export const CAPABILITY_REGISTRY: Readonly<Record<CapabilityType, CapabilityInfo>> = {
  // =========================================================================
  // Tier 0: Spreadsheet Core
  // =========================================================================
  'cells:read': {
    name: 'Read Cells',
    description: 'Read cell values from the spreadsheet',
    tier: 0,
    riskLevel: 'low',
  },
  'cells:write': {
    name: 'Write Cells',
    description: 'Write values to cells in the spreadsheet',
    tier: 0,
    riskLevel: 'medium',
  },
  'sheets:read': {
    name: 'Read Sheets',
    description: 'List sheets and read sheet metadata',
    tier: 0,
    riskLevel: 'low',
  },
  'sheets:create': {
    name: 'Create Sheets',
    description: 'Create new sheets in the workbook',
    tier: 0,
    riskLevel: 'medium',
  },
  'sheets:delete': {
    name: 'Delete Sheets',
    description: 'Delete sheets from the workbook',
    tier: 0,
    riskLevel: 'high',
  },
  'sheets:rename': {
    name: 'Rename Sheets',
    description: 'Rename sheets in the workbook',
    tier: 0,
    riskLevel: 'low',
  },
  'formulas:read': {
    name: 'Read Formulas',
    description: 'Read formula text from cells',
    tier: 0,
    riskLevel: 'low',
  },
  'formulas:write': {
    name: 'Write Formulas',
    description: 'Write formulas to cells',
    tier: 0,
    riskLevel: 'medium',
  },
  'formatting:read': {
    name: 'Read Formatting',
    description: 'Read cell formatting (fonts, colors, borders)',
    tier: 0,
    riskLevel: 'low',
  },
  'formatting:write': {
    name: 'Write Formatting',
    description: 'Apply formatting to cells',
    tier: 0,
    riskLevel: 'low',
  },
  'recalc:trigger': {
    name: 'Trigger Recalculation',
    description: 'Force spreadsheet recalculation',
    tier: 0,
    riskLevel: 'low',
  },

  // =========================================================================
  // Tier 1: Data
  // =========================================================================
  'tables:read': {
    name: 'Read Tables',
    description: 'Query tables and read records',
    tier: 1,
    riskLevel: 'low',
  },
  'tables:write': {
    name: 'Write Tables',
    description: 'Create and update records in tables',
    tier: 1,
    riskLevel: 'medium',
  },
  'tables:create': {
    name: 'Create Tables',
    description: 'Create new tables',
    tier: 1,
    riskLevel: 'medium',
  },
  'tables:delete': {
    name: 'Delete Tables',
    description: 'Delete tables and their records',
    tier: 1,
    riskLevel: 'high',
  },
  'columns:schema': {
    name: 'Modify Column Schema',
    description: 'Add, remove, or modify table columns',
    tier: 1,
    riskLevel: 'high',
  },

  // =========================================================================
  // Tier 2: Services
  // =========================================================================
  'events:subscribe': {
    name: 'Subscribe to Events',
    description: 'Receive notifications when data changes (filtered by read capabilities)',
    tier: 2,
    riskLevel: 'low',
  },
  'clipboard:read': {
    name: 'Read Clipboard',
    description: 'Read data from the system clipboard',
    tier: 2,
    riskLevel: 'medium',
  },
  'clipboard:write': {
    name: 'Write Clipboard',
    description: 'Write data to the system clipboard',
    tier: 2,
    riskLevel: 'low',
  },
  'undo:read': {
    name: 'Read Undo State',
    description: 'Check undo/redo availability',
    tier: 2,
    riskLevel: 'low',
  },
  'undo:write': {
    name: 'Perform Undo/Redo',
    description: 'Execute undo and redo operations',
    tier: 2,
    riskLevel: 'medium',
  },
  'notifications:send': {
    name: 'Send Notifications',
    description: 'Show toast notifications to the user',
    tier: 2,
    riskLevel: 'low',
  },
  'checkpoints:read': {
    name: 'Read Checkpoints',
    description: 'List checkpoints and their metadata',
    tier: 2,
    riskLevel: 'low',
  },
  'checkpoints:create': {
    name: 'Create Checkpoints',
    description: 'Create new version checkpoints',
    tier: 2,
    riskLevel: 'medium',
  },
  'checkpoints:restore': {
    name: 'Restore Checkpoints',
    description: 'Restore workbook to a previous checkpoint',
    tier: 2,
    riskLevel: 'high',
  },
  'version:read': {
    name: 'Read Version History',
    description: 'Read workbook version heads, refs, commits, and timeline summaries',
    tier: 2,
    riskLevel: 'medium',
  },
  'version:diff': {
    name: 'Read Version Diffs',
    description: 'Read semantic version diffs and review diff pages',
    tier: 2,
    riskLevel: 'medium',
  },
  'version:commit': {
    name: 'Create Version Commits',
    description: 'Create authored commits in workbook version history',
    tier: 2,
    riskLevel: 'high',
  },
  'version:branch': {
    name: 'Manage Version Branches',
    description: 'Create, list, and select workbook version branches',
    tier: 2,
    riskLevel: 'high',
  },
  'version:checkout': {
    name: 'Checkout Version State',
    description: 'Materialize a version branch or commit into the active workbook',
    tier: 2,
    riskLevel: 'high',
  },
  'version:reviewRead': {
    name: 'Read Version Reviews',
    description: 'Read review records and review decisions for workbook version changes',
    tier: 2,
    riskLevel: 'medium',
  },
  'version:reviewWrite': {
    name: 'Write Version Reviews',
    description: 'Create and update review records and review decisions',
    tier: 2,
    riskLevel: 'high',
  },
  'version:proposal': {
    name: 'Manage Version Proposals',
    description: 'Create, verify, accept, and reject agent version proposals',
    tier: 2,
    riskLevel: 'high',
  },
  'version:mergePreview': {
    name: 'Preview Version Merges',
    description: 'Preview semantic version merges and conflicts',
    tier: 2,
    riskLevel: 'high',
  },
  'version:mergeApply': {
    name: 'Apply Version Merges',
    description: 'Apply clean or resolved semantic version merges',
    tier: 2,
    riskLevel: 'high',
  },
  'version:revert': {
    name: 'Revert Version Changes',
    description: 'Create authored reversions of workbook version changes',
    tier: 2,
    riskLevel: 'high',
  },
  'version:provenance': {
    name: 'Read Version Provenance',
    description: 'Display redacted provenance and attribution for version history',
    tier: 2,
    riskLevel: 'medium',
  },
  'version:remotePromote': {
    name: 'Promote Remote Version Changes',
    description: 'Promote verified pending remote version changes into authored commits',
    tier: 2,
    riskLevel: 'high',
  },

  // =========================================================================
  // Tier 3: Platform
  // =========================================================================
  'filesystem:read': {
    name: 'Read Files',
    description: "Read files from the app's sandboxed storage",
    tier: 3,
    riskLevel: 'low',
  },
  'filesystem:write': {
    name: 'Write Files',
    description: "Write files to the app's sandboxed storage",
    tier: 3,
    riskLevel: 'medium',
  },
  'filesystem:delete': {
    name: 'Delete Files',
    description: "Delete files from the app's sandboxed storage",
    tier: 3,
    riskLevel: 'medium',
  },
  'dialogs:open': {
    name: 'Open File Dialog',
    description: 'Show file open dialog to the user',
    tier: 3,
    riskLevel: 'low',
  },
  'dialogs:save': {
    name: 'Save File Dialog',
    description: 'Show file save dialog to the user',
    tier: 3,
    riskLevel: 'low',
  },
  'shell:windowTitle': {
    name: 'Set Window Title',
    description: 'Change the application window title',
    tier: 3,
    riskLevel: 'low',
  },
  'shell:openExternal': {
    name: 'Open External URLs',
    description: 'Open URLs in the default browser',
    tier: 3,
    riskLevel: 'medium',
  },

  // =========================================================================
  // Tier 4: External
  // =========================================================================
  'connections:read': {
    name: 'Query External Data',
    description: 'Query external databases via portable Query interface',
    tier: 4,
    riskLevel: 'medium',
  },
  'connections:write': {
    name: 'Write External Data',
    description: 'Write to external databases via portable Query interface',
    tier: 4,
    riskLevel: 'high',
  },
  'connections:create': {
    name: 'Create Connections',
    description: 'Create new external database connections',
    tier: 4,
    riskLevel: 'high',
  },
  'connections:native': {
    name: 'Execute Native Queries',
    description: 'Execute raw SQL/GraphQL queries directly',
    tier: 4,
    riskLevel: 'critical',
    requiresAuth: true,
  },
  'network:sameorigin': {
    name: 'Same-Origin Network',
    description: 'Make HTTP requests to the same origin (web only)',
    tier: 4,
    riskLevel: 'low',
  },
  'network:allowlist': {
    name: 'Allowlist Network',
    description: 'Make HTTP requests to user-approved domains',
    tier: 4,
    riskLevel: 'medium',
  },
  'network:localhost': {
    name: 'Localhost Network',
    description: 'Make HTTP requests to localhost/127.0.0.1 (desktop security boundary)',
    tier: 4,
    riskLevel: 'high',
  },
  'network:any': {
    name: 'Any Network',
    description: 'Make HTTP requests to any remote URL (excludes localhost)',
    tier: 4,
    riskLevel: 'high',
  },

  // =========================================================================
  // Tier 5: Sensitive (require re-auth)
  // =========================================================================
  'credentials:use': {
    name: 'Use Stored Credentials',
    description: 'Invoke operations using stored credentials (password stays secure)',
    tier: 5,
    riskLevel: 'critical',
    requiresAuth: true,
    sessionOnly: true,
    sessionDuration: SESSION_30_MINUTES,
  },
  'tables:readAll': {
    name: 'Read All Tables',
    description: 'Read any table without explicit scope (required for unbounded table:* access)',
    tier: 5,
    riskLevel: 'critical',
  },
  'tables:writeAll': {
    name: 'Write All Tables',
    description: 'Write to any table without explicit scope',
    tier: 5,
    riskLevel: 'critical',
    requiresAuth: true,
  },
  'cells:readAll': {
    name: 'Read All Cells',
    description: 'Read any cell without explicit scope',
    tier: 5,
    riskLevel: 'critical',
  },
  'cells:writeAll': {
    name: 'Write All Cells',
    description: 'Write to any cell without explicit scope',
    tier: 5,
    riskLevel: 'critical',
    requiresAuth: true,
  },
} as const;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the info for a capability.
 */
export function getCapabilityInfo(capability: CapabilityType): CapabilityInfo {
  return CAPABILITY_REGISTRY[capability];
}

/**
 * Get all capabilities at a specific tier.
 */
export function getCapabilitiesByTier(tier: CapabilityTier): CapabilityType[] {
  return (Object.entries(CAPABILITY_REGISTRY) as [CapabilityType, CapabilityInfo][])
    .filter(([, info]) => info.tier === tier)
    .map(([capability]) => capability);
}

/**
 * Get all capabilities with a specific risk level.
 */
export function getCapabilitiesByRiskLevel(riskLevel: CapabilityRiskLevel): CapabilityType[] {
  return (Object.entries(CAPABILITY_REGISTRY) as [CapabilityType, CapabilityInfo][])
    .filter(([, info]) => info.riskLevel === riskLevel)
    .map(([capability]) => capability);
}

/**
 * Check if a capability requires re-authentication.
 */
export function requiresAuthentication(capability: CapabilityType): boolean {
  return CAPABILITY_REGISTRY[capability].requiresAuth === true;
}

/**
 * Check if a capability should be session-only (not persisted).
 */
export function isSessionOnly(capability: CapabilityType): boolean {
  return CAPABILITY_REGISTRY[capability].sessionOnly === true;
}

/**
 * Get the session duration for a session-only capability.
 * Returns undefined for non-session-only capabilities.
 */
export function getSessionDuration(capability: CapabilityType): number | undefined {
  const info = CAPABILITY_REGISTRY[capability];
  return info.sessionOnly ? (info.sessionDuration ?? SESSION_30_MINUTES) : undefined;
}

/**
 * Type guard to check if a string is a valid CapabilityType.
 */
export function isCapabilityType(value: string): value is CapabilityType {
  return value in CAPABILITY_REGISTRY;
}

/**
 * Get all capability types as an array.
 */
export function getAllCapabilities(): CapabilityType[] {
  return Object.keys(CAPABILITY_REGISTRY) as CapabilityType[];
}
