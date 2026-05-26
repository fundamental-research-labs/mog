import type { PackageId, PackageSource } from '../package/types';
import type { CapabilityId, CapabilitySubject, GrantDecision } from '../capabilities/types';

// ─── Trust Source ────────────────────────────────────────────────────────────

/** Origin-based trust classification for a package. */
export type TrustSource =
  | 'bundled-first-party'
  | 'signed-marketplace'
  | 'local-dev'
  | 'enterprise-policy';

// ─── Trust Policy Decision ───────────────────────────────────────────────────

/** Policy decision about a package's trust level. */
export interface TrustPolicyDecision {
  /** Whether the package is allowed to install. */
  readonly canInstall: boolean;
  /** Whether the package is allowed to enable. */
  readonly canEnable: boolean;
  /** Whether capabilities can be auto-granted. */
  readonly canAutoGrant: boolean;
  /** Trust source that determined the decision. */
  readonly trustSource: TrustSource;
  /** Human-readable reason. */
  readonly reason?: string;
}

// ─── Trust Policy Service ────────────────────────────────────────────────────

/** Evaluate trust policies for packages. */
export interface ITrustPolicyService {
  /** Evaluate trust for a package from a given source. */
  evaluateTrust(packageId: PackageId, source: PackageSource): TrustPolicyDecision;
  /** Check whether a package source is trusted. */
  isSourceTrusted(source: PackageSource): boolean;
}

// ─── Capability Grant Service ────────────────────────────────────────────────

/** Manage capability grants for subjects. */
export interface ICapabilityGrantService {
  /** Grant a capability to a subject. */
  grant(
    subject: CapabilitySubject,
    capability: CapabilityId,
    decision: GrantDecision,
    scope?: Record<string, unknown>,
  ): void;
  /** Revoke a capability from a subject. */
  revoke(subject: CapabilitySubject, capability: CapabilityId): void;
  /** Check whether a subject holds a capability. */
  hasGrant(subject: CapabilitySubject, capability: CapabilityId): boolean;
}
