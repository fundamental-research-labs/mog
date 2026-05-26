/**
 * App Capability Manifest - App capability declarations
 *
 * This file defines:
 * - AppCapabilityManifest interface (required, optional, runtime, scoped)
 * - AppManifest extension with capabilities
 *
 */

import type { CapabilityType } from './cap-types';
import type { CapabilityScope } from './scope';
import type { CompositeCapability } from './taxonomy';

// =============================================================================
// Capability Request Types
// =============================================================================

/**
 * Trigger type for runtime capability requests.
 *
 * - 'user-action': User explicitly initiated an action requiring the capability
 * - 'feature-access': User accessed a feature that requires the capability
 */
export type CapabilityTrigger = 'user-action' | 'feature-access';

/**
 * An optional capability request in the manifest.
 * The app works without this capability but with reduced features.
 */
export interface OptionalCapabilityRequest {
  /** The capability being requested */
  readonly capability: CapabilityType | CompositeCapability;
  /** User-facing reason why this capability is needed */
  readonly reason: string;
}

/**
 * A runtime capability request in the manifest.
 * This capability is requested during execution, not at launch.
 */
export interface RuntimeCapabilityRequest {
  /** The capability being requested */
  readonly capability: CapabilityType;
  /** User-facing reason why this capability is needed */
  readonly reason: string;
  /** What triggers this request */
  readonly trigger: CapabilityTrigger;
}

/**
 * A scoped capability request in the manifest.
 * Access is limited to specific resources.
 */
export interface ScopedCapabilityRequest {
  /** The capability being requested */
  readonly capability: CapabilityType;
  /** Scope limiting access to specific resources */
  readonly scope: CapabilityScope;
  /** User-facing reason why this scope is needed */
  readonly reason: string;
}

// =============================================================================
// App Capability Manifest
// =============================================================================

/**
 * Capability manifest for an app.
 *
 * Declares all capabilities the app needs:
 * - required: App won't launch without these
 * - optional: App works without, reduced features (shown in consent)
 * - runtime: Requested during execution (not at launch)
 * - scoped: Access limited to specific resources
 */
export interface AppCapabilityManifest {
  /**
   * Required capabilities - app won't launch without these.
   * Can be individual capabilities or composite capabilities.
   */
  readonly required: readonly (CapabilityType | CompositeCapability)[];

  /**
   * Optional capabilities - app works without, with reduced features.
   * Shown in consent dialog, user can skip.
   */
  readonly optional?: readonly OptionalCapabilityRequest[];

  /**
   * Runtime capabilities - requested during execution.
   * Not shown at launch, requested when needed.
   */
  readonly runtime?: readonly RuntimeCapabilityRequest[];

  /**
   * Scoped capabilities - access limited to specific resources.
   * More restrictive than general capability grants.
   */
  readonly scoped?: readonly ScopedCapabilityRequest[];
}

// =============================================================================
// App Manifest (Extended)
// =============================================================================

/**
 * Extended app manifest with capability declarations.
 *
 * This extends the base AppManifest from apps/api.ts with capability support.
 * Apps declare their capabilities here for the consent flow.
 */
export interface AppManifestWithCapabilities {
  /** Unique app identifier */
  readonly id: string;

  /** Display name */
  readonly name: string;

  /** App version (semver) */
  readonly version: string;

  /** Icon (emoji or icon identifier) */
  readonly icon?: string;

  /** Description */
  readonly description?: string;

  /** Author */
  readonly author?: string;

  /**
   * Capability manifest declaring what permissions this app needs.
   */
  readonly capabilities: AppCapabilityManifest;

  /**
   * Whether this is a first-party (trusted) app.
   * First-party apps have their required capabilities auto-granted on first launch.
   */
  readonly firstParty?: boolean;
}

// =============================================================================
// First-Party App IDs
// =============================================================================

/**
 * Set of trusted first-party app IDs.
 * These apps have required capabilities auto-granted (no consent dialog).
 * Users can still revoke later via Settings.
 */
export const FIRST_PARTY_APP_IDS: ReadonlySet<string> = new Set([
  'spreadsheet',
  'crm',
  'analytics',
  'finance',
  'bug-tracker',
  'form-builder',
]);

/**
 * Check if an app ID is a first-party app.
 */
export function isFirstPartyApp(appId: string): boolean {
  return FIRST_PARTY_APP_IDS.has(appId);
}

// =============================================================================
// Manifest Validation
// =============================================================================

/**
 * Validation error for app manifests.
 */
