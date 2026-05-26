/**
 * Table Driver Capabilities
 *
 * Capability flags that describe what a table driver can and cannot do.
 * Extracted from @mog-sdk/contracts/storage.
 */

// =============================================================================
// Capabilities Interface
// =============================================================================

export interface TableDriverCapabilities {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canStream: boolean;
  isLocal: boolean;
  supportsTransactions: boolean;
  supportsNativeQuery: boolean;
  supportsBatch: boolean;
  supportsWatch: boolean;
}

// =============================================================================
// Preset Capabilities
// =============================================================================

export const LOCAL_CAPABILITIES: TableDriverCapabilities = {
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canStream: true,
  isLocal: true,
  supportsTransactions: true,
  supportsNativeQuery: false,
  supportsBatch: true,
  supportsWatch: true,
};

export const POSTGRES_CAPABILITIES: TableDriverCapabilities = {
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canStream: false,
  isLocal: false,
  supportsTransactions: true,
  supportsNativeQuery: true,
  supportsBatch: true,
  supportsWatch: false,
};

export const MYSQL_CAPABILITIES: TableDriverCapabilities = {
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canStream: false,
  isLocal: false,
  supportsTransactions: true,
  supportsNativeQuery: true,
  supportsBatch: true,
  supportsWatch: false,
};

export const SQLITE_CAPABILITIES: TableDriverCapabilities = {
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canStream: false,
  isLocal: true,
  supportsTransactions: true,
  supportsNativeQuery: true,
  supportsBatch: true,
  supportsWatch: false,
};

export const REST_API_CAPABILITIES: TableDriverCapabilities = {
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canStream: false,
  isLocal: false,
  supportsTransactions: false,
  supportsNativeQuery: false,
  supportsBatch: false,
  supportsWatch: false,
};

export const GRAPHQL_CAPABILITIES: TableDriverCapabilities = {
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canStream: false,
  isLocal: false,
  supportsTransactions: false,
  supportsNativeQuery: true,
  supportsBatch: false,
  supportsWatch: false,
};

export const READONLY_CAPABILITIES: TableDriverCapabilities = {
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canStream: false,
  isLocal: false,
  supportsTransactions: false,
  supportsNativeQuery: false,
  supportsBatch: false,
  supportsWatch: false,
};

// =============================================================================
// Capability Helpers
// =============================================================================

export function canWrite(capabilities: TableDriverCapabilities): boolean {
  return capabilities.canCreate || capabilities.canUpdate || capabilities.canDelete;
}

export function isReadOnly(capabilities: TableDriverCapabilities): boolean {
  return !canWrite(capabilities);
}

export function extendCapabilities(
  base: TableDriverCapabilities,
  overrides: Partial<TableDriverCapabilities>,
): TableDriverCapabilities {
  return { ...base, ...overrides };
}
