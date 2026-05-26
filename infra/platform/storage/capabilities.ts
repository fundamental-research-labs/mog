/**
 * Table Driver Capabilities Runtime Functions
 *
 * Capability helpers and preset consts for table drivers.
 * Types/interfaces remain in @mog-sdk/contracts/storage/capabilities.
 */

import type { TableDriverCapabilities } from '@mog-sdk/contracts/storage';

// =============================================================================
// Preset Capabilities
// =============================================================================

/**
 * Capabilities for local Yjs storage.
 * Full CRDT sync, offline-capable, all operations supported.
 */
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

/**
 * Capabilities for PostgreSQL connections.
 * Full CRUD, transactions, native SQL queries.
 */
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

/**
 * Capabilities for MySQL connections.
 * Similar to Postgres but with MySQL-specific behaviors.
 */
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

/**
 * Capabilities for SQLite connections.
 * Local file-based database, desktop only.
 */
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

/**
 * Capabilities for REST API connections.
 * Depends on endpoint implementation; defaults to typical CRUD API.
 */
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

/**
 * Capabilities for GraphQL API connections.
 * Similar to REST but may support subscriptions.
 */
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

/**
 * Capabilities for read-only data sources.
 * No modifications allowed.
 */
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

/**
 * Check if a driver supports write operations.
 */
export function canWrite(capabilities: TableDriverCapabilities): boolean {
  return capabilities.canCreate || capabilities.canUpdate || capabilities.canDelete;
}

/**
 * Check if a driver is read-only.
 */
export function isReadOnly(capabilities: TableDriverCapabilities): boolean {
  return !canWrite(capabilities);
}

/**
 * Create custom capabilities by extending a preset.
 */
export function extendCapabilities(
  base: TableDriverCapabilities,
  overrides: Partial<TableDriverCapabilities>,
): TableDriverCapabilities {
  return { ...base, ...overrides };
}
