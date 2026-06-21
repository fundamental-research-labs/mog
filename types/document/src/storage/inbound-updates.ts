/**
 * Inbound update types
 *
 * Types for updates arriving from remote storage providers into the
 * kernel. Covers authority proofs, update envelopes, and asset deps.
 */

import type { StorageScopeBinding } from './provider-identity';

// =============================================================================
// Authority Proof
// =============================================================================

export interface ProviderAuthorityProof {
  readonly kind: 'handoff-bound-token' | 'signed-provider-message' | 'trusted-sidecar-session';
  readonly issuer: string;
  readonly algorithm: 'hmac-sha256' | 'ed25519' | 'trusted-session-mac';
  readonly issuedAt: number;
  readonly expiresAt?: number;
  readonly coveredFields: readonly ProviderInboundProofField[];
  readonly canonicalPayloadHash: string;
  readonly proofBytesOrRef: string;
}

// =============================================================================
// Inbound Proof Field
// =============================================================================

export type ProviderInboundProofField =
  | 'sourceKind'
  | 'originKind'
  | 'stableOriginId'
  | 'providerId'
  | 'providerKind'
  | 'providerRefId'
  | 'decisionId'
  | 'sessionId'
  | 'remoteSessionId'
  | 'remoteAuthorRef'
  | 'authorState'
  | 'correlationId'
  | 'causationIds'
  | 'provenanceRedactionPolicy'
  | 'provenancePayloadHash'
  | 'authorityRef'
  | 'storageScope'
  | 'roomId'
  | 'epoch'
  | 'providerEpoch'
  | 'updateId'
  | 'sequence'
  | 'payloadKind'
  | 'payloadHash'
  | 'rawBytesPolicy';

// =============================================================================
// Sync Update Provenance
// =============================================================================

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
export type SyncUpdateTrustStatus =
  | 'verified'
  | 'trustedLocalSystem'
  | 'unverified'
  | 'legacyRaw';
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
  readonly durableAuthorIdentity:
    | 'unknown'
    | 'opaque-subject-ref'
    | 'hmac-sha256-digest';
  readonly durableProviderIdentity:
    | 'unknown'
    | 'opaque-provider-ref'
    | 'hmac-sha256-digest';
  /**
   * Required when durable author/provider identity uses an HMAC digest. Without
   * a key, admission must keep authorship unknown instead of persisting raw
   * identity material or unkeyed hashes.
   */
  readonly redactionKeyId?: string;
  readonly proofMaterial: 'diagnostics-only' | 'drop';
}

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

