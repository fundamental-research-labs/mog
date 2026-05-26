/**
 * Filesystem permissions and sandboxing for Spreadsheet OS.
 *
 * This module provides:
 * - App-scoped sandboxing to restrict filesystem access
 * - Permission grants for accessing paths outside the sandbox
 * - Security errors for access violations
 *
 * Extracted from @mog-sdk/contracts/filesystem.
 */

import type { DirPath, FilePath } from './paths';
import { isUnder, normalizePath } from './paths';

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
 * Use `appId()` to create instances.
 */
export type AppId = string & { readonly [AppIdBrand]: never };

/**
 * Create a type-safe app identifier.
 *
 * App IDs should be unique, lowercase, and use only alphanumeric
 * characters, hyphens, and dots (similar to package names).
 *
 * @param id - The app identifier string
 * @returns A branded AppId
 *
 * @example
 * ```ts
 * const myApp = appId('com.example.my-app');
 * ```
 */
export function appId(id: string): AppId {
  return id as AppId;
}

/**
 * Validate an app ID format.
 *
 * Valid app IDs:
 * - Are non-empty
 * - Contain only lowercase alphanumeric, hyphens, and dots
 * - Don't start or end with a dot or hyphen
 * - Don't have consecutive dots or hyphens
 *
 * @param id - The app ID to validate
 * @returns true if valid
 */
export function isValidAppId(id: string): boolean {
  if (!id || id.length === 0) {
    return false;
  }

  // Must be lowercase alphanumeric, hyphens, and dots
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$|^[a-z0-9]$/.test(id)) {
    return false;
  }

  // No consecutive dots or hyphens
  if (/[.-]{2}/.test(id)) {
    return false;
  }

  return true;
}

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

/**
 * Check if a permission has expired.
 *
 * @param permission - The permission to check
 * @param now - Current timestamp (defaults to Date.now())
 * @returns true if permission has expired
 */
export function isPermissionExpired(permission: FilePermission, now: number = Date.now()): boolean {
  if (permission.expires === undefined) {
    return false;
  }
  return now >= permission.expires;
}

/**
 * Check if a permission grants the requested access level.
 *
 * @param permission - The permission to check
 * @param requested - The requested access level
 * @returns true if permission grants the requested access
 */
export function permissionGrantsAccess(
  permission: FilePermission,
  requested: AccessLevel,
): boolean {
  if (permission.access === 'read-write') {
    return true;
  }
  return permission.access === requested;
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

/**
 * Create a default sandbox configuration for an app.
 *
 * @param appId - The app identifier
 * @param rootPath - Optional root path (defaults to ~/.spreadsheet-os/apps/{appId})
 * @returns A sandbox configuration
 */
export function createSandboxConfig(appIdValue: AppId, rootPath?: string): SandboxConfig {
  return {
    rootPath: rootPath ?? `~/.spreadsheet-os/apps/${appIdValue}`,
    appId: appIdValue,
    allowedPaths: [],
    allowTempDir: false,
    allowNetworkPaths: false,
  };
}

// ============================================================
// Path Validation
// ============================================================

/**
 * Check if a path is within the sandbox.
 *
 * @param path - The path to check
 * @param sandbox - The sandbox configuration
 * @returns true if path is within sandbox
 */
export function isPathInSandbox(path: string, sandbox: SandboxConfig): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(sandbox.rootPath);

  // Path must be under or equal to root
  return normalizedPath === normalizedRoot || isUnder(normalizedPath, normalizedRoot);
}

/**
 * Check if an operation is allowed by permissions.
 *
 * @param path - The path being accessed
 * @param operation - The operation being performed ('read' or 'write')
 * @param sandbox - The sandbox configuration
 * @returns true if operation is allowed
 */
export function isOperationAllowed(
  path: string,
  operation: 'read' | 'write',
  sandbox: SandboxConfig,
): boolean {
  // Check sandbox first
  if (isPathInSandbox(path, sandbox)) {
    return true;
  }

  // Check allowed paths
  const normalizedPath = normalizePath(path);
  const now = Date.now();

  for (const permission of sandbox.allowedPaths ?? []) {
    // Skip expired permissions
    if (isPermissionExpired(permission, now)) {
      continue;
    }

    // Check if permission grants requested access
    if (!permissionGrantsAccess(permission, operation)) {
      continue;
    }

    const permissionPath = normalizePath(permission.path);

    // Exact match
    if (normalizedPath === permissionPath) {
      return true;
    }

    // Directory with recursive access
    if (permission.recursive !== false && isUnder(normalizedPath, permissionPath)) {
      return true;
    }
  }

  return false;
}

