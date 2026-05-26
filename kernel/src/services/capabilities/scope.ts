/**
 * Capability Scope - Resource scoping and domain matching
 *
 * This file defines:
 * - scopeMatches(): Check if a scope grants access to a resource
 * - domainMatches(): Strict domain matching (no embedded domain attacks)
 * - validateScope(): Reject unbounded wildcards like 'table:*'
 *
 * Pure scope type definitions live in `./scope-types.ts` so they can be
 * referenced from the kernel error module without creating an import cycle
 * through the errors barrel. They are re-exported below for back-compat.
 *
 */

import { KernelError } from '../../errors';

import type { CapabilityScope, ParsedScope, ScopeValidationResult } from './scope-types';

// Re-export scope types from the neutral types module for back-compat.
// New code should prefer importing these directly from './scope-types'.
export type { CapabilityScope, ParsedScope, ScopeValidationResult } from './scope-types';

// =============================================================================
// Scope Parsing
// =============================================================================

/**
 * Parse a single scope component (e.g., "table:contacts").
 */
function parseSingleScope(scope: string): ParsedScope | null {
  const colonIndex = scope.indexOf(':');
  if (colonIndex === -1) return null;

  const resourceType = scope.substring(0, colonIndex).trim();
  const pattern = scope.substring(colonIndex + 1).trim();

  if (!resourceType || !pattern) return null;

  const hasWildcard = pattern.includes('*');
  // Unbounded = wildcard without prefix (just '*' or starts with '*')
  const isUnbounded = hasWildcard && (pattern === '*' || pattern.startsWith('*'));

  return {
    resourceType,
    pattern,
    hasWildcard,
    isUnbounded,
  };
}

/**
 * Parse a scope string into its components.
 * Handles comma-separated multiple scopes.
 *
 * @param scope - The scope string to parse
 * @returns Array of parsed scopes
 */
export function parseScope(scope: CapabilityScope): ParsedScope[] {
  const parts = scope
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const result: ParsedScope[] = [];

  for (const part of parts) {
    const parsed = parseSingleScope(part);
    if (parsed) {
      result.push(parsed);
    }
  }

  return result;
}

// =============================================================================
// Scope Validation
// =============================================================================

/**
 * Resource types that support unbounded wildcards only with allXxx capabilities.
 */
const PROTECTED_RESOURCE_TYPES = new Set(['table', 'cell', 'sheet']);

/**
 * Validate a scope string.
 *
 * Rules:
 * - Must have format "type:pattern" (optionally comma-separated)
 * - Unbounded wildcards (table:*, cell:*) are rejected for protected types
 * - Prefixed wildcards (table:sales_*) are allowed
 *
 * @param scope - The scope string to validate
 * @returns Validation result with parsed scopes if valid
 */
export function validateScope(scope: string): ScopeValidationResult {
  if (!scope || typeof scope !== 'string') {
    return { valid: false, error: 'Scope must be a non-empty string' };
  }

  const scopes = parseScope(scope as CapabilityScope);
  if (scopes.length === 0) {
    return {
      valid: false,
      error: 'Invalid scope format. Expected "type:pattern" (e.g., "table:contacts")',
    };
  }

  for (const parsed of scopes) {
    // Check for unbounded wildcards on protected resource types
    if (parsed.isUnbounded && PROTECTED_RESOURCE_TYPES.has(parsed.resourceType)) {
      return {
        valid: false,
        error:
          `Unbounded wildcard "${parsed.resourceType}:*" is not allowed. ` +
          `Use "all${capitalize(parsed.resourceType)}s:read" capability instead, or use a prefixed pattern like "${parsed.resourceType}:prefix_*"`,
      };
    }
  }

  return { valid: true, scopes };
}

/**
 * Create a validated scope (throws if invalid).
 *
 * @param scope - The scope string to create
 * @returns A validated CapabilityScope
 * @throws Error if scope is invalid
 */
export function createScope(scope: string): CapabilityScope {
  const result = validateScope(scope);
  if (!result.valid) {
    throw new KernelError('CAP_INVALID_SCOPE', result.error!);
  }
  return scope as CapabilityScope;
}

// =============================================================================
// Scope Matching
// =============================================================================

/**
 * Check if a scope grants access to a specific resource.
 *
 * @param scope - The scope to check
 * @param resourceType - The type of resource being accessed (e.g., 'table')
 * @param resourceId - The ID of the resource being accessed (e.g., 'contacts')
 * @returns True if the scope grants access
 */