export interface ManifestValidationError {
  readonly field: string;
  readonly message: string;
}

/**
 * Manifest validation result.
 */
export interface ManifestValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ManifestValidationError[];
}

/**
 * Validate an app capability manifest.
 *
 * Checks:
 * - Required capabilities array is not empty
 * - All capabilities are valid types
 * - Scoped capabilities have valid scopes
 * - No duplicate capabilities
 *
 * @param manifest - The manifest to validate
 * @returns Validation result
 */
export function validateCapabilityManifest(
  manifest: AppCapabilityManifest,
): ManifestValidationResult {
  const errors: ManifestValidationError[] = [];

  // Required must have at least one entry
  if (!manifest.required || manifest.required.length === 0) {
    errors.push({
      field: 'required',
      message: 'At least one required capability must be specified',
    });
  }

  // Check for duplicate required capabilities
  const requiredSet = new Set<string>();
  for (const cap of manifest.required || []) {
    if (requiredSet.has(cap)) {
      errors.push({
        field: 'required',
        message: `Duplicate capability: ${cap}`,
      });
    }
    requiredSet.add(cap);
  }

  // Check optional capabilities
  if (manifest.optional) {
    for (let i = 0; i < manifest.optional.length; i++) {
      const opt = manifest.optional[i];
      if (!opt.reason || opt.reason.trim() === '') {
        errors.push({
          field: `optional[${i}].reason`,
          message: 'Optional capability must have a reason',
        });
      }
      if (requiredSet.has(opt.capability)) {
        errors.push({
          field: `optional[${i}].capability`,
          message: `Capability "${opt.capability}" is already in required`,
        });
      }
    }
  }

  // Check runtime capabilities
  if (manifest.runtime) {
    for (let i = 0; i < manifest.runtime.length; i++) {
      const rt = manifest.runtime[i];
      if (!rt.reason || rt.reason.trim() === '') {
        errors.push({
          field: `runtime[${i}].reason`,
          message: 'Runtime capability must have a reason',
        });
      }
      if (!['user-action', 'feature-access'].includes(rt.trigger)) {
        errors.push({
          field: `runtime[${i}].trigger`,
          message: 'Invalid trigger type',
        });
      }
    }
  }

  // Check scoped capabilities
  if (manifest.scoped) {
    for (let i = 0; i < manifest.scoped.length; i++) {
      const sc = manifest.scoped[i];
      if (!sc.reason || sc.reason.trim() === '') {
        errors.push({
          field: `scoped[${i}].reason`,
          message: 'Scoped capability must have a reason',
        });
      }
      if (!sc.scope || sc.scope.trim() === '') {
        errors.push({
          field: `scoped[${i}].scope`,
          message: 'Scoped capability must have a scope',
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// =============================================================================
// Manifest Utilities
// =============================================================================

/**
 * Get all capabilities declared in a manifest (all types combined).
 *
 * @param manifest - The capability manifest
 * @returns Array of all capability types (may include composites)
 */
export function getAllManifestCapabilities(
  manifest: AppCapabilityManifest,
): (CapabilityType | CompositeCapability)[] {
  const caps: (CapabilityType | CompositeCapability)[] = [...manifest.required];

  if (manifest.optional) {
    caps.push(...manifest.optional.map((o) => o.capability));
  }

  if (manifest.runtime) {
    caps.push(...manifest.runtime.map((r) => r.capability));
  }

  if (manifest.scoped) {
    caps.push(...manifest.scoped.map((s) => s.capability));
  }

  return caps;
}

/**
 * Check if a manifest declares a specific capability (in any section).
 */
export function manifestDeclaresCapability(
  manifest: AppCapabilityManifest,
  capability: CapabilityType | CompositeCapability,
): boolean {
  return getAllManifestCapabilities(manifest).includes(capability);
}

/**
 * Get the reason for a capability from a manifest.
 * Returns undefined for required capabilities (no reason needed)
 * or if the capability is not in the manifest.
 */
export function getCapabilityReason(
  manifest: AppCapabilityManifest,
  capability: CapabilityType | CompositeCapability,
): string | undefined {
  const optional = manifest.optional?.find((o) => o.capability === capability);
  if (optional) return optional.reason;

  const runtime = manifest.runtime?.find((r) => r.capability === capability);
  if (runtime) return runtime.reason;

  const scoped = manifest.scoped?.find((s) => s.capability === capability);
  if (scoped) return scoped.reason;

  return undefined;
}
