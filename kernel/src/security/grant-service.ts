/**
 * Capability Grant Service
 *
 * Manages the lifecycle of capability grants: grant, revoke, check, list.
 * Grants are now keyed by (CapabilitySubject, capabilityId) rather than
 * bare (AppId, capabilityId).
 *
 * @module kernel/security
 */

import type { CapabilitySubject } from './capability-subject';
import { subjectKey, subjectMatches, subjectsEqual } from './capability-subject';
import type { ICapabilityRegistryService } from './capability-registry';
import type { ITrustPolicyService } from './trust-policy';

// =============================================================================
// Types
// =============================================================================

/**
 * How a grant decision was made.
 */
export type GrantDecision =
  | 'auto-granted'
  | 'user-consented'
  | 'admin-approved'
  | 'denied'
  | 'revoked';

/**
 * A capability grant bound to a subject.
 */
export interface CapabilityGrant {
  /** The subject this grant applies to */
  readonly subject: CapabilitySubject;

  /** The capability ID (namespaced, e.g., 'mog:cells:read') */
  readonly capabilityId: string;

  /** Optional scope constraining the grant (opaque to the grant service) */
  readonly scope?: unknown;

  /** How the grant was decided */
  readonly decision: GrantDecision;

  /** When the grant was created (Unix ms) */
  readonly grantedAt: number;

  /** When the grant expires (Unix ms), undefined = no expiration */
  readonly expiresAt?: number;
}

/**
 * Result of checking a capability grant.
 */
export interface GrantCheckResult {
  /** Whether the capability is granted */
  readonly granted: boolean;

  /** The decision on the matching grant (if any) */
  readonly decision?: GrantDecision;

  /** The scope of the matching grant (if any) */
  readonly scope?: unknown;

  /** Human-readable reason for the check result */
  readonly reason?: string;
}

// =============================================================================
// Interface
// =============================================================================

/**
 * Service for managing capability grants.
 */
export interface ICapabilityGrantService {
  /**
   * Grant a capability to a subject.
   * If a matching grant already exists, it is replaced.
   */
  grant(
    subject: CapabilitySubject,
    capabilityId: string,
    scope: unknown | undefined,
    decision: GrantDecision,
    expiresAt?: number,
  ): CapabilityGrant;

  /**
   * Revoke a capability from a subject.
   * @returns true if a grant was revoked
   */
  revoke(subject: CapabilitySubject, capabilityId: string): boolean;

  /**
   * Check if a subject has a capability.
   *
   * Matching considers:
   * 1. Direct grants for the exact subject
   * 2. Broader grants that cover the subject (grant subject matches query)
   * 3. Implied capabilities from the registry
   * 4. Expiration
   * 5. Denied/revoked grants are not matches
   */
  check(subject: CapabilitySubject, capabilityId: string): GrantCheckResult;

  /**
   * List all active grants for a subject.
   * Only returns grants where the grant subject matches the query subject.
   */
  listGrants(subject: CapabilitySubject): readonly CapabilityGrant[];

  /**
   * List all grants for a specific capability ID (across all subjects).
   */
  listGrantsForCapability(capabilityId: string): readonly CapabilityGrant[];
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Internal grant key: subject key + capability ID.
 */
function grantKey(subject: CapabilitySubject, capabilityId: string): string {
  return `${subjectKey(subject)}::${capabilityId}`;
}

/**
 * In-memory implementation of ICapabilityGrantService.
 */
export class CapabilityGrantService implements ICapabilityGrantService {
  /**
   * Primary store keyed by (subjectKey + capabilityId).
   */
  private readonly grants = new Map<string, CapabilityGrant>();

  /**
   * Optional registry for implied capability resolution.
   */
  private readonly registryService?: ICapabilityRegistryService;

  /**
   * Optional trust policy for auto-grant evaluation.
   */
  private readonly trustPolicy?: ITrustPolicyService;

  constructor(options?: {
    registryService?: ICapabilityRegistryService;
    trustPolicy?: ITrustPolicyService;
  }) {
    this.registryService = options?.registryService;
    this.trustPolicy = options?.trustPolicy;
  }

