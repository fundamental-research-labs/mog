/**
 * Storage Connection Runtime Functions
 *
 * Type guards, factory functions, and default consts for connection configs.
 * Types/interfaces remain in @mog-sdk/contracts/storage/connection.
 */

import type {
  ConnectionConfig,
  GraphQLConnectionConfig,
  LocalConnectionConfig,
  MySQLConnectionConfig,
  PostgresConnectionConfig,
  RefreshBehavior,
  RestConnectionConfig,
  RowId,
  SQLiteConnectionConfig,
  TableId,
} from '@mog-sdk/contracts/storage';

// =============================================================================
// Branded Type Factories
// =============================================================================

/**
 * Create a TableId from a string.
 */
export function tableId(id: string): TableId {
  return id as TableId;
}

/**
 * Create a RowId from a string.
 */
export function rowId(id: string): RowId {
  return id as RowId;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a connection config is for a SQL database.
 */
export function isSqlConnection(
  config: ConnectionConfig,
): config is PostgresConnectionConfig | MySQLConnectionConfig | SQLiteConnectionConfig {
  return config.type === 'postgres' || config.type === 'mysql' || config.type === 'sqlite';
}

/**
 * Check if a connection config is for an API.
 */
export function isApiConnection(
  config: ConnectionConfig,
): config is RestConnectionConfig | GraphQLConnectionConfig {
  return config.type === 'rest' || config.type === 'graphql';
}

/**
 * Check if a connection config is for local storage.
 */
export function isLocalConnection(config: ConnectionConfig): config is LocalConnectionConfig {
  return config.type === 'local';
}

// =============================================================================
// Default Configs
// =============================================================================

/**
 * Default PostgreSQL port.
 */
export const DEFAULT_POSTGRES_PORT = 5432;

/**
 * Default MySQL port.
 */
export const DEFAULT_MYSQL_PORT = 3306;

/**
 * Default refresh behavior (manual).
 */
export const DEFAULT_REFRESH_BEHAVIOR: RefreshBehavior = { type: 'manual' };
