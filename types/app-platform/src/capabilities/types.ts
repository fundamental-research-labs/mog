import type { AppId } from '../manifest/types';
import type { StabilityTier, CompatibilityProfileId } from '../manifest/types';
import type { AppInstanceId } from '../lifecycle/types';
import type { PackageId } from '../package/types';

// ─── Branded Types ───────────────────────────────────────────────────────────

declare const __capabilityIdBrand: unique symbol;

/** Opaque namespaced capability identifier (e.g. "mog.clipboard/read"). */
export type CapabilityId = string & {
  readonly [__capabilityIdBrand]: typeof __capabilityIdBrand;
};

/** Create a branded CapabilityId from a raw string. */
export function createCapabilityId(raw: string): CapabilityId {
  return raw as CapabilityId;
}

// ─── Risk Tier ───────────────────────────────────────────────────────────────

/** Risk classification for a capability. */
export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

// ─── Grant Decision ──────────────────────────────────────────────────────────

/** How a capability grant was decided. */
export type GrantDecision =
  | 'auto-granted'
  | 'user-consented'
  | 'admin-approved'
  | 'denied'
  | 'revoked';

// ─── Subject Kind ────────────────────────────────────────────────────────────

/** Kind of principal that can hold a capability grant. */
export type SubjectKind = 'package' | 'app' | 'plugin' | 'instance' | 'workspace' | 'tenant';

// ─── Capability Subject / Grant Principal ────────────────────────────────────

/** Principal that holds capability grants (fields present depend on subject kind). */
export interface CapabilitySubject {
  /** Package that owns the subject. */
  readonly packageId?: PackageId;
  /** App identity. */
  readonly appId?: AppId;
  /** Plugin identity. */
  readonly pluginId?: string;
  /** Running instance identity. */
  readonly instanceId?: AppInstanceId;
  /** Workspace scope. */
  readonly workspaceId?: string;
  /** Tenant scope. */
  readonly tenantId?: string;
  /** Resource binding scope. */
  readonly resourceBindingId?: string;
}

/** Alias for CapabilitySubject used in grant contexts. */
export type GrantPrincipal = CapabilitySubject;

// ─── Capability Metadata ─────────────────────────────────────────────────────

/** Consent requirements for a capability. */
export interface ConsentRequirement {
  /** Whether user consent is required. */
  readonly requiresUserConsent: boolean;
  /** Human-readable explanation shown to the user. */
  readonly consentMessage?: string;
}

/** Registry metadata for a defined capability. */
export interface CapabilityMetadata {
  /** Namespaced capability identifier. */
  readonly id: CapabilityId;
  /** Owner/definer of the capability. */
  readonly owner: string;
  /** Human-readable description. */
  readonly description: string;
  /** Risk classification. */
  readonly riskTier: RiskTier;
  /** Stability tier. */
  readonly stabilityTier: StabilityTier;
  /** Compatibility profile this capability belongs to. */
  readonly compatibilityProfile: CompatibilityProfileId;
  /** Subject kinds allowed to hold this capability. */
  readonly allowedSubjectKinds: readonly SubjectKind[];
  /** JSON Schema for the capability's scope parameter. */
  readonly scopeSchema?: Record<string, unknown>;
  /** Capability IDs implied by granting this one. */
  readonly impliedCapabilities: readonly CapabilityId[];
  /** Capability IDs that must also be granted. */
  readonly dependentCapabilities: readonly CapabilityId[];
  /** Consent requirements. */
  readonly consentRequirements: ConsentRequirement;
}

// ─── Capability Grant ────────────────────────────────────────────────────────

/** A recorded grant of a capability to a subject. */
export interface CapabilityGrant {
  /** The subject receiving the grant. */
  readonly subject: CapabilitySubject;
  /** The granted capability. */
  readonly capability: CapabilityId;
  /** Optional scope narrowing the grant. */
  readonly scope?: Record<string, unknown>;
  /** How the grant was decided. */
  readonly decision: GrantDecision;
  /** ISO-8601 timestamp of the decision. */
  readonly timestamp: string;
}

// ─── Capability Subject View ─────────────────────────────────────────────────

/** Introspection interface for apps to query their own capabilities. */
export interface CapabilitySubjectView {
  /** Check whether a capability is granted. */
  hasCapability(id: CapabilityId): boolean;
  /** List all granted capability IDs. */
  listGrantedCapabilities(): readonly CapabilityId[];
  /** Get the scope for a granted capability, if any. */
  getScope(id: CapabilityId): Record<string, unknown> | undefined;
}
