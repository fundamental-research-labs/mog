/**
 * Security Types - Data access control type definitions
 *
 * This file defines ONLY type definitions for the data access control system.
 * Runtime implementation lives in @mog-sdk/kernel/services/security.
 *
 * The security system is Layer 2 in the three-layer enforcement stack:
 *   Layer 3: Capabilities  "Can this APP call cells:read at all?"    (API gate)
 *   Layer 2: Data Policies "Can this PRINCIPAL see values in col B?" (data filter)
 *   Layer 1: Protection    "Is this cell locked for non-owners?"     (Excel compat)
 *
 */

import type { SheetId } from '@mog/types-core/core';
import type { ColId } from '@mog/types-core/cell-identity';

// =============================================================================
// Principals (opaque tags)
// =============================================================================

/**
 * A principal is identified by a set of opaque string tags.
 * Mog provides the matching engine; apps define their own identity taxonomy.
 *
 * Examples:
 * - `{ tags: ['user:alice@co.com', 'team:finance'] }`
 * - `{ tags: ['agent:copilot'] }`
 * - `{ tags: ['mog:owner'] }`
 */
export interface AccessPrincipal {
  readonly tags: string[];
}

/**
 * Glob-matchable tag pattern for matching against principal tags.
 *
 * Examples:
 * - `"agent:copilot"` — exact match
 * - `"agent:*"` — all agents
 * - `"sf:role:*"` — all Salesforce roles
 * - `"*"` — everyone
 */
export type TagMatcher = string;

/**
 * Tag specificity for resolution algorithm sort (SG-2).
 * When multiple policies match at the same target specificity,
 * tag specificity is the secondary sort dimension (before priority).
 */
export type TagSpecificity = 'exact' | 'prefix-glob' | 'wildcard';

// =============================================================================
// Targets (identity-based, discriminated union)
// =============================================================================

/**
 * Identity-based resource target. Currently supports workbook, sheet, and column.
 * Uses a discriminated union for type-safe exhaustive switch checking.
 */
export type AccessTarget =
  | { readonly kind: 'workbook' }
  | { readonly kind: 'sheet'; readonly sheetId: SheetId }
  | { readonly kind: 'column'; readonly colId: ColId; readonly sheetId: SheetId };

/**
 * Target matcher — same structure as AccessTarget but allows `'*'` wildcards
 * for IDs to match any resource of that kind.
 */
export type TargetMatcher =
  | { readonly kind: 'workbook' }
  | { readonly kind: 'sheet'; readonly sheetId: SheetId | '*' }
  | { readonly kind: 'column'; readonly colId: ColId | '*'; readonly sheetId: SheetId | '*' };

// =============================================================================
// Access Levels
// =============================================================================

/**
 * Single linear access level scale. No per-aspect complexity.
 *
 * - `none` — hidden, scope doesn't exist for this principal
 * - `structure` — formulas, types, formatting visible; values show type placeholders
 * - `read` — full data, no write
 * - `write` — full access
 * - `admin` — full access + can modify policies
 */
export type AccessLevel = 'none' | 'structure' | 'read' | 'write' | 'admin';

/**
 * Numeric ordering for access level comparison.
 * Higher number = more permissive.
 */
export const ACCESS_LEVEL_ORDER: Record<AccessLevel, number> = {
  none: 0,
  structure: 1,
  read: 2,
  write: 3,
  admin: 4,
};

// =============================================================================
// Policies
// =============================================================================

/**
 * Branded policy identifier.
 */
export type PolicyId = string & { readonly __brand?: 'PolicyId' };

/**
 * A data access policy. Policies define what access level a principal
 * (matched by tag glob) has to a target (matched by target pattern).
 *
 * `level: 'none'` is the deny — there is no separate `effect` field.
 */
export interface AccessPolicy {
  readonly id: PolicyId;

  /** Glob-matched against principal's tags */
  readonly principalTag: TagMatcher;

  /** Target pattern to match */
  readonly target: TargetMatcher;

  /** The granted access level */
  readonly level: AccessLevel;

  /**
   * Higher priority wins within the same specificity tier.
   *
   * Recommended ranges:
   * - 0-99: App-defined policies (default: 0)
   * - 100-199: Template-generated policies
   * - 200+: Platform/system policies (owner lockout, etc.)
   */
  readonly priority: number;

  /** Whether this policy is active */
  readonly enabled: boolean;

  /** Policy metadata for auditing and template tracking */
  readonly metadata: AccessPolicyMetadata;
}

/**
 * Metadata attached to an access policy.
 */
export interface AccessPolicyMetadata {
  /** Tag of the principal who created this policy */
  readonly createdBy: string;

  /** Creation timestamp (epoch ms) */
  readonly createdAt: number;

  /** Human-readable description */
  readonly description?: string;

  /** If created by a template, tracks which one */
  readonly templateId?: string;
}