  grant(
    subject: CapabilitySubject,
    capabilityId: string,
    scope: unknown | undefined,
    decision: GrantDecision,
    expiresAt?: number,
  ): CapabilityGrant {
    const grant: CapabilityGrant = {
      subject,
      capabilityId,
      scope,
      decision,
      grantedAt: Date.now(),
      expiresAt,
    };

    const key = grantKey(subject, capabilityId);
    this.grants.set(key, grant);
    return grant;
  }

  revoke(subject: CapabilitySubject, capabilityId: string): boolean {
    const key = grantKey(subject, capabilityId);
    return this.grants.delete(key);
  }

  check(subject: CapabilitySubject, capabilityId: string): GrantCheckResult {
    // 1. Look for a direct or broader grant
    const matchingGrant = this.findMatchingGrant(subject, capabilityId);
    if (matchingGrant) {
      // Check expiration
      if (matchingGrant.expiresAt && Date.now() >= matchingGrant.expiresAt) {
        return {
          granted: false,
          decision: matchingGrant.decision,
          reason: 'Grant has expired',
        };
      }

      // Check decision type
      if (matchingGrant.decision === 'denied' || matchingGrant.decision === 'revoked') {
        return {
          granted: false,
          decision: matchingGrant.decision,
          reason: `Capability was ${matchingGrant.decision}`,
        };
      }

      return {
        granted: true,
        decision: matchingGrant.decision,
        scope: matchingGrant.scope,
      };
    }

    // 2. Check implied capabilities via registry
    if (this.registryService) {
      const allCaps = this.getAllGrantedCapabilityIds(subject);
      for (const grantedCapId of allCaps) {
        const implied = this.registryService.getImplied(grantedCapId);
        if (implied.includes(capabilityId)) {
          return {
            granted: true,
            reason: `Implied by granted capability '${grantedCapId}'`,
          };
        }
      }
    }

    return {
      granted: false,
      reason: 'No matching grant found',
    };
  }

  listGrants(subject: CapabilitySubject): readonly CapabilityGrant[] {
    const result: CapabilityGrant[] = [];
    const now = Date.now();

    for (const grant of this.grants.values()) {
      // Grant subject must match query subject
      if (!subjectMatches(grant.subject, subject)) continue;

      // Skip expired
      if (grant.expiresAt && now >= grant.expiresAt) continue;

      // Skip denied/revoked
      if (grant.decision === 'denied' || grant.decision === 'revoked') continue;

      result.push(grant);
    }

    return result;
  }

  listGrantsForCapability(capabilityId: string): readonly CapabilityGrant[] {
    const result: CapabilityGrant[] = [];
    const now = Date.now();

    for (const grant of this.grants.values()) {
      if (grant.capabilityId !== capabilityId) continue;
      if (grant.expiresAt && now >= grant.expiresAt) continue;
      if (grant.decision === 'denied' || grant.decision === 'revoked') continue;
      result.push(grant);
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Find a grant that matches the given subject and capability.
   * Prefers exact matches, then broader grants.
   */
  private findMatchingGrant(
    subject: CapabilitySubject,
    capabilityId: string,
  ): CapabilityGrant | undefined {
    // First try exact key lookup
    const exactKey = grantKey(subject, capabilityId);
    const exact = this.grants.get(exactKey);
    if (exact) return exact;

    // Then search all grants for broader matches
    for (const grant of this.grants.values()) {
      if (grant.capabilityId !== capabilityId) continue;
      if (subjectMatches(grant.subject, subject)) {
        return grant;
      }
    }

    return undefined;
  }

  /**
   * Get all capability IDs that are directly granted to a subject
   * (for implied capability resolution).
   */
  private getAllGrantedCapabilityIds(subject: CapabilitySubject): string[] {
    const ids: string[] = [];
    const now = Date.now();

    for (const grant of this.grants.values()) {
      if (!subjectMatches(grant.subject, subject)) continue;
      if (grant.expiresAt && now >= grant.expiresAt) continue;
      if (grant.decision === 'denied' || grant.decision === 'revoked') continue;
      ids.push(grant.capabilityId);
    }

    return ids;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new capability grant service.
 */
export function createCapabilityGrantService(options?: {
  registryService?: ICapabilityRegistryService;
  trustPolicy?: ITrustPolicyService;
}): CapabilityGrantService {
  return new CapabilityGrantService(options);
}
