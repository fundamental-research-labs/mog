import type { VerifiedPrincipal, PrincipalIssuer } from './identity';
import type { HostTrustEnforcementProfile } from './trust';
import type { HostCanonicalFingerprint } from './fingerprints';

export type CapabilityName = string & { readonly __brand?: 'CapabilityName' };

export type CapabilityGrantScope =
  | { readonly kind: 'document'; readonly documentId: string }
  | { readonly kind: 'app-installation'; readonly appInstallationId: string }
  | { readonly kind: 'workspace' }
  | { readonly kind: 'tenant' };

export type CrossTenantDelegationProofField =
  | 'delegationId'
  | 'issuer'
  | 'delegatedByFingerprint'
  | 'actorFingerprint'
  | 'targetTenantId'
  | 'targetWorkspaceId'
  | 'sourceHostId'
  | 'scope'
  | 'capability'
  | 'operation'
  | 'issuedAt'
  | 'expiresAt';

export type CrossTenantCapabilityDelegationProof =
  | {
      readonly kind: 'trusted-delegation-registry';
      readonly registryId: string;
      readonly recordId: string;
      readonly canonicalPayloadHash: HostCanonicalFingerprint;
      readonly coveredFields: readonly CrossTenantDelegationProofField[];
    }
  | {
      readonly kind: 'signed-capability';
      readonly algorithm: 'hmac-sha256' | 'ed25519';
      readonly signatureOrMacRef: string;
      readonly canonicalPayloadHash: HostCanonicalFingerprint;
      readonly coveredFields: readonly CrossTenantDelegationProofField[];
    };

export interface CrossTenantCapabilityDelegation {
  readonly targetTenantId: string | { readonly kind: 'single-tenant' };
  readonly targetWorkspaceId: string | { readonly kind: 'no-workspace' };
  readonly delegatedBy: VerifiedPrincipal;
  readonly delegationId: string;
  readonly issuer: PrincipalIssuer;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly audience: {
    readonly sourceHostId: string;
    readonly actor: VerifiedPrincipal;
    readonly operation: 'read' | 'write' | 'execute' | 'admin';
  };
  readonly scope: CapabilityGrantScope;
  readonly capability: CapabilityName;
  readonly proof: CrossTenantCapabilityDelegationProof;
}

export interface CapabilityResourceContext {
  readonly tenantId: string | { readonly kind: 'single-tenant' };
  readonly workspaceId: string | { readonly kind: 'no-workspace' };
  readonly resolutionSource: 'trusted-control-plane' | 'trusted-adapter' | 'test-fixture';
}

export interface CapabilityGrantSubject {
  readonly scope: CapabilityGrantScope;
  readonly resourceContext: CapabilityResourceContext;
  readonly actor: VerifiedPrincipal;
  readonly sourceHostId: string;
  readonly capability: CapabilityName;
  readonly provenance:
    | 'trusted-first-party-host'
    | 'user-consent'
    | 'admin-policy'
    | 'signed-capability'
    | 'test-fixture'
    | 'cooperative-local';
  readonly delegation?: CrossTenantCapabilityDelegation;
}

export interface HostCapabilityRequest {
  readonly correlationId: string;
  readonly subject: CapabilityGrantSubject;
  readonly operation: 'read' | 'write' | 'execute' | 'admin';
}

export type HostCapabilityDecision =
  | {
      readonly allowed: true;
      readonly decisionId: string;
      readonly correlationId: string;
      readonly decidedAt: number;
      readonly operation: 'read' | 'write' | 'execute' | 'admin';
      readonly subject: CapabilityGrantSubject;
      readonly enforcement: HostTrustEnforcementProfile;
    }
  | {
      readonly allowed: false;
      readonly decisionId: string;
      readonly correlationId: string;
      readonly decidedAt: number;
      readonly operation: 'read' | 'write' | 'execute' | 'admin';
      readonly code: string;
      readonly reason: string;
      readonly subject: CapabilityGrantSubject;
      readonly enforcement: HostTrustEnforcementProfile;
    };

export interface HostCapabilityLookup {
  decide(request: HostCapabilityRequest): Promise<HostCapabilityDecision>;
}
