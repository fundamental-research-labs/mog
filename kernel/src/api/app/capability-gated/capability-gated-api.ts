/**
 * Capability-Gated API
 *
 * The main factory function that creates a capability-gated version of the kernel API.
 *
 * CORE PRINCIPLE: Apps receive ONLY interfaces for granted capabilities.
 * No runtime "permission denied" errors for missing capabilities - if you don't
 * have the capability, the interface is undefined.
 *
 * ```typescript
 * // App with cells:read but NOT tables:read
 * api.cells.getValue(...)  // Works
 * api.tables                // undefined - never had the interface
 * ```
 */

import type { IAppKernelAPI, IAppTablesAPI } from '@mog-sdk/contracts/apps';
import type { GatedJsonValue, IGatedAppKernelAPI } from '../../../services/capabilities/gated-api';

import type { CapabilityGatedAPIOptions, ScopedAPIContext } from './types';

import { createCapabilityIntrospection, createScopedAPIContext } from './introspection';
import { createScopedClipboardAPI } from './scoped-clipboard-api';
import { createScopedColumnsAPI } from './scoped-columns-api';
import { createScopedConnectionsAPI } from './scoped-connections-api';
import { createScopedEventsAPI } from './scoped-events-api';
import { createScopedNetworkAPI } from './scoped-network-api';
import { createScopedRecordsAPI } from './scoped-records-api';
import { createScopedRelationsAPI } from './scoped-relations-api';
import { createScopedTablesAPI } from './scoped-tables-api';
import { createScopedUndoAPI } from './scoped-undo-api';

/**
 * Full API options including the underlying kernel API.
 */
export interface CreateCapabilityGatedAPIOptions extends CapabilityGatedAPIOptions {
  /** The full unrestricted kernel API */
  readonly fullApi: IAppKernelAPI;

  /** Optional connections API (if external connections are supported) */
  readonly connectionsApi?: {
    list(): Array<{ id: string; name: string; type: string }>;
    query(connectionId: string, query: GatedJsonValue): Promise<GatedJsonValue[]>;
    execute(connectionId: string, mutation: GatedJsonValue): Promise<GatedJsonValue>;
    create(config: GatedJsonValue): Promise<{ id: string }>;
    delete(connectionId: string): Promise<void>;
    executeNative(connectionId: string, rawQuery: string): Promise<GatedJsonValue>;
  };
}

/**
 * Create a capability-gated version of the kernel API.
 *
 * This is the main entry point for the capability system. It takes a full
 * kernel API and returns a gated version where only the interfaces for
 * granted capabilities are available.
 *
 * @param options - Configuration options including the full API and registry
 * @returns A gated API where interfaces are only present for granted capabilities
 */
export function createCapabilityGatedApi(
  options: CreateCapabilityGatedAPIOptions,
): IGatedAppKernelAPI {
  const { fullApi, managedTableIds } = options;

  // Create the scoped API context
  const context = createScopedAPIContext(options);

  // Create capability introspection (always available)
  const capabilities = createCapabilityIntrospection(context, options);

  // Create scoped sub-APIs based on granted capabilities
  // Each returns undefined if the app lacks the required capabilities

  // Tier 1: Data APIs
  const tables = createScopedTablesAPI(fullApi.tables, context, managedTableIds);
  const columns = createScopedColumnsAPI(fullApi.columns, fullApi.tables, context, managedTableIds);
  const records = createScopedRecordsAPI(fullApi.records, fullApi.tables, context, managedTableIds);
  const relations = createScopedRelationsAPI(
    fullApi.relations,
    fullApi.tables,
    context,
    managedTableIds,
  );

  // Tier 2: Service APIs
  const events = createScopedEventsAPI(fullApi.events, fullApi.tables, context, managedTableIds);
  const clipboard = createScopedClipboardAPI(fullApi.clipboard, context);
  const undo = createScopedUndoAPI(fullApi.undo, context);

  // Tier 4: External APIs
  const network = createScopedNetworkAPI(context, options);
  const connections = createScopedConnectionsAPI(options.connectionsApi, context);

  // Create the gated undo group function
  const undoGroup = createGatedUndoGroup(fullApi, context, fullApi.tables);

  // Construct the gated API
  const gatedApi: IGatedAppKernelAPI = {
    // Always available
    capabilities,
    undoGroup,

    // Conditionally available based on capabilities
    ...(tables && { tables }),
    ...(columns && { columns }),
    ...(records && { records }),
    ...(relations && { relations }),
    ...(events && { events }),
    ...(clipboard && { clipboard }),
    ...(undo && { undo }),
    ...(network && { network }),
    ...(connections && { connections }),
  };

  return gatedApi;
}

/**
 * Create a gated undo group function.
 *
 * Delegates to the full API's batch(), which wraps operations in
 * beginUndoGroup/endUndoGroup. Individual scoped APIs validate each
 * operation as it executes — if one fails capability checks mid-group,
 * prior operations have already executed.
 */
function createGatedUndoGroup(
  fullApi: IAppKernelAPI,
  _context: ScopedAPIContext,
  _tablesApi: IAppTablesAPI,
): <T>(fn: () => Promise<T> | T, description?: string) => Promise<T> {
  return function undoGroup<T>(fn: () => Promise<T> | T, _description?: string): Promise<T> {
    return fullApi.undoGroup(fn, _description);
  };
}

// =============================================================================
// Re-exports
// =============================================================================

export type { CapabilityGatedAPIOptions, ScopedAPIContext } from './types';
