/**
 * Inbound sync update provenance contracts.
 *
 * These types describe the durable, redacted provenance attached to sync
 * updates before they are eligible for version capture.
 */

import type {
  ProviderAuthorityCanonicalPayloadHashAlgorithm,
  ProviderAuthorityProof,
  ProviderAuthorityProofAudienceKind,
  ProviderAuthorityProofSchemaVersion,
  ProviderInboundProofField,
} from './inbound-proof';
import type { StorageScopeBinding } from './provider-identity';

export type SyncUpdateSourceKind =
  | 'providerReplay'
  | 'providerLiveInbound'
  | 'providerMixedInbound'
  | 'collaborationHydration'
  | 'collaborationLiveRemote'
  | 'collaborationMixedRemote'
  | 'importHydration'
  | 'systemRepair'
  | 'legacyRawUnknown';

export type SyncUpdateOriginKind = 'provider' | 'room' | 'import' | 'system' | 'legacyRaw';
export type SyncUpdateTrustStatus = 'verified' | 'trustedLocalSystem' | 'unverified' | 'legacyRaw';
export type SyncUpdateCapturePolicy = 'excluded' | 'commitEligible' | 'derivedOnly';

export type SyncUpdateExclusionReason =
  | 'providerReplay'
  | 'hydration'
  | 'importHydration'
  | 'systemRepair'
  | 'legacyRawUnknown'
  | 'mixedAuthors'
  | 'unknownAuthor'
  | 'unverifiedProvenance'
  | 'missingStableOrigin'
  | 'missingRedactionKey'
  | 'unsupportedRedactionPolicy'
  | 'partialProofCoverage'
  | 'payloadHashMismatch'
  | 'provenancePayloadHashMismatch'
  | 'localEcho'
  | 'rawUnclassified';

export interface ProvenanceRedactionPolicy {
  readonly schemaVersion: 'provenance-redaction-policy-v1';
  readonly mode: 'metadata-only' | 'opaque-digest-only' | 'diagnostic-only' | 'drop';
  readonly durableAuthorIdentity: 'unknown' | 'opaque-subject-ref' | 'hmac-sha256-digest';
  readonly durableProviderIdentity: 'unknown' | 'opaque-provider-ref' | 'hmac-sha256-digest';
  /**
   * Required when durable author/provider identity uses an HMAC digest. Without
   * a key, admission must keep authorship unknown instead of persisting raw
   * identity material or unkeyed hashes.
   */
  readonly redactionKeyId?: string;
  readonly proofMaterial: 'diagnostics-only' | 'drop';
}

export const DEFAULT_PROVENANCE_REDACTION_POLICY: ProvenanceRedactionPolicy = Object.freeze({
  schemaVersion: 'provenance-redaction-policy-v1',
  mode: 'diagnostic-only',
  durableAuthorIdentity: 'unknown',
  durableProviderIdentity: 'unknown',
  proofMaterial: 'diagnostics-only',
});

export interface RedactedRemoteAuthorRef {
  readonly kind: 'opaque-subject-ref' | 'hmac-sha256-digest';
  readonly value: string;
  readonly keyId?: string;
}

export interface RedactedAgentRef {
  readonly kind: 'opaque-agent-ref' | 'hmac-sha256-digest';
  readonly value: string;
  readonly keyId?: string;
}

export type SyncUpdateAuthorState =
  | {
      readonly kind: 'singleRemote';
      readonly remoteAuthorRef: RedactedRemoteAuthorRef;
    }
  | {
      readonly kind: 'mixedRemote';
      readonly participantCount?: number;
      readonly reason: 'aggregateWithoutBoundaries' | 'multipleProvenAuthors';
    }
  | {
      readonly kind: 'unknown';
      readonly reason:
        | 'legacyRaw'
        | 'providerReplay'
        | 'unverified'
        | 'notProvided'
        | 'redactionUnavailable'
        | 'mixedAggregate';
    }
  | {
      readonly kind: 'agent';
      readonly agentRef: RedactedAgentRef;
    }
  | {
      readonly kind: 'system';
      readonly systemRef:
        | 'provider-replay'
        | 'collaboration-hydration'
        | 'import-hydration'
        | 'system-repair';
    };

export interface SyncUpdateTrust {
  readonly status: SyncUpdateTrustStatus;
  readonly authorityRef?: string;
  readonly proofKind?: ProviderAuthorityProof['kind'];
  readonly proofSchemaVersion?: ProviderAuthorityProofSchemaVersion;
  readonly proofAudienceKinds?: readonly ProviderAuthorityProofAudienceKind[];
  readonly canonicalPayloadHashAlgorithm?: ProviderAuthorityCanonicalPayloadHashAlgorithm;
  readonly proofCoverage?: readonly ProviderInboundProofField[];
  readonly issuer?: string;
  readonly verifiedAt?: number;
}