export type LegacyRawUnknownSyncUpdateProvenance =
  SyncUpdateProvenanceBase<'legacyRawUnknown'> & {
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

// =============================================================================
// Inbound Update Envelope
// =============================================================================

export interface ProviderInboundUpdateEnvelope {
  readonly providerRefId: string;
  readonly authorityRef?: string;
  readonly storageScope: StorageScopeBinding;
  readonly decisionId: string;
  readonly sessionId: string;
  readonly providerEpoch: string;
  readonly updateId: string;
  readonly sequence?: bigint;
  readonly payloadKind: 'yrs-update-v1' | 'yrs-state-vector-diff' | 'provider-snapshot-fragment';
  readonly payloadHash: string;
  readonly payload: Uint8Array;
  readonly assetDependencies?: readonly ProviderInboundAssetDependency[];
  readonly authorityProof: ProviderAuthorityProof;
}

export interface ProviderInboundUpdateEnvelopeV2 extends ProviderInboundUpdateEnvelope {
  readonly schemaVersion: 'provider-inbound-update-v2';
  readonly provenance: SyncUpdateProvenance;
}

export type ProviderInboundUpdateEnvelopeAny =
  | ProviderInboundUpdateEnvelope
  | ProviderInboundUpdateEnvelopeV2;

// =============================================================================
// Provenance Classification And Validation Helpers
// =============================================================================

export const PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS = Object.freeze([
  'sourceKind',
  'originKind',
  'stableOriginId',
  'providerRefId',
  'storageScope',
  'authorityRef',
  'authorState',
  'provenanceRedactionPolicy',
  'provenancePayloadHash',
  'payloadHash',
  'updateId',
  'epoch',
] as const satisfies readonly ProviderInboundProofField[]);

export const PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS = Object.freeze([
  'remoteSessionId',
  'remoteAuthorRef',
  'correlationId',
  'causationIds',
] as const satisfies readonly ProviderInboundProofField[]);

export const DEFAULT_PROVENANCE_REDACTION_POLICY: ProvenanceRedactionPolicy = Object.freeze({
  schemaVersion: 'provenance-redaction-policy-v1',
  mode: 'diagnostic-only',
  durableAuthorIdentity: 'unknown',
  durableProviderIdentity: 'unknown',
  proofMaterial: 'diagnostics-only',
});

export type SyncUpdateValidationReason =
  | 'payloadHashMismatch'
  | 'missingProof'
  | 'partialCoverage'
  | 'provenancePayloadHashMismatch'
  | 'missingStableOrigin'
  | 'unverifiedProvenance'
  | 'unknownAuthor'
  | 'mixedAuthors'
  | 'missingRedactionKey'
  | 'invalidCapturePolicy';

export type SyncUpdateValidationSubreason =
  | 'payloadHashMismatch'
  | 'missingProof'
  | 'partialCoverage'
  | 'provenancePayloadHashMismatch'
  | 'stableOriginMismatch'
  | 'unverifiedTrust'
  | 'unknownAuthor'
  | 'mixedAuthors'
  | 'missingRedactionKey'
  | 'localAuthorInferenceNotAllowed';

export interface SyncUpdateValidationDiagnostic {
  readonly reason: SyncUpdateValidationReason;
  readonly subreason?: SyncUpdateValidationSubreason;
  readonly field?: ProviderInboundProofField | 'capturePolicy' | 'author';
  readonly message: string;
}

export interface SyncUpdateValidationResult {
  readonly ok: boolean;
  readonly diagnostics: readonly SyncUpdateValidationDiagnostic[];
}

export interface ProviderInboundUpdateValidationOptions {
  readonly expectedPayloadHash?: string;
  readonly requireProofCoverage?: boolean;
}

export interface LegacyProviderClassificationOptions {
  readonly sourceKind?: 'providerReplay' | 'legacyRawUnknown';
  readonly stableOriginId?: string;
  readonly providerId?: string;
  readonly providerKind?: string;
}

export interface LegacyRawUpdateClassificationOptions {
  readonly payloadHash: string;
  readonly updateId?: string;
  readonly sourceKind?: 'legacyRawUnknown';
  readonly replay?: boolean;
  readonly system?: boolean;
}

export function isProviderInboundUpdateEnvelopeV2(
  envelope: ProviderInboundUpdateEnvelopeAny,
): envelope is ProviderInboundUpdateEnvelopeV2 {
  return (
    (envelope as { readonly schemaVersion?: unknown }).schemaVersion ===
    'provider-inbound-update-v2'
  );
}

export function classifyLegacyProviderInboundUpdate(
  envelope: ProviderInboundUpdateEnvelope,
  options: LegacyProviderClassificationOptions = {},
): ProviderReplaySyncUpdateProvenance | LegacyRawUnknownSyncUpdateProvenance {
  const sourceKind = options.sourceKind ?? 'providerReplay';
  const stableOriginId = options.stableOriginId ?? options.providerId;
  const base = {
    schemaVersion: 'sync-update-provenance-v1' as const,
    updateIdentity: {
      originKind: 'provider' as const,
      stableOriginId,
      providerId: options.providerId ?? stableOriginId,
      providerKind: options.providerKind,
      providerRefId: envelope.providerRefId,
      storageScope: envelope.storageScope,
      authorityRef: envelope.authorityRef,
      epoch: envelope.providerEpoch,
      updateId: envelope.updateId,
      sequence: envelope.sequence,
      payloadHash: envelope.payloadHash,
    },
    trust: {
      status: 'legacyRaw' as const,
      authorityRef: envelope.authorityRef,
      proofKind: envelope.authorityProof.kind,
      proofCoverage: envelope.authorityProof.coveredFields,
      issuer: envelope.authorityProof.issuer,
    },
    author: { kind: 'unknown' as const, reason: 'providerReplay' as const },
    replay: true as const,
    system: true as const,
    capturePolicy: 'excluded' as const,
    redaction: DEFAULT_PROVENANCE_REDACTION_POLICY,
  };

  if (sourceKind === 'providerReplay') {
    return {
      ...base,
      sourceKind,
      exclusionDiagnostic: {
        reason: 'providerReplay',
        message: 'V1 provider envelope is classified as provider replay without authorship.',
      },
    };
  }

  return {
    ...base,
    sourceKind,
    updateIdentity: { ...base.updateIdentity, originKind: 'legacyRaw' },
    author: { kind: 'unknown', reason: 'legacyRaw' },
    replay: false,
    system: false,
    trust: { ...base.trust, status: 'legacyRaw' },
    exclusionDiagnostic: {
      reason: 'legacyRawUnknown',
      subreason: 'rawUnclassified',
      message: 'V1 provider envelope was admitted through the legacy raw unknown adapter.',
    },
  };
}

export function classifyLegacyRawUpdate(
  options: LegacyRawUpdateClassificationOptions,
): LegacyRawUnknownSyncUpdateProvenance {
  return {
    schemaVersion: 'sync-update-provenance-v1',
    sourceKind: options.sourceKind ?? 'legacyRawUnknown',
    updateIdentity: {
      originKind: 'legacyRaw',
      updateId: options.updateId,
      payloadHash: options.payloadHash,
    },
    trust: { status: 'legacyRaw' },
    author: { kind: 'unknown', reason: 'legacyRaw' },
    replay: options.replay ?? false,
    system: options.system ?? false,
    capturePolicy: 'excluded',
    redaction: DEFAULT_PROVENANCE_REDACTION_POLICY,
    exclusionDiagnostic: {
      reason: 'legacyRawUnknown',
      subreason: 'rawUnclassified',
      message: 'Raw sync bytes have no authenticated provenance and cannot claim authorship.',
    },
  };
}

export function validateProviderInboundUpdateEnvelope(
  envelope: ProviderInboundUpdateEnvelopeAny,
  options: ProviderInboundUpdateValidationOptions = {},
): SyncUpdateValidationResult {
  if (!isProviderInboundUpdateEnvelopeV2(envelope)) {
    return validateSyncUpdateProvenance(classifyLegacyProviderInboundUpdate(envelope), {
      expectedPayloadHash: options.expectedPayloadHash,
    });
  }

  const diagnostics = [
    ...validatePayloadHash(envelope.payloadHash, envelope.provenance, options.expectedPayloadHash),
    ...validateProviderProofCoverage(envelope, options),
    ...validateSyncUpdateProvenance(envelope.provenance, {
      expectedPayloadHash: envelope.payloadHash,
    }).diagnostics,
  ];
  return { ok: diagnostics.length === 0, diagnostics };
}

export function validateSyncUpdateProvenance(
  provenance: SyncUpdateProvenance,
  options: { readonly expectedPayloadHash?: string } = {},
): SyncUpdateValidationResult {
  const diagnostics = validatePayloadHash(
    provenance.updateIdentity.payloadHash,
    provenance,
    options.expectedPayloadHash,
  );

  if (provenance.capturePolicy === 'commitEligible') {
    if (
      provenance.sourceKind !== 'providerLiveInbound' &&
      provenance.sourceKind !== 'collaborationLiveRemote'
    ) {
      diagnostics.push({
        reason: 'invalidCapturePolicy',
        field: 'capturePolicy',
        message: 'This sync source kind cannot be commit eligible.',
      });
    }
    if (provenance.trust.status !== 'verified') {
      diagnostics.push({
        reason: 'unverifiedProvenance',
        subreason: 'unverifiedTrust',
        message: 'Commit-eligible sync provenance must be verified.',
      });
    }
    if (provenance.author.kind !== 'singleRemote') {
      diagnostics.push({
        reason: provenance.author.kind === 'mixedRemote' ? 'mixedAuthors' : 'unknownAuthor',
        subreason:
          provenance.author.kind === 'mixedRemote'
            ? 'mixedAuthors'
            : 'localAuthorInferenceNotAllowed',
        field: 'author',
        message:
          'Commit-eligible sync provenance requires an explicit remote author; local state must not be inferred.',
      });
    }
    if (!provenance.updateIdentity.stableOriginId) {
      diagnostics.push({
        reason: 'missingStableOrigin',
        subreason: 'stableOriginMismatch',
        field: 'stableOriginId',
        message: 'Commit-eligible sync provenance requires a stable origin ID.',
      });
    }
    if (
      provenance.redaction.durableAuthorIdentity === 'hmac-sha256-digest' &&
      !provenance.redaction.redactionKeyId
    ) {
      diagnostics.push({
        reason: 'missingRedactionKey',
        subreason: 'missingRedactionKey',
        message: 'HMAC-redacted durable author identity requires a redaction key ID.',
      });
    }
  }

  return { ok: diagnostics.length === 0, diagnostics };
}

function validatePayloadHash(
  declaredPayloadHash: string,
  provenance: SyncUpdateProvenance,
  expectedPayloadHash?: string,
): SyncUpdateValidationDiagnostic[] {
  const diagnostics: SyncUpdateValidationDiagnostic[] = [];
  if (declaredPayloadHash !== provenance.updateIdentity.payloadHash) {
    diagnostics.push({
      reason: 'payloadHashMismatch',
      subreason: 'payloadHashMismatch',
      field: 'payloadHash',
      message: 'Envelope payload hash does not match provenance update identity payload hash.',
    });
  }
  if (expectedPayloadHash !== undefined && expectedPayloadHash !== declaredPayloadHash) {
    diagnostics.push({
      reason: 'payloadHashMismatch',
      subreason: 'payloadHashMismatch',
      field: 'payloadHash',
      message: 'Expected payload hash does not match declared payload hash.',
    });
  }
  return diagnostics;
}

function validateProviderProofCoverage(
  envelope: ProviderInboundUpdateEnvelopeV2,
  options: ProviderInboundUpdateValidationOptions,
): SyncUpdateValidationDiagnostic[] {
  if (options.requireProofCoverage === false) return [];
  if (!envelope.authorityProof) {
    return [
      {
        reason: 'missingProof',
        subreason: 'missingProof',
        message: 'Provider inbound V2 provenance requires an authority proof.',
      },
    ];
  }

  const required = new Set<ProviderInboundProofField>(PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS);
  const provenance = envelope.provenance;
  const identity = provenance.updateIdentity;
  if (identity.providerId) required.add('providerId');
  if (identity.providerKind) required.add('providerKind');
  if (identity.roomId) required.add('roomId');
  if (identity.sequence !== undefined) required.add('sequence');
  if (provenance.trust.status === 'verified' && provenance.author.kind === 'singleRemote') {
    for (const field of PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS) required.add(field);
  }

  const covered = new Set(envelope.authorityProof.coveredFields);
  const diagnostics: SyncUpdateValidationDiagnostic[] = [];
  for (const field of required) {
    if (!covered.has(field)) {
      diagnostics.push({
        reason: 'partialCoverage',
        subreason: 'partialCoverage',
        field,
        message: `Provider authority proof does not cover '${field}'.`,
      });
    }
  }

  const provenancePayloadHash = provenance.updateIdentity.provenancePayloadHash;
  if (!provenancePayloadHash || envelope.authorityProof.canonicalPayloadHash !== provenancePayloadHash) {
    diagnostics.push({
      reason: 'provenancePayloadHashMismatch',
      subreason: 'provenancePayloadHashMismatch',
      field: 'provenancePayloadHash',
      message: 'Authority proof canonical payload hash must match provenance payload hash.',
    });
  }

  return diagnostics;
}

// =============================================================================
// Inbound Asset Dependency
// =============================================================================

export interface ProviderInboundAssetDependency {
  readonly assetId: string;
  readonly contentFingerprint: string;
  readonly manifestFingerprint: string;
  readonly policyLabelRef?: string;
  readonly availabilityProofRef?: string;
}
