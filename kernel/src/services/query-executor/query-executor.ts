/**
 * Query Executor Service
 *
 * Maintains query metadata/cache plumbing while native database execution is disabled.
 *
 * Architecture:
 * - Calculator returns QueryRequest markers
 * - QueryExecutor intercepts markers during recalculation
 * - Checks cache, returns an unsupported error when execution is requested
 * - Triggers re-evaluation of dependent cells on completion
 *
 * Flow:
 * Calculator (pure) -> returns QueryRequest marker
 *      |
 * Kernel/QueryExecutor -> checks cache
 *      | (cache miss)
 * Unsupported until a production database boundary is reintroduced
 *
 */

import type { CellValue, IDisposable } from '@mog-sdk/contracts/core';
import type { CallableDisposable } from '@mog/spreadsheet-utils/disposable';
import type { Result } from '../primitives';
import { ok, err, TypedEventEmitter } from '../primitives';
import { QueryCache, buildCacheKey } from './query-cache';
import type {
  ConnectionConfig,
  IConnectionResolver,
  IQueryExecutor,
  QueryCompleteCallback,
  QueryCompleteEvent,
  QueryError,
  QueryErrorType,
  QueryResult,
} from './types';

// =============================================================================
// Error Helpers
// =============================================================================

/**
 * Create a QueryError with the specified type and message.
 */
function createQueryError(
  type: QueryErrorType,
  message: string,
  details?: Record<string, unknown>,
): QueryError {
  const error = new Error(message) as QueryError;
  error.type = type;
  error.details = details;
  return error;
}

// =============================================================================
// Internal Event Emitter (exposes emit for composition)
// =============================================================================

/**
 * Subclass that exposes emit() for use by QueryExecutor (composition pattern).
 * TypedEventEmitter.emit() is protected — only subclasses can call it.
 */
class QueryEventEmitter extends TypedEventEmitter<{ 'query:complete': QueryCompleteEvent }> {
  fire<K extends keyof { 'query:complete': QueryCompleteEvent }>(
    event: K,
    data: { 'query:complete': QueryCompleteEvent }[K],
  ): void {
    this.emit(event, data);
  }
}

// =============================================================================
// Query Executor Implementation
// =============================================================================

/**
 * Query executor service implementation.
 * Manages connections, executes queries, and handles caching.
 */
class QueryExecutor implements IQueryExecutor, IDisposable {
  // Connection registry: name -> config
  private connections = new Map<string, ConnectionConfig>();

  // Optional external connection resolver (e.g., ConnectionManager backed by the store)
  private connectionResolver?: IConnectionResolver;

  // Query result cache
  private cache: QueryCache;

  // Query complete event emitter (composition — QueryExecutor's primary model is event-based)
  private events = new QueryEventEmitter();

  /**
   * Create a new query executor.
   * @param options - Configuration options.
   */
  constructor(
    options: {
      cacheCapacity?: number;
      connectionResolver?: IConnectionResolver;
    } = {},
  ) {
    this.cache = new QueryCache(options.cacheCapacity ?? 100);
    this.connectionResolver = options.connectionResolver;
  }

  // ===========================================================================
  // Connection Resolver
  // ===========================================================================

  /**
   * Set or replace the external connection resolver.
   * This allows wiring the resolver after construction (e.g., when
   * ConnectionManager is initialized asynchronously).
   *
   * @param resolver - The external connection resolver, or undefined to clear
   */
  setConnectionResolver(resolver: IConnectionResolver | undefined): void {
    this.connectionResolver = resolver;
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  registerConnection(name: string, config: ConnectionConfig): void {
    this.connections.set(name, config);
  }

  getConnection(name: string): ConnectionConfig | undefined {
    // Check external resolver first, then fall back to local registry
    if (this.connectionResolver) {
      const resolved = this.connectionResolver.getConnectionConfig(name);
      if (resolved) return resolved;
    }
    return this.connections.get(name);
  }

  listConnections(): string[] {
    const localNames = Array.from(this.connections.keys());
    if (!this.connectionResolver) return localNames;

    // Merge resolver names with local names, deduplicating
    const resolverNames = this.connectionResolver.listConnectionNames();
    const nameSet = new Set([...resolverNames, ...localNames]);
    return Array.from(nameSet);
  }

  removeConnection(name: string): void {
    // Resolve connection ID before deletion for cache invalidation.
    // Cache keys use connection.id (not name), so we must invalidate by ID.
    const connection = this.getConnection(name);
    const invalidateKey = connection ? connection.id : name;
    this.connections.delete(name);
    // Invalidate all cached queries for this connection
    this.invalidateCache(invalidateKey);
  }

  // ===========================================================================
  // Query Execution
  // ===========================================================================

  async executeQuery(
    connectionName: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<Result<QueryResult, QueryError>> {
    // 1. Check if connection exists
    const connection = this.getConnection(connectionName);
    if (!connection) {
      return err(
        createQueryError('connection_not_found', `Connection "${connectionName}" not found`, {
          connectionName,
        }),
      );
    }

    void connection;
    void sql;
    void params;
    return err(
      createQueryError(
        'execution_error',
        'Database query execution has been removed from this build.',
      ),
    );
  }

  // ===========================================================================
  // Cache Management
  // ===========================================================================

  getCachedResult(cacheKey: string): CellValue[][] | undefined {
    return this.cache.get(cacheKey);
  }

  setCachedResult(
    cacheKey: string,
    result: CellValue[][],
    metadata?: { columnNames?: string[]; columnTypes?: string[] },
  ): void {
    this.cache.set(cacheKey, result, metadata);
  }

  buildCacheKey(connectionId: string, sql: string, params?: unknown[]): string {
    return buildCacheKey(connectionId, sql, params);
  }

  invalidateCache(connectionName?: string): void {
    if (connectionName) {
      // Invalidate all queries for this connection
      const prefix = `${connectionName}|`;
      this.cache.invalidateByPrefix(prefix);
    } else {
      // Invalidate entire cache
      this.cache.clear();
    }
  }

  getCacheStats(): { size: number; hits: number; misses: number } {
    const stats = this.cache.getStats();
    return {
      size: stats.size,
      hits: stats.hits,
      misses: stats.misses,
    };
  }

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  onQueryComplete(callback: QueryCompleteCallback): CallableDisposable {
    return this.events.on('query:complete', callback);
  }

  /**
   * Emit a query complete event to all listeners.
   * @private
   */
  private emitQueryComplete(cacheKey: string, result: QueryResult): void {
    this.events.fire('query:complete', {
      cacheKey,
      result,
      completedAt: Date.now(),
    });
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  dispose(): void {
    this.connections.clear();
    this.cache.clear();
    this.events.dispose();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new query executor service.
 * @param options - Optional cache and resolver configuration.
 * @returns QueryExecutor instance
 */
export function createQueryExecutor(options?: {
  cacheCapacity?: number;
  connectionResolver?: IConnectionResolver;
}): IQueryExecutor {
  return new QueryExecutor(options);
}