export interface SyncUpdateIdentity {
  readonly originKind: SyncUpdateOriginKind;
  readonly stableOriginId?: string;
  readonly providerId?: string;
  readonly providerKind?: string;
  readonly providerRefId?: string;
  readonly storageScope?: StorageScopeBinding;
  readonly roomId?: string;
  readonly authorityRef?: string;
  readonly epoch?: string;
  readonly updateId?: string;
  readonly sequence?: bigint;
  readonly payloadHash: string;
  readonly provenancePayloadHash?: string;
}

export interface SyncUpdateExclusionDiagnostic {
  readonly reason: SyncUpdateExclusionReason;
  readonly subreason?: string;
  readonly message?: string;
}

export interface SyncUpdateProvenanceBase<K extends SyncUpdateSourceKind> {
  readonly schemaVersion: 'sync-update-provenance-v1';
  readonly sourceKind: K;
  readonly updateIdentity: SyncUpdateIdentity;
  readonly trust: SyncUpdateTrust;
  readonly author: SyncUpdateAuthorState;
  readonly remoteSessionId?: string;
  readonly correlationId?: string;
  readonly causationIds?: readonly string[];
  readonly replay: boolean;
  readonly system: boolean;
  readonly capturePolicy: SyncUpdateCapturePolicy;
  readonly redaction: ProvenanceRedactionPolicy;
  readonly exclusionDiagnostic?: SyncUpdateExclusionDiagnostic;
}

export type ProviderReplaySyncUpdateProvenance = SyncUpdateProvenanceBase<'providerReplay'> & {
  readonly replay: true;
  readonly system: true;
  readonly capturePolicy: 'excluded';
  readonly author:
    | Extract<SyncUpdateAuthorState, { readonly kind: 'unknown' }>
    | Extract<SyncUpdateAuthorState, { readonly kind: 'system' }>;
};

export type ProviderLiveInboundSyncUpdateProvenance =
  SyncUpdateProvenanceBase<'providerLiveInbound'>;

export type ProviderMixedInboundSyncUpdateProvenance =
  SyncUpdateProvenanceBase<'providerMixedInbound'> & {
    readonly capturePolicy: 'excluded';
    readonly author:
      | Extract<SyncUpdateAuthorState, { readonly kind: 'mixedRemote' }>
      | Extract<SyncUpdateAuthorState, { readonly kind: 'unknown' }>;
    readonly exclusionDiagnostic: SyncUpdateExclusionDiagnostic;
  };

export type CollaborationHydrationSyncUpdateProvenance =
  SyncUpdateProvenanceBase<'collaborationHydration'> & {
    readonly replay: true;
    readonly system: true;
    readonly capturePolicy: 'excluded';
  };

export type CollaborationLiveRemoteSyncUpdateProvenance =
  SyncUpdateProvenanceBase<'collaborationLiveRemote'>;

export type CollaborationMixedRemoteSyncUpdateProvenance =
  SyncUpdateProvenanceBase<'collaborationMixedRemote'> & {
    readonly capturePolicy: 'excluded';
    readonly author:
      | Extract<SyncUpdateAuthorState, { readonly kind: 'mixedRemote' }>
      | Extract<SyncUpdateAuthorState, { readonly kind: 'unknown' }>;
    readonly exclusionDiagnostic: SyncUpdateExclusionDiagnostic;
  };

export type ImportHydrationSyncUpdateProvenance = SyncUpdateProvenanceBase<'importHydration'> & {
  readonly replay: true;
  readonly system: true;
  readonly capturePolicy: 'excluded';
};

export type SystemRepairSyncUpdateProvenance = SyncUpdateProvenanceBase<'systemRepair'> & {
  readonly system: true;
  readonly capturePolicy: 'excluded' | 'derivedOnly';
};

export type LegacyRawUnknownSyncUpdateProvenance = SyncUpdateProvenanceBase<'legacyRawUnknown'> & {
  readonly capturePolicy: 'excluded';
  readonly trust: SyncUpdateTrust & { readonly status: 'legacyRaw' };
  readonly author: Extract<SyncUpdateAuthorState, { readonly kind: 'unknown' }>;
  readonly exclusionDiagnostic: SyncUpdateExclusionDiagnostic;
};

export type SyncUpdateProvenance =
  | ProviderReplaySyncUpdateProvenance
  | ProviderLiveInboundSyncUpdateProvenance
  | ProviderMixedInboundSyncUpdateProvenance
  | CollaborationHydrationSyncUpdateProvenance
  | CollaborationLiveRemoteSyncUpdateProvenance
  | CollaborationMixedRemoteSyncUpdateProvenance
  | ImportHydrationSyncUpdateProvenance
  | SystemRepairSyncUpdateProvenance
  | LegacyRawUnknownSyncUpdateProvenance;
