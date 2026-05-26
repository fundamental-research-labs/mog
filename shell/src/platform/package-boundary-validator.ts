/**
 * Package Boundary Validator — validates that third-party packages
 * do not import forbidden internal modules.
 *
 * First-party (bundled) packages are exempt from boundary checks.
 *
 */

import type { AppManifest, PluginManifest } from './types';

// =============================================================================
// Types
// =============================================================================

export interface BoundaryViolation {
  readonly path: string;
  readonly reason: string;
}

export interface BoundaryValidationResult {
  readonly valid: boolean;
  readonly violations: readonly BoundaryViolation[];
}

export interface IPackageBoundaryValidator {
  validateAppImports(
    manifest: AppManifest,
    importPaths: readonly string[],
  ): BoundaryValidationResult;

  validatePluginImports(
    manifest: PluginManifest,
    importPaths: readonly string[],
  ): BoundaryValidationResult;
}

// =============================================================================
// Forbidden / allowed patterns
// =============================================================================

interface ForbiddenPattern {
  readonly prefix: string;
  readonly reason: string;
}

/**
 * Each prefix is tested with `startsWith`. For scoped package names like
 * `@mog/shell`, we include the bare name (matches the exact import) and
 * the name + `/` (matches subpath imports). For open prefixes like
 * `@mog/app-`, a single entry suffices because the hyphen is already
 * a non-ambiguous separator.
 */
const FORBIDDEN_PATTERNS: readonly ForbiddenPattern[] = [
  { prefix: '@mog/shell/', reason: 'Shell internals are not part of the public API' },
  { prefix: '@mog/app-', reason: 'App-specific internals are not part of the public API' },
  { prefix: '@mog-sdk/kernel/', reason: 'Kernel internals are not part of the public API' },
  {
    prefix: '@mog-sdk/contracts/',
    reason: 'Spreadsheet-specific contracts are not part of the third-party API',
  },
];

/**
 * Exact package names that are forbidden (bare import without subpath).
 */
const FORBIDDEN_EXACT: readonly { name: string; reason: string }[] = [
  { name: '@mog/shell', reason: 'Shell internals are not part of the public API' },
  { name: '@mog-sdk/kernel', reason: 'Kernel internals are not part of the public API' },
  {
    name: '@mog-sdk/contracts',
    reason: 'Spreadsheet-specific contracts are not part of the third-party API',
  },
];

/**
 * Import prefixes that are always allowed, even if they would otherwise
 * match a forbidden pattern. Checked BEFORE forbidden patterns.
 */
const ALLOWED_PREFIXES: readonly string[] = [
  '@mog/shell/platform',
  '@mog-sdk/types-app-platform/',
  '@mog-sdk/types-app-platform',
  '@mog-sdk/types-document/',
  '@mog-sdk/types-document',
];

// =============================================================================
// Implementation
// =============================================================================

function isAllowed(importPath: string): boolean {
  return ALLOWED_PREFIXES.some(
    (prefix) => importPath === prefix || importPath.startsWith(prefix + '/'),
  );
}

function checkImport(importPath: string): BoundaryViolation | null {
  if (isAllowed(importPath)) {
    return null;
  }

  for (const exact of FORBIDDEN_EXACT) {
    if (importPath === exact.name) {
      return { path: importPath, reason: exact.reason };
    }
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (importPath.startsWith(pattern.prefix)) {
      return { path: importPath, reason: pattern.reason };
    }
  }

  return null;
}

function validateImports(importPaths: readonly string[]): BoundaryValidationResult {
  const violations: BoundaryViolation[] = [];

  for (const importPath of importPaths) {
    const violation = checkImport(importPath);
    if (violation) {
      violations.push(violation);
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

export function createPackageBoundaryValidator(): IPackageBoundaryValidator {
  return {
    validateAppImports(
      _manifest: AppManifest,
      importPaths: readonly string[],
    ): BoundaryValidationResult {
      return validateImports(importPaths);
    },

    validatePluginImports(
      _manifest: PluginManifest,
      importPaths: readonly string[],
    ): BoundaryValidationResult {
      return validateImports(importPaths);
    },
  };
}
