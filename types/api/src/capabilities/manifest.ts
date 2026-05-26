/**
 * App Capability Manifest - App capability declarations
 *
 * This file defines:
 * - AppCapabilityManifest interface (required, optional, runtime, scoped)
 * - AppManifest extension with capabilities
 *
 */

import type { CapabilityScope } from './scope';
import type { CompositeCapability } from './taxonomy';
import type { CapabilityType } from './types';

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
