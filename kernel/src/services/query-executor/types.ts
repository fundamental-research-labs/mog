/**
 * Query Executor Types
 *
 * Type definitions for the query execution service.
 * Manages database connections, query execution, caching, and re-evaluation triggers.
 *
 */

import type { CellValue } from '@mog-sdk/contracts/core';
import type { CallableDisposable } from '@mog/spreadsheet-utils/disposable';
import type { Result } from '../primitives';

// =============================================================================
// Connection Configuration
// =============================================================================

/**
 * Supported database types for query executor.
 */
export type DatabaseType = 'clickhouse' | 'postgres' | 'mysql' | 'bigquery' | 'duckdb';

/**
 * Database connection configuration.
 * Stored in-memory by the connection registry.
 */
export interface ConnectionConfig {
  /** Unique connection identifier */
  id: string;
  /** Human-readable connection name */
  name: string;
  /** Database type */
  type: DatabaseType;
  /** Database host */
  host: string;
  /** Database port */
  port: number;
  /** Database name */
  database: string;
  /** Optional username */
  username?: string;
  /** Optional password */
  password?: string;
  /** Optional SSL configuration */
  ssl?: boolean;
  /** Index signature for IQueryExecutor compatibility */
  [key: string]: unknown;
}

// =============================================================================
// Connection Resolver
// =============================================================================

/**
 * External connection resolver interface.
 * Allows QueryExecutor to delegate connection lookups to an external source
 * (e.g., ConnectionManager backed by the store) while keeping its own local registry
 * as a fallback.
 */
export interface IConnectionResolver {
  /** Look up a connection config by name. */
  getConnectionConfig(name: string): ConnectionConfig | undefined;
  /** List all available connection names. */
  listConnectionNames(): string[];
}

// =============================================================================
// Query Execution
// =============================================================================

/**
 * Query result from database proxy.
 */
export interface QueryResult {
  /** Whether the query executed successfully */
  success: boolean;
  /** Result data as 2D array of cell values */
  data?: CellValue[][];
  /** Column names */
  columnNames?: string[];
  /** Column types */
  columnTypes?: string[];
  /** Number of rows returned */
  rowCount?: number;
  /** Query execution time in milliseconds */
  executionTimeMs?: number;
  /** Error message if query failed */
  error?: string;
  /** Whether result was truncated due to max rows limit */
  truncated?: boolean;
}

/**
 * Query error types.
 */
export type QueryErrorType =
  | 'connection_not_found'
  | 'connection_error'
  | 'network_error'
  | 'timeout'
  | 'invalid_sql'
  | 'execution_error';

/**
 * Query execution error.
 */
export interface QueryError extends Error {
  type: QueryErrorType;
  details?: Record<string, unknown>;
}

// =============================================================================
// Query Cache
// =============================================================================

/**
 * Cache entry for a query result.
 */
export interface QueryCacheEntry {
  /** Cache key (hash of connection + sql + params) */
  key: string;
  /** Cached query result */
  result: CellValue[][];
  /** Timestamp when cached */
  cachedAt: number;
  /** Column names from the result */
  columnNames?: string[];
  /** Column types from the result */
  columnTypes?: string[];
}

// =============================================================================
// Query Complete Event
// =============================================================================

/**
 * Event emitted when a query completes successfully.
 */
export interface QueryCompleteEvent {
  /** Cache key for the completed query */
  cacheKey: string;
  /** Query result */
  result: QueryResult;
  /** Timestamp when query completed */
  completedAt: number;
}

/**
 * Callback for query completion events.
 */
export type QueryCompleteCallback = (event: QueryCompleteEvent) => void;

// =============================================================================
// Query Executor Service Interface
// =============================================================================

/**
 * Query executor service interface.
 * Manages database connections, executes queries, and handles caching.
 */
export interface IQueryExecutor {
  // ===========================================================================
  // Connection Resolver
  // ===========================================================================

  /**
   * Set or replace the external connection resolver.
   * Allows wiring the resolver after construction (e.g., when
   * ConnectionManager is initialized asynchronously).
   *
   * @param resolver - The external connection resolver, or undefined to clear
   */
  setConnectionResolver(resolver: IConnectionResolver | undefined): void;

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /**
   * Register a database connection.
   * @param name - Human-readable connection name
   * @param config - Connection configuration
   */
  registerConnection(name: string, config: ConnectionConfig): void;

  /**
   * Get a connection by name.
   * @param name - Connection name
   * @returns Connection config or undefined if not found
   */
  getConnection(name: string): ConnectionConfig | undefined;

  /**
   * List all registered connection names.
   * @returns Array of connection names
   */
  listConnections(): string[];

  /**
   * Remove a connection by name.
   * @param name - Connection name
   */
  removeConnection(name: string): void;

  // ===========================================================================
  // Query Execution
  // ===========================================================================

  /**
   * Execute a query against a named connection.
   *
   * @param connectionName - Name of the connection to use
   * @param sql - SQL query to execute
   * @param params - Query parameters (for parameterized queries)
   * @returns Promise resolving to Result with query result or QueryError
   */
  executeQuery(
    connectionName: string,
    sql: string,
    params?: unknown[],
  ): Promise<Result<QueryResult, QueryError>>;

  // ===========================================================================
  // Cache Management
  // ===========================================================================

  /**
   * Get a cached query result.
   * @param cacheKey - Cache key (from buildCacheKey)
   * @returns Cached result or undefined if not in cache
   */
  getCachedResult(cacheKey: string): CellValue[][] | undefined;

  /**
   * Set a cached query result.
   * @param cacheKey - Cache key
   * @param result - Query result to cache
   * @param metadata - Optional metadata (column names, types)
   */
  setCachedResult(
    cacheKey: string,
    result: CellValue[][],
    metadata?: { columnNames?: string[]; columnTypes?: string[] },
  ): void;

  /**
   * Build a cache key from query parameters.
   * @param connectionId - Connection identifier (use connection.id, not name)
   * @param sql - SQL query
   * @param params - Query parameters
   * @returns Cache key string
   */
  buildCacheKey(connectionId: string, sql: string, params?: unknown[]): string;

  /**
   * Invalidate cache entries.
   * @param connectionId - Optional connection ID to invalidate (all if not specified)
   */
  invalidateCache(connectionId?: string): void;

  /**
   * Get cache statistics.
   * @returns Cache stats
   */
  getCacheStats(): { size: number; hits: number; misses: number };

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  /**
   * Register a callback for query completion events.
   * @param callback - Callback to invoke when queries complete
   * @returns Unsubscribe function
   */
  onQueryComplete(callback: QueryCompleteCallback): CallableDisposable;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Dispose the query executor and clean up resources.
   */
  dispose(): void;

  /**
   * TC39 Explicit Resource Management support.
   */
  [Symbol.dispose](): void;
}
