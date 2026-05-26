/**
 * Capability-Gated API
 *
 * This module provides capability-gated versions of the kernel API.
 * Apps receive ONLY interfaces for granted capabilities - no runtime
 * "permission denied" errors for missing capabilities.
 *
 */

// Main factory function
export {
  createCapabilityGatedApi,
  type CreateCapabilityGatedAPIOptions,
} from './capability-gated-api';

// Types
export type {
  BatchOperation,
  BatchValidationResult,
  CapabilityGatedAPIOptions,
  ScopedAPIContext,
} from './types';

// Introspection
export { createCapabilityIntrospection, createScopedAPIContext } from './introspection';

// Shared scoped access checker
export { createScopedAccessChecker, type ScopedAccessChecker } from './scoped-access-checker';

// Scoped APIs
export { createScopedClipboardAPI } from './scoped-clipboard-api';
export { createScopedColumnsAPI } from './scoped-columns-api';
export { createScopedConnectionsAPI } from './scoped-connections-api';
export { createScopedEventsAPI } from './scoped-events-api';
export { createScopedNetworkAPI } from './scoped-network-api';
export { createScopedRecordsAPI } from './scoped-records-api';
export { createScopedRelationsAPI } from './scoped-relations-api';
export { createScopedTablesAPI } from './scoped-tables-api';
export { createScopedUndoAPI } from './scoped-undo-api';

// Ungated adapter (legacy/fallback path)
export { createUngatedAdapter } from './ungated-adapter';
