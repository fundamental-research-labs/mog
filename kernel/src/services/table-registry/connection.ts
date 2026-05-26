/**
 * Connection Configuration Types
 *
 * Types for configuring data source connections.
 * Extracted from @mog-sdk/contracts/storage.
 */

// =============================================================================
// Branded Types
// =============================================================================

declare const TableIdBrand: unique symbol;
declare const RowIdBrand: unique symbol;

export type TableId = string & { readonly [TableIdBrand]: never };
export type RowId = string & { readonly [RowIdBrand]: never };

export function tableId(id: string): TableId {
  return id as TableId;
}

export function rowId(id: string): RowId {
  return id as RowId;
}

// =============================================================================
// Connection Status
// =============================================================================

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

// =============================================================================
// Driver Types
// =============================================================================

export type DriverType = 'local' | 'postgres' | 'mysql' | 'sqlite' | 'rest' | 'graphql';

// =============================================================================
// Base Connection Config
// =============================================================================

export interface BaseConnectionConfig {
  id: string;
  name: string;
  type: DriverType;
}

// =============================================================================
// Database Connection Configs
// =============================================================================

export interface PostgresConnectionConfig extends BaseConnectionConfig {
  type: 'postgres';
  host: string;
  port: number;
  database: string;
  schema?: string;
  ssl?: boolean;
}

export interface MySQLConnectionConfig extends BaseConnectionConfig {
  type: 'mysql';
  host: string;
  port: number;
  database: string;
  ssl?: boolean;
}

export interface SQLiteConnectionConfig extends BaseConnectionConfig {
  type: 'sqlite';
  filePath: string;
}

// =============================================================================
// API Connection Configs
// =============================================================================

export interface RestConnectionConfig extends BaseConnectionConfig {
  type: 'rest';
  baseUrl: string;
  headers?: Record<string, string>;
  endpoints: {
    list?: string;
    get?: string;
    create?: string;
    update?: string;
    delete?: string;
  };
  pagination?: {
    type: 'offset' | 'cursor';
    pageParam?: string;
    limitParam?: string;
  };
}

export interface GraphQLConnectionConfig extends BaseConnectionConfig {
  type: 'graphql';
  endpoint: string;
  headers?: Record<string, string>;
}

export interface LocalConnectionConfig extends BaseConnectionConfig {
  type: 'local';
}

// =============================================================================
// Union Type
// =============================================================================

export type ConnectionConfig =
  | PostgresConnectionConfig
  | MySQLConnectionConfig
  | SQLiteConnectionConfig
  | RestConnectionConfig
  | GraphQLConnectionConfig
  | LocalConnectionConfig;

// =============================================================================
// Source Config
// =============================================================================

export type SourceConfig =
  | { type: 'table'; tableName: string; schema?: string }
  | { type: 'endpoint'; path: string }
  | { type: 'query'; queryName: string }
  | { type: 'local' };

// =============================================================================
// Table Binding
// =============================================================================

export interface TableBinding {
  tableId: TableId;
  connectionId: string;
  sourceConfig: SourceConfig;
}

// =============================================================================
// Refresh Behavior
// =============================================================================

export type RefreshBehavior =
  | { type: 'manual' }
  | { type: 'onOpen' }
  | { type: 'interval'; intervalMs: number };

// =============================================================================
// Type Guards
// =============================================================================

export function isSqlConnection(
  config: ConnectionConfig,
): config is PostgresConnectionConfig | MySQLConnectionConfig | SQLiteConnectionConfig {
  return config.type === 'postgres' || config.type === 'mysql' || config.type === 'sqlite';
}

export function isApiConnection(
  config: ConnectionConfig,
): config is RestConnectionConfig | GraphQLConnectionConfig {
  return config.type === 'rest' || config.type === 'graphql';
}

export function isLocalConnection(config: ConnectionConfig): config is LocalConnectionConfig {
  return config.type === 'local';
}

// =============================================================================
// Default Configs
// =============================================================================

export const DEFAULT_POSTGRES_PORT = 5432;
export const DEFAULT_MYSQL_PORT = 3306;
export const DEFAULT_REFRESH_BEHAVIOR: RefreshBehavior = { type: 'manual' };
