/**
 * Scoped Connections API
 *
 * Creates a capability-gated wrapper for external database connections.
 *
 * CRITICAL: executeNative() requires connections:native capability.
 * The default Query interface requires only connections:read.
 */

import { CapabilityDeniedError } from '../../../errors/capability';
import type {
  GatedJsonValue,
  IGatedConnectionsAPI,
} from '../../../services/capabilities/gated-api';

import type { ScopedAPIContext } from './types';

/**
 * Interface for the full connections API (not defined in contracts yet).
 */
interface IFullConnectionsAPI {
  list(): Array<{ id: string; name: string; type: string }>;
  query(connectionId: string, query: GatedJsonValue): Promise<GatedJsonValue[]>;
  execute(connectionId: string, mutation: GatedJsonValue): Promise<GatedJsonValue>;
  create(config: GatedJsonValue): Promise<{ id: string }>;
  delete(connectionId: string): Promise<void>;
  executeNative(connectionId: string, rawQuery: string): Promise<GatedJsonValue>;
}

/**
 * Create a scoped connections API that enforces capability restrictions.
 *
 * @param fullApi - The full unrestricted connections API
 * @param context - The scoped API context
 * @returns A connections API with restricted access, or undefined
 */
export function createScopedConnectionsAPI(
  fullApi: IFullConnectionsAPI | undefined,
  context: ScopedAPIContext,
): IGatedConnectionsAPI | undefined {
  if (!fullApi) {
    return undefined;
  }

  const hasRead = context.hasCapability('connections:read');
  const hasWrite = context.hasCapability('connections:write');
  const hasCreate = context.hasCapability('connections:create');
  const hasNative = context.hasCapability('connections:native');

  // If no connection capabilities, return undefined
  if (!hasRead && !hasWrite && !hasCreate && !hasNative) {
    return undefined;
  }

  // Build the API object with only the methods for granted capabilities
  return {
    // Read methods
    ...(hasRead && {
      list: (): Array<{ id: string; name: string; type: string }> => {
        return fullApi.list();
      },
      query: async (connectionId: string, query: unknown): Promise<GatedJsonValue[]> => {
        return fullApi.query(connectionId, requireGatedJsonValue(query, 'query'));
      },
    }),

    // Write methods
    ...(hasWrite && {
      execute: async (connectionId: string, mutation: unknown): Promise<GatedJsonValue> => {
        return fullApi.execute(connectionId, requireGatedJsonValue(mutation, 'mutation'));
      },
    }),

    // Create methods
    ...(hasCreate && {
      create: async (config: unknown): Promise<{ id: string }> => {
        return fullApi.create(requireGatedJsonValue(config, 'config'));
      },
      delete: async (connectionId: string): Promise<void> => {
        return fullApi.delete(connectionId);
      },
    }),

    // Native query execution - CRITICAL: Requires connections:native
    ...(hasNative && {
      executeNative: async (connectionId: string, rawQuery: string): Promise<GatedJsonValue> => {
        // Double-check capability at execution time
        if (!context.hasCapability('connections:native')) {
          throw new CapabilityDeniedError(context.appId, 'connections:native', {
            operation: 'executeNative',
          });
        }
        return fullApi.executeNative(connectionId, rawQuery);
      },
    }),
  };
}

function requireGatedJsonValue(value: unknown, name: string): GatedJsonValue {
  if (isGatedJsonValue(value)) {
    return value;
  }
  throw new TypeError(`connections ${name} must be JSON-serializable`);
}

function isGatedJsonValue(value: unknown): value is GatedJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isGatedJsonValue);
  }

  if (typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  return Object.values(value as Record<string, unknown>).every(isGatedJsonValue);
}
