/**
 * Capability Scope - Resource scoping and domain matching
 *
 * This file defines:
 * - CapabilityScope type
 * - scopeMatches(): Check if a scope grants access to a resource
 * - domainMatches(): Strict domain matching (no embedded domain attacks)
 * - validateScope(): Reject unbounded wildcards like 'table:*'
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
