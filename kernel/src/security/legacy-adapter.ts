/**
 * Legacy Adapter
 *
 * Bridges the new CapabilitySubject-based services with existing code
 * that passes bare AppId strings. This allows gradual migration of
 * launch-app.ts and other call sites.
 *
 * @module kernel/security
 */

import type { CapabilitySubject } from './capability-subject';
import { createCapabilitySubject } from './capability-subject';
import type {
  ICapabilityGrantService,
  GrantCheckResult,
  GrantDecision,
  CapabilityGrant,
} from './grant-service';

// =============================================================================
// Subject Helpers
// =============================================================================

/**
 * Create a CapabilitySubject from a bare app ID string.
 *
 * This is the primary adapter function — existing code that only has
 * an AppId can use this to interact with the new subject-based services.
 */
export function createLegacySubject(appId: string): CapabilitySubject {
  return createCapabilitySubject({ appId });
}

/**
 * Create a CapabilitySubject from a package ID and app ID.
 */
export function createPackageAppSubject(packageId: string, appId: string): CapabilitySubject {
  return createCapabilitySubject({ packageId, appId });
}

// =============================================================================
// Legacy Grant Service Wrapper
// =============================================================================

/**
 * A wrapper around ICapabilityGrantService that accepts bare app ID strings.
 *
 * Use this to bridge existing call sites that have not yet migrated
 * to the CapabilitySubject model.
 */
export class LegacyGrantServiceAdapter {
  private readonly grantService: ICapabilityGrantService;

  constructor(grantService: ICapabilityGrantService) {
    this.grantService = grantService;
  }

  /**
   * Grant a capability to an app by ID.
   */
  grant(
    appId: string,
    capabilityId: string,
    decision: GrantDecision = 'auto-granted',
    scope?: unknown,
  ): CapabilityGrant {
    const subject = createLegacySubject(appId);
    return this.grantService.grant(subject, capabilityId, scope, decision);
  }

  /**
   * Revoke a capability from an app by ID.
   */
  revoke(appId: string, capabilityId: string): boolean {
    const subject = createLegacySubject(appId);
    return this.grantService.revoke(subject, capabilityId);
  }

  /**
   * Check if an app has a capability by ID.
   */
  check(appId: string, capabilityId: string): GrantCheckResult {
    const subject = createLegacySubject(appId);
    return this.grantService.check(subject, capabilityId);
  }

  /**
   * Check if an app has a capability (boolean).
   */
  hasCapability(appId: string, capabilityId: string): boolean {
    return this.check(appId, capabilityId).granted;
  }

  /**
   * List grants for an app by ID.
   */
  listGrants(appId: string): readonly CapabilityGrant[] {
    const subject = createLegacySubject(appId);
    return this.grantService.listGrants(subject);
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a legacy adapter wrapping a grant service.
 */
export function createLegacyGrantServiceAdapter(
  grantService: ICapabilityGrantService,
): LegacyGrantServiceAdapter {
  return new LegacyGrantServiceAdapter(grantService);
}
