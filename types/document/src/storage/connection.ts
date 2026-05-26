/**
 * Connection Configuration Types
 *
 * Types for configuring data source connections.
 * Users see these as "Connections" in the UI.
 *
 * SECURITY NOTE: Credentials (passwords, tokens) are NOT stored in these configs.
 * They are stored securely via:
 * - Desktop (Tauri): System keychain (macOS Keychain, Windows Credential Manager)
 * - Web: Server-side encrypted storage
 *
 */

// =============================================================================
// Branded Types
// =============================================================================

declare const TableIdBrand: unique symbol;
declare const RowIdBrand: unique symbol;

/**
 * A branded type for table identifiers.
 * Ensures type safety when passing table IDs between functions.
 */
export type TableId = string & { readonly [TableIdBrand]: never };

/**
 * A branded type for row identifiers.
 * Ensures type safety when passing row IDs between functions.
 */
export type RowId = string & { readonly [RowIdBrand]: never };

// =============================================================================
// Connection Status
// =============================================================================

/**
 * Connection status for a table driver.
 */
export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

// =============================================================================
// Driver Types
// =============================================================================

/**
 * Supported driver types.
 */
export type DriverType = 'local' | 'postgres' | 'mysql' | 'sqlite' | 'rest' | 'graphql';

// =============================================================================
// Base Connection Config
// =============================================================================

/**
 * Base configuration shared by all connection types.
 */
export interface BaseConnectionConfig {
  /** Unique identifier for this connection */
  id: string;
  /** Display name shown in UI */
  name: string;
  /** The driver type */
  type: DriverType;
}

// =============================================================================
// Database Connection Configs
// =============================================================================

/**
 * PostgreSQL connection configuration.
 * Credentials stored in system keychain, NOT here.
 */
export interface PostgresConnectionConfig extends BaseConnectionConfig {
  type: 'postgres';
  /** Database host */
  host: string;
  /** Database port (default: 5432) */
  port: number;
  /** Database name */
  database: string;
  /** Schema name (default: public) */
  schema?: string;
  /** Use SSL connection */
  ssl?: boolean;
  // Note: credentials (username, password) stored in system keychain, NOT here
}

/**
 * MySQL connection configuration.
 * Credentials stored in system keychain, NOT here.
 */
export interface MySQLConnectionConfig extends BaseConnectionConfig {
  type: 'mysql';
  /** Database host */
  host: string;
  /** Database port (default: 3306) */
  port: number;
  /** Database name */
  database: string;
  /** Use SSL connection */
  ssl?: boolean;
  // Note: credentials (username, password) stored in system keychain, NOT here
}

/**
 * SQLite connection configuration.
 * Desktop only - connects to a local SQLite file.
 */
export interface SQLiteConnectionConfig extends BaseConnectionConfig {
  type: 'sqlite';
  /** Path to the SQLite database file */
  filePath: string;
}

// =============================================================================
// API Connection Configs
// =============================================================================

/**
 * REST API connection configuration.
 */
export interface RestConnectionConfig extends BaseConnectionConfig {
  type: 'rest';
  /** Base URL for API requests */
  baseUrl: string;
  /** Default headers to include in requests */
  headers?: Record<string, string>;
  /** Endpoint mappings for CRUD operations */
  endpoints: {
    /** GET endpoint for listing records (e.g., "/users") */
    list?: string;
    /** GET endpoint for single record (e.g., "/users/:id") */
    get?: string;
    /** POST endpoint for creating records */
    create?: string;
    /** PUT/PATCH endpoint for updating records */
    update?: string;
    /** DELETE endpoint for deleting records */
    delete?: string;
  };
  /** Pagination configuration */
  pagination?: {
    /** Pagination type */
    type: 'offset' | 'cursor';
    /** Query parameter for page/cursor (default: "page" or "cursor") */
    pageParam?: string;
    /** Query parameter for limit (default: "limit") */
    limitParam?: string;
  };
}

/**
 * GraphQL API connection configuration.
 */
export interface GraphQLConnectionConfig extends BaseConnectionConfig {
  type: 'graphql';
  /** GraphQL endpoint URL */
  endpoint: string;
  /** Default headers to include in requests */
  headers?: Record<string, string>;
}

/**
 * Local connection configuration.
 * Data stored in the workbook file.
 */
export interface LocalConnectionConfig extends BaseConnectionConfig {
  type: 'local';
  // No additional config needed - data is local to the workbook
}

// =============================================================================
// Union Type
// =============================================================================

/**
 * Union of all connection configuration types.
 */
export type ConnectionConfig =
  | PostgresConnectionConfig
  | MySQLConnectionConfig
  | SQLiteConnectionConfig
  | RestConnectionConfig
  | GraphQLConnectionConfig
  | LocalConnectionConfig;

// =============================================================================
// Source Config (How to map to external data)
// =============================================================================

/**
 * Configuration for mapping a table to an external data source.
 */
export type SourceConfig =
  | { type: 'table'; tableName: string; schema?: string } // SQL tables
  | { type: 'endpoint'; path: string } // REST endpoints
  | { type: 'query'; queryName: string } // GraphQL queries
  | { type: 'local' }; // Local workbook storage

// =============================================================================
// Table Binding
// =============================================================================

/**
 * Maps a table to a connection and data source.
 * Stored in the workbook file.
 */
export interface TableBinding {
  /** The table ID in the kernel */
  tableId: TableId;
  /** The connection ID to use */
  connectionId: string;
  /** How to access data from this connection */
  sourceConfig: SourceConfig;
}

// =============================================================================
// Refresh Behavior
// =============================================================================

/**
 * When to refresh data from external sources.
 */
export type RefreshBehavior =
  | { type: 'manual' } // Only refresh when user requests
  | { type: 'onOpen' } // Refresh when workbook opens
  | { type: 'interval'; intervalMs: number }; // Refresh on interval
