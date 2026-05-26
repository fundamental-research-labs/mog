/**
 * Capability Scope Types
 *
 * Pure type definitions for capability scopes. Extracted from `scope.ts` so
 * that `errors/capability.ts` can reference `CapabilityScope` without
 * importing the scope runtime module (which itself depends on the errors
 * barrel via `KernelError`, creating a cycle).
 *
 * Runtime `scope.ts` re-exports these types for back-compat; new code should
 * prefer importing them from here directly.
 *
 */

// =============================================================================
// Scope Types
// =============================================================================

/**
 * Resource scope for a capability.
 *
 * Format: "resource_type:resource_id" or "resource_type:pattern"
 *
 * Examples:
 * - "table:contacts" - Only the 'contacts' table
 * - "table:sales_*" - Tables matching prefix pattern
 * - "sheet:Sheet1" - Only Sheet1
 * - "domain:api.example.com" - Only this domain
 * - "domain:*.example.com" - Subdomains of example.com (one level)
 * - "domain:**.example.com" - example.com AND all subdomains
 *
 * Multiple scopes can be comma-separated:
 * - "table:contacts,table:deals,table:activities"
 */
export type CapabilityScope = string & { readonly __brand?: 'CapabilityScope' };

/**
 * Parsed scope component.
 */
export interface ParsedScope {
  /** Resource type (e.g., 'table', 'sheet', 'domain') */
  readonly resourceType: string;
  /** Resource identifier or pattern */
  readonly pattern: string;
  /** Whether the pattern contains a wildcard */
  readonly hasWildcard: boolean;
  /** Whether the wildcard is unbounded (requires allXxx capability) */
  readonly isUnbounded: boolean;
}

/**
 * Scope validation result.
 */
export interface ScopeValidationResult {
  /** Whether the scope is valid */
  readonly valid: boolean;
  /** Error message if invalid */
  readonly error?: string;
  /** Parsed scopes if valid */
  readonly scopes?: readonly ParsedScope[];
}