export function scopeMatches(
  scope: CapabilityScope,
  resourceType: string,
  resourceId: string,
): boolean {
  const scopes = parseScope(scope);

  for (const parsed of scopes) {
    if (parsed.resourceType !== resourceType) continue;

    if (patternMatches(parsed.pattern, resourceId)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a pattern matches a value.
 * Supports simple wildcard patterns (prefix_* or *_suffix).
 */
function patternMatches(pattern: string, value: string): boolean {
  // Exact match
  if (pattern === value) return true;

  // No wildcard = must be exact
  if (!pattern.includes('*')) return false;

  // Simple wildcard at end (prefix_*)
  if (pattern.endsWith('*') && !pattern.includes('*', 0)) {
    const prefix = pattern.slice(0, -1);
    return value.startsWith(prefix);
  }

  // Simple wildcard at start (*_suffix)
  if (pattern.startsWith('*') && pattern.lastIndexOf('*') === 0) {
    const suffix = pattern.slice(1);
    return value.endsWith(suffix);
  }

  // Full wildcard (should have been caught by validation)
  if (pattern === '*') return true;

  // Convert to regex for complex patterns
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except *
    .replace(/\*/g, '.*'); // Convert * to .*
  return new RegExp(`^${regexPattern}$`).test(value);
}

// =============================================================================
// Domain Matching (Security Critical)
// =============================================================================

/**
 * Check if a domain pattern matches a given domain.
 *
 * SECURITY: Uses strict matching to prevent embedded domain attacks.
 *
 * Pattern formats:
 * - "example.com" - Exact match only
 * - "*.example.com" - Subdomains only (one level), NOT example.com itself
 * - "**.example.com" - example.com AND all subdomains
 *
 * SECURITY GUARANTEES:
 * - "evil.example.com.attacker.com" does NOT match "example.com"
 * - "example.com.attacker.com" does NOT match "*.example.com"
 * - IP addresses are matched exactly (no wildcard support)
 *
 * @param pattern - The domain pattern to match against
 * @param domain - The actual domain being accessed
 * @returns True if the pattern matches the domain
 */
export function domainMatches(pattern: string, domain: string): boolean {
  // Normalize: lowercase, trim
  const normalizedPattern = pattern.toLowerCase().trim();
  const normalizedDomain = domain.toLowerCase().trim();

  // Reject empty
  if (!normalizedPattern || !normalizedDomain) return false;

  // Reject if domain looks like an IP (no wildcard matching for IPs)
  if (isIPAddress(normalizedDomain)) {
    return normalizedPattern === normalizedDomain;
  }

  // Double-star wildcard: **.example.com matches example.com and all subdomains
  if (normalizedPattern.startsWith('**.')) {
    const baseDomain = normalizedPattern.slice(3);
    return normalizedDomain === baseDomain || normalizedDomain.endsWith('.' + baseDomain);
  }

  // Single-star wildcard: *.example.com matches subdomains only (one level)
  if (normalizedPattern.startsWith('*.')) {
    const baseDomain = normalizedPattern.slice(2);
    // Must end with .baseDomain
    if (!normalizedDomain.endsWith('.' + baseDomain)) return false;
    // Check it's exactly one level of subdomain
    const subdomain = normalizedDomain.slice(0, -(baseDomain.length + 1));
    // No dots in subdomain = one level only
    return !subdomain.includes('.');
  }

  // Exact match only
  return normalizedPattern === normalizedDomain;
}

/**
 * Check if a string looks like an IP address.
 */
function isIPAddress(value: string): boolean {
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return true;
  // IPv6 (simplified check)
  if (value.includes(':') && /^[0-9a-f:]+$/i.test(value)) return true;
  return false;
}

// =============================================================================
// Scope Utilities
// =============================================================================

/**
 * Combine multiple scopes into a single scope string.
 *
 * @param scopes - Array of scope strings
 * @returns Combined scope string
 */
export function combineScopes(scopes: readonly CapabilityScope[]): CapabilityScope {
  return scopes.join(',') as CapabilityScope;
}

/**
 * Check if a scope is empty or undefined.
 */
export function isScopeEmpty(scope: CapabilityScope | undefined | null): boolean {
  return !scope || scope.trim() === '';
}

/**
 * Get all resource types from a scope.
 */
export function getScopeResourceTypes(scope: CapabilityScope): string[] {
  const parsed = parseScope(scope);
  return Array.from(new Set(parsed.map((p) => p.resourceType)));
}

/**
 * Filter a scope to only include entries for a specific resource type.
 */
export function filterScopeByType(
  scope: CapabilityScope,
  resourceType: string,
): CapabilityScope | null {
  const parsed = parseScope(scope);
  const filtered = parsed.filter((p) => p.resourceType === resourceType);
  if (filtered.length === 0) return null;
  return filtered.map((p) => `${p.resourceType}:${p.pattern}`).join(',') as CapabilityScope;
}

// =============================================================================
// Helpers
// =============================================================================

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