/**
 * Resolve a possibly relative path within a sandbox.
 *
 * @param path - The path (may be relative or absolute)
 * @param sandbox - The sandbox configuration
 * @returns The resolved absolute path
 * @throws PathEscapeError if the resolved path escapes the sandbox
 */
export function resolveSandboxPath(path: string, sandbox: SandboxConfig): string {
  const normalizedPath = normalizePath(path);

  // If absolute, check it's allowed
  if (normalizedPath.startsWith('/') || /^[A-Za-z]:/.test(normalizedPath)) {
    if (!isOperationAllowed(normalizedPath, 'read', sandbox)) {
      throw new PathEscapeError(path);
    }
    return normalizedPath;
  }

  // Relative path - resolve against sandbox root
  const rootPath = normalizePath(sandbox.rootPath);
  const parts = rootPath.split('/').filter((p) => p !== '');
  const relativeParts = normalizedPath.split('/').filter((p) => p !== '');

  for (const part of relativeParts) {
    if (part === '..') {
      parts.pop();
    } else if (part !== '.') {
      parts.push(part);
    }
  }

  const resolved = '/' + parts.join('/');

  // Verify resolved path is still in sandbox
  if (!isPathInSandbox(resolved, sandbox)) {
    throw new PathEscapeError(path);
  }

  return resolved;
}

// ============================================================
// Error Types
// ============================================================

/**
 * Error thrown when a path escapes the sandbox.
 */
export class PathEscapeError extends Error {
  constructor(public readonly path: string) {
    super(`Path escape attempt: ${path}`);
    this.name = 'PathEscapeError';
  }
}

/**
 * Error thrown when an operation is denied due to permissions.
 */
export class PermissionDeniedError extends Error {
  constructor(
    public readonly appId: AppId,
    public readonly path: string,
    public readonly operation: string,
  ) {
    super(`Permission denied: App "${appId}" cannot ${operation} "${path}"`);
    this.name = 'PermissionDeniedError';
  }
}

/**
 * Error thrown when an invalid app ID is used.
 */
export class InvalidAppIdError extends Error {
  constructor(public readonly invalidId: string) {
    super(
      `Invalid app ID: "${invalidId}". App IDs must be lowercase alphanumeric with hyphens and dots.`,
    );
    this.name = 'InvalidAppIdError';
  }
}

// ============================================================
// Permission Management
// ============================================================

/**
 * Create a permission grant.
 *
 * @param appIdValue - The app being granted permission
 * @param path - The path being granted access to
 * @param access - The access level
 * @param options - Additional options
 * @returns A permission grant
 */
export function createPermission(
  appIdValue: AppId,
  path: FilePath | DirPath,
  access: AccessLevel,
  options?: {
    expires?: number;
    recursive?: boolean;
  },
): FilePermission {
  return {
    appId: appIdValue,
    path,
    access,
    granted: Date.now(),
    expires: options?.expires,
    recursive: options?.recursive ?? true,
  };
}

/**
 * Add a permission to a sandbox configuration.
 *
 * @param sandbox - The sandbox configuration
 * @param permission - The permission to add
 * @returns A new sandbox configuration with the permission added
 */
export function addPermission(sandbox: SandboxConfig, permission: FilePermission): SandboxConfig {
  return {
    ...sandbox,
    allowedPaths: [...(sandbox.allowedPaths ?? []), permission],
  };
}

/**
 * Remove a permission from a sandbox configuration.
 *
 * @param sandbox - The sandbox configuration
 * @param path - The path to remove permission for
 * @returns A new sandbox configuration with the permission removed
 */
export function removePermission(sandbox: SandboxConfig, path: string): SandboxConfig {
  const normalizedPath = normalizePath(path);
  return {
    ...sandbox,
    allowedPaths: (sandbox.allowedPaths ?? []).filter(
      (p) => normalizePath(p.path) !== normalizedPath,
    ),
  };
}

/**
 * Remove all expired permissions from a sandbox configuration.
 *
 * @param sandbox - The sandbox configuration
 * @returns A new sandbox configuration with expired permissions removed
 */
export function pruneExpiredPermissions(sandbox: SandboxConfig): SandboxConfig {
  const now = Date.now();
  return {
    ...sandbox,
    allowedPaths: (sandbox.allowedPaths ?? []).filter((p) => !isPermissionExpired(p, now)),
  };
}
