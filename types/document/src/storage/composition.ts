/**
 * Composition validation types
 *
 * Types for validating provider composition rules: role constraints,
 * durability requirements, conflict detection, etc.
 */

import type {
  DocumentDurabilityMode,
  StorageProviderKind,
  StorageProviderRole,
} from './document-provider';
import type { StorageRuntimeProfile } from './profiles';

// =============================================================================
// Role Constraint
// =============================================================================

/**
 * Constraint on how many providers of a given role may be present.
 */
export interface ProviderRoleConstraint {
  readonly role: StorageProviderRole;
  /** Minimum number of providers with this role. */
  readonly min: number;
  /** Maximum number of providers with this role (null = unbounded). */
  readonly max: number | null;
  /** Whether at least one must be required (not optional). */
  readonly mustHaveRequired: boolean;
}

// =============================================================================
// Durability Requirement
// =============================================================================

/**
 * Maps a durability mode to the provider composition required to achieve it.
 */
export interface DurabilityRequirement {
  readonly durability: DocumentDurabilityMode;
  /** Provider roles that must be present. */
  readonly requiredRoles: readonly StorageProviderRole[];
  /** Provider kinds that satisfy the durable storage requirement. */
  readonly durableKinds: readonly StorageProviderKind[];
  /** Whether at least one durable provider must be `required: true`. */
  readonly mustHaveRequiredDurable: boolean;
}

// =============================================================================
// Provider Kind Compatibility
// =============================================================================

/**
 * Describes which roles a given provider kind can serve.
 */
export interface ProviderKindRoleCompatibility {
  readonly kind: StorageProviderKind;
  /** Roles this kind can serve. */
  readonly supportedRoles: readonly StorageProviderRole[];
  /** Whether this kind is considered durable. */
  readonly durable: boolean;
  /** Whether this kind supports write operations. */
  readonly writable: boolean;
}

// =============================================================================
// Composition Violation
// =============================================================================

/**
 * Describes a single composition rule violation.
 */
export interface CompositionViolation {
  /** Stable machine-readable violation code. */
  readonly code: string;
  /** Human-readable description of the violation. */
  readonly message: string;
  /** Severity: 'error' means the composition is invalid. */
  readonly severity: 'error' | 'warning';
  /** The rule that was violated. */
  readonly rule: string;
  /** Providers involved in the violation. */
  readonly involvedProviderRefIds?: readonly string[];
}

// =============================================================================
// Composition Validation Result
// =============================================================================

/**
 * Result of validating a provider composition.
 */
export interface CompositionValidationResult {
  readonly valid: boolean;
  readonly violations: readonly CompositionViolation[];
  readonly warnings: readonly CompositionViolation[];
  /** The effective durability mode after validation. */
  readonly effectiveDurability: DocumentDurabilityMode;
  /** Whether read-only fallback was applied. */
  readonly readOnlyFallbackApplied: boolean;
}

// =============================================================================
// Composition Rule Set
// =============================================================================

/**
 * Complete set of composition rules for a runtime profile.
 */
export interface CompositionRuleSet {
  readonly profile: StorageRuntimeProfile;
  readonly roleConstraints: readonly ProviderRoleConstraint[];
  readonly durabilityRequirements: readonly DurabilityRequirement[];
  readonly kindCompatibility: readonly ProviderKindRoleCompatibility[];
  /** Provider kinds that are forbidden in this profile. */
  readonly forbiddenKinds: readonly StorageProviderKind[];
  /** Provider kind combinations that conflict with each other. */
  readonly conflictingKindPairs: readonly [StorageProviderKind, StorageProviderKind][];
}
