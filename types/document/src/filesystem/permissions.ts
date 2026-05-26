/**
 * Filesystem permissions and sandboxing type definitions for Spreadsheet OS.
 *
 * TYPES ONLY — all runtime permission functions, error classes, and sandbox
 * utilities live in @mog-sdk/kernel/services/filesystem/permissions.
 */

import type { DirPath, FilePath } from './paths';

// ============================================================
// App Identity
// ============================================================

/**
 * Brand symbol for app identifiers.
 * @internal
 */
declare const AppIdBrand: unique symbol;

/**
 * A branded string type representing an app identifier.
 * Use `appId()` from kernel to create instances.
 */
export type AppId = string & { readonly [AppIdBrand]: never };

// ============================================================
// Permission Types
// ============================================================

/**
 * Access level for a permission grant.
 */
export type AccessLevel = 'read' | 'write' | 'read-write';

/**
 * A permission grant for accessing a specific path.
 */
export interface FilePermission {
  /**
   * The app that was granted this permission.
   */
  appId: AppId;

  /**
   * The path that was granted access to.
   * Can be a file or directory.
   */
  path: FilePath | DirPath;

  /**
   * The level of access granted.
   */
  access: AccessLevel;

  /**
   * Timestamp when permission was granted (ms since epoch).
   */
  granted: number;

  /**
   * Optional expiry timestamp (ms since epoch).
   * If undefined, permission does not expire.
   */
  expires?: number;

  /**
   * Whether this permission includes subdirectories.
   * Only applicable for directory paths.
   * @default true
   */
  recursive?: boolean;
}

// ============================================================
// Sandbox Configuration
// ============================================================

/**
 * Configuration for an app's filesystem sandbox.
 */
export interface SandboxConfig {
  /**
   * Root path for the sandbox.
   * All paths will be relative to this unless explicitly allowed.
   *
   * @example '~/.spreadsheet-os/apps/com.example.my-app'
   */
  rootPath: string;

  /**
   * The app identifier.
   */
  appId: AppId;

  /**
   * Additional paths outside the sandbox that are allowed.
   * These require explicit user permission grants.
   */
  allowedPaths?: FilePermission[];

  /**
   * Whether to allow access to the system temp directory.
   * @default false
   */
  allowTempDir?: boolean;

  /**
   * Whether to allow network filesystem access.
   * @default false
   */
  allowNetworkPaths?: boolean;
}
