/**
 * Inbound update types
 *
 * Types for updates arriving from remote storage providers into the
 * kernel. Covers authority proofs, update envelopes, and asset deps.
 */

import {
  PROVIDER_AUTHORITY_CANONICAL_PAYLOAD_CANONICALIZATION,
  PROVIDER_AUTHORITY_CANONICAL_PAYLOAD_SCHEMA_VERSION,
  isProviderAuthorityProofV2,
  providerAuthorityProofAudienceKinds,
  providerAuthorityProofCanonicalPayloadHash,
  providerAuthorityProofCanonicalPayloadHashAlgorithm,
  providerAuthorityProofCoveredFields,
  providerAuthorityProofSchemaVersion,
} from './inbound-proof';
import { isProviderInboundUpdateEnvelopeV2 } from './inbound-updates-envelope';
import { requiredProviderInboundV2ProofFields } from './inbound-updates-proof-fields';
import { DEFAULT_PROVENANCE_REDACTION_POLICY } from './inbound-updates-provenance';
import type {
  ProviderAuthorityCanonicalPayloadHashAlgorithm,
  ProviderAuthorityProof,
  ProviderAuthorityProofAudienceKind,
  ProviderAuthorityProofSchemaVersion,
  ProviderInboundProofField,
} from './inbound-proof';
import type {
  ProviderInboundUpdateEnvelope,
  ProviderInboundUpdateEnvelopeAny,
  ProviderInboundUpdateEnvelopeV2,
} from './inbound-updates-envelope';
import type {
  LegacyRawUnknownSyncUpdateProvenance,
  ProvenanceRedactionPolicy,
  ProviderReplaySyncUpdateProvenance,
  RedactedAgentRef,
  RedactedRemoteAuthorRef,
  SyncUpdateAuthorState,
  SyncUpdateCapturePolicy,
  SyncUpdateExclusionReason,
  SyncUpdateOriginKind,
  SyncUpdateProvenance,
  SyncUpdateSourceKind,
  SyncUpdateTrustStatus,
} from './inbound-updates-provenance';
import type { StorageScopeBinding } from './provider-identity';

export * from './inbound-proof';
export * from './inbound-updates-envelope';
export * from './inbound-updates-proof-fields';
export * from './inbound-updates-provenance';

// =============================================================================
// Provenance Classification And Validation Helpers
// =============================================================================

export type SyncUpdateValidationReason =
  | 'payloadHashMismatch'
  | 'missingProof'
  | 'partialCoverage'
  | 'invalidProofContract'
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
  | 'missingProofAudience'
  | 'canonicalPayloadHashMismatch'
  | 'canonicalPayloadCoverageMismatch'
  | 'unsupportedCanonicalPayload'
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

export interface ProviderInboundUpdateDiagnosticEvidenceOptions extends ProviderInboundUpdateValidationOptions {
  readonly legacyClassification?: LegacyProviderClassificationOptions;
}

export type SyncUpdateDiagnosticEvidenceEnvelopeVersion =
  | 'provenance-only'
  | 'provider-inbound-update-v1'
  | 'provider-inbound-update-v2';

export interface SyncUpdateDiagnosticEvidenceDiagnostic {
  readonly reason: SyncUpdateValidationReason;
  readonly subreason?: SyncUpdateValidationSubreason;
  readonly field?: ProviderInboundProofField | 'capturePolicy' | 'author';
}

export interface SyncUpdateDiagnosticEvidenceAdmission {
  readonly status: 'accepted' | 'rejected';
  readonly diagnosticCount: number;
  readonly diagnostics: readonly SyncUpdateDiagnosticEvidenceDiagnostic[];
  readonly exclusionReason?: SyncUpdateExclusionReason;
  readonly exclusionSubreason?: string;
}

export interface SyncUpdateDiagnosticEvidenceIdentity {
  readonly originKind: SyncUpdateOriginKind;
  readonly hasStableOriginId: boolean;
  readonly hasProviderId: boolean;
  readonly providerKind?: string;
  readonly hasProviderRefId: boolean;
  readonly storageScopeKind?: StorageScopeBinding['kind'];
  readonly hasRoomId: boolean;
  readonly hasAuthorityRef: boolean;
  readonly hasEpoch: boolean;
  readonly hasUpdateId: boolean;
  readonly hasSequence: boolean;
  readonly hasPayloadHash: boolean;
  readonly hasProvenancePayloadHash: boolean;
}

export interface SyncUpdateDiagnosticEvidenceTrust {
  readonly status: SyncUpdateTrustStatus;
  readonly hasAuthorityRef: boolean;
  readonly proofKind?: ProviderAuthorityProof['kind'];
  readonly proofSchemaVersion?: ProviderAuthorityProofSchemaVersion;
  readonly proofAudienceKinds: readonly ProviderAuthorityProofAudienceKind[];
  readonly canonicalPayloadHashAlgorithm?: ProviderAuthorityCanonicalPayloadHashAlgorithm;
  readonly proofCoverage: readonly ProviderInboundProofField[];
  readonly hasIssuer: boolean;
  readonly hasVerifiedAt: boolean;
}

export type SyncUpdateDiagnosticEvidenceAuthor =
  | {
      readonly kind: 'singleRemote';
      readonly remoteRefKind: RedactedRemoteAuthorRef['kind'];
      readonly remoteRefKeyIdPresent: boolean;
    }
  | {
      readonly kind: 'mixedRemote';
      readonly participantCount?: number;
      readonly reason: Extract<SyncUpdateAuthorState, { readonly kind: 'mixedRemote' }>['reason'];
    }
  | {
      readonly kind: 'unknown';
      readonly reason: Extract<SyncUpdateAuthorState, { readonly kind: 'unknown' }>['reason'];
    }
  | {
      readonly kind: 'agent';
      readonly agentRefKind: RedactedAgentRef['kind'];
      readonly agentRefKeyIdPresent: boolean;
    }
  | {
      readonly kind: 'system';
      readonly systemRef: Extract<SyncUpdateAuthorState, { readonly kind: 'system' }>['systemRef'];
    };

export interface SyncUpdateDiagnosticEvidenceRedaction {
  readonly mode: ProvenanceRedactionPolicy['mode'];
  readonly durableAuthorIdentity: ProvenanceRedactionPolicy['durableAuthorIdentity'];
  readonly durableProviderIdentity: ProvenanceRedactionPolicy['durableProviderIdentity'];
  readonly redactionKeyIdPresent: boolean;
  readonly proofMaterial: ProvenanceRedactionPolicy['proofMaterial'];
  readonly proofMaterialExported: false;
}

export interface SyncUpdateDiagnosticEvidenceCorrelation {
  readonly hasRemoteSessionId: boolean;
  readonly hasCorrelationId: boolean;
  readonly causationIdCount: number;
}

export interface SyncUpdateDiagnosticEvidence {
  readonly schemaVersion: 'sync-update-diagnostic-evidence-v1';
  readonly envelopeVersion: SyncUpdateDiagnosticEvidenceEnvelopeVersion;
  readonly sourceKind: SyncUpdateSourceKind;
  readonly capturePolicy: SyncUpdateCapturePolicy;
  readonly replay: boolean;
  readonly system: boolean;
  readonly admission: SyncUpdateDiagnosticEvidenceAdmission;
  readonly identity: SyncUpdateDiagnosticEvidenceIdentity;
  readonly trust: SyncUpdateDiagnosticEvidenceTrust;
  readonly author: SyncUpdateDiagnosticEvidenceAuthor;
  readonly redaction: SyncUpdateDiagnosticEvidenceRedaction;
  readonly correlation: SyncUpdateDiagnosticEvidenceCorrelation;
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

export function exportSyncUpdateProvenanceEvidence(
  provenance: SyncUpdateProvenance,
  validation: SyncUpdateValidationResult = validateSyncUpdateProvenance(provenance),
): SyncUpdateDiagnosticEvidence {
  return buildSyncUpdateDiagnosticEvidence('provenance-only', provenance, validation);
}

export function exportProviderInboundUpdateAdmissionEvidence(
  envelope: ProviderInboundUpdateEnvelopeAny,
  options: ProviderInboundUpdateDiagnosticEvidenceOptions = {},
): SyncUpdateDiagnosticEvidence {
  if (!isProviderInboundUpdateEnvelopeV2(envelope)) {
    const provenance = classifyLegacyProviderInboundUpdate(envelope, options.legacyClassification);
    const validation = validateSyncUpdateProvenance(provenance, {
      expectedPayloadHash: options.expectedPayloadHash,
    });
    return buildSyncUpdateDiagnosticEvidence(
      'provider-inbound-update-v1',
      provenance,
      validation,
      envelope.authorityProof,
    );
  }

  return buildSyncUpdateDiagnosticEvidence(
    'provider-inbound-update-v2',
    envelope.provenance,
    validateProviderInboundUpdateEnvelope(envelope, options),
    envelope.authorityProof,
  );
}

function buildSyncUpdateDiagnosticEvidence(
  envelopeVersion: SyncUpdateDiagnosticEvidenceEnvelopeVersion,
  provenance: SyncUpdateProvenance,
  validation: SyncUpdateValidationResult,
  authorityProof?: ProviderAuthorityProof,
): SyncUpdateDiagnosticEvidence {
  const identity = provenance.updateIdentity;
  const proofAudienceKinds =
    authorityProof === undefined
      ? provenance.trust.proofAudienceKinds
      : providerAuthorityProofAudienceKinds(authorityProof);
  const canonicalPayloadHashAlgorithm =
    authorityProof === undefined
      ? provenance.trust.canonicalPayloadHashAlgorithm
      : providerAuthorityProofCanonicalPayloadHashAlgorithm(authorityProof);
  return {
    schemaVersion: 'sync-update-diagnostic-evidence-v1',
    envelopeVersion,
    sourceKind: provenance.sourceKind,
    capturePolicy: provenance.capturePolicy,
    replay: provenance.replay,
    system: provenance.system,
    admission: {
      status: validation.ok ? 'accepted' : 'rejected',
      diagnosticCount: validation.diagnostics.length,
      diagnostics: sortedEvidenceDiagnostics(validation.diagnostics),
      ...(provenance.exclusionDiagnostic === undefined
        ? {}
        : {
            exclusionReason: provenance.exclusionDiagnostic.reason,
            ...(provenance.exclusionDiagnostic.subreason === undefined
              ? {}
              : { exclusionSubreason: provenance.exclusionDiagnostic.subreason }),
          }),
    },
    identity: {
      originKind: identity.originKind,
      hasStableOriginId: identity.stableOriginId !== undefined,
      hasProviderId: identity.providerId !== undefined,
      ...(identity.providerKind === undefined ? {} : { providerKind: identity.providerKind }),
      hasProviderRefId: identity.providerRefId !== undefined,
      ...(identity.storageScope === undefined
        ? {}
        : { storageScopeKind: identity.storageScope.kind }),
      hasRoomId: identity.roomId !== undefined,
      hasAuthorityRef: identity.authorityRef !== undefined,
      hasEpoch: identity.epoch !== undefined,
      hasUpdateId: identity.updateId !== undefined,
      hasSequence: identity.sequence !== undefined,
      hasPayloadHash: identity.payloadHash.length > 0,
      hasProvenancePayloadHash: identity.provenancePayloadHash !== undefined,
    },
    trust: {
      status: provenance.trust.status,
      hasAuthorityRef: provenance.trust.authorityRef !== undefined,
      ...(provenance.trust.proofKind === undefined
        ? {}
        : { proofKind: provenance.trust.proofKind }),
      proofSchemaVersion:
        authorityProof === undefined
          ? provenance.trust.proofSchemaVersion
          : providerAuthorityProofSchemaVersion(authorityProof),
      proofAudienceKinds: sortedProofAudienceKinds(proofAudienceKinds),
      ...(canonicalPayloadHashAlgorithm === undefined ? {} : { canonicalPayloadHashAlgorithm }),
      proofCoverage: sortedProofCoverage(
        authorityProof === undefined
          ? provenance.trust.proofCoverage
          : providerAuthorityProofCoveredFields(authorityProof),
      ),
      hasIssuer: provenance.trust.issuer !== undefined,
      hasVerifiedAt: provenance.trust.verifiedAt !== undefined,
    },
    author: summarizeEvidenceAuthor(provenance.author),
    redaction: {
      mode: provenance.redaction.mode,
      durableAuthorIdentity: provenance.redaction.durableAuthorIdentity,
      durableProviderIdentity: provenance.redaction.durableProviderIdentity,
      redactionKeyIdPresent: provenance.redaction.redactionKeyId !== undefined,
      proofMaterial: provenance.redaction.proofMaterial,
      proofMaterialExported: false,
    },
    correlation: {
      hasRemoteSessionId: provenance.remoteSessionId !== undefined,
      hasCorrelationId: provenance.correlationId !== undefined,
      causationIdCount: provenance.causationIds?.length ?? 0,
    },
  };
}

function summarizeEvidenceAuthor(
  author: SyncUpdateAuthorState,
): SyncUpdateDiagnosticEvidenceAuthor {
  switch (author.kind) {
    case 'singleRemote':
      return {
        kind: author.kind,
        remoteRefKind: author.remoteAuthorRef.kind,
        remoteRefKeyIdPresent: author.remoteAuthorRef.keyId !== undefined,
      };
    case 'mixedRemote':
      return {
        kind: author.kind,
        ...(author.participantCount === undefined
          ? {}
          : { participantCount: author.participantCount }),
        reason: author.reason,
      };
    case 'unknown':
      return { kind: author.kind, reason: author.reason };
    case 'agent':
      return {
        kind: author.kind,
        agentRefKind: author.agentRef.kind,
        agentRefKeyIdPresent: author.agentRef.keyId !== undefined,
      };
    case 'system':
      return { kind: author.kind, systemRef: author.systemRef };
  }
}

function sortedProofCoverage(
  proofCoverage: readonly ProviderInboundProofField[] | undefined,
): readonly ProviderInboundProofField[] {
  return [...new Set(proofCoverage ?? [])].sort(compareStrings);
}

function sortedProofAudienceKinds(
  audienceKinds: readonly ProviderAuthorityProofAudienceKind[] | undefined,
): readonly ProviderAuthorityProofAudienceKind[] {
  return [...new Set(audienceKinds ?? [])].sort(compareStrings);
}

function sortedEvidenceDiagnostics(
  diagnostics: readonly SyncUpdateValidationDiagnostic[],
): readonly SyncUpdateDiagnosticEvidenceDiagnostic[] {
  return diagnostics
    .map((diagnostic) => ({
      reason: diagnostic.reason,
      ...(diagnostic.subreason === undefined ? {} : { subreason: diagnostic.subreason }),
      ...(diagnostic.field === undefined ? {} : { field: diagnostic.field }),
    }))
    .sort((left, right) =>
      compareStrings(
        `${left.reason}:${left.subreason ?? ''}:${left.field ?? ''}`,
        `${right.reason}:${right.subreason ?? ''}:${right.field ?? ''}`,
      ),
    );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const rightSet = new Set(right);
  return left.length === rightSet.size && left.every((value) => rightSet.has(value));
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

  const provenance = envelope.provenance;
  const required = requiredProviderInboundV2ProofFields(provenance);
  const covered = new Set(providerAuthorityProofCoveredFields(envelope.authorityProof));
  const diagnostics = validateProviderAuthorityProofV2Contract(envelope.authorityProof);
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
  if (
    !provenancePayloadHash ||
    providerAuthorityProofCanonicalPayloadHash(envelope.authorityProof) !== provenancePayloadHash
  ) {
    diagnostics.push({
      reason: 'provenancePayloadHashMismatch',
      subreason: 'provenancePayloadHashMismatch',
      field: 'provenancePayloadHash',
      message: 'Authority proof canonical payload hash must match provenance payload hash.',
    });
  }

  return diagnostics;
}

function validateProviderAuthorityProofV2Contract(
  proof: ProviderAuthorityProof,
): SyncUpdateValidationDiagnostic[] {
  if (!isProviderAuthorityProofV2(proof)) return [];
  const diagnostics: SyncUpdateValidationDiagnostic[] = [];
  if (!proof.audience.some((audience) => audience.kind === 'provider-inbound-update')) {
    diagnostics.push({
      reason: 'invalidProofContract',
      subreason: 'missingProofAudience',
      message: 'Provider authority proof V2 must include a provider-inbound-update audience.',
    });
  }
  if (
    proof.canonicalPayload.schemaVersion !== PROVIDER_AUTHORITY_CANONICAL_PAYLOAD_SCHEMA_VERSION ||
    proof.canonicalPayload.canonicalization !==
      PROVIDER_AUTHORITY_CANONICAL_PAYLOAD_CANONICALIZATION ||
    proof.canonicalPayload.algorithm !== 'sha256'
  ) {
    diagnostics.push({
      reason: 'invalidProofContract',
      subreason: 'unsupportedCanonicalPayload',
      message: 'Provider authority proof V2 canonical payload metadata is unsupported.',
    });
  }
  if (proof.canonicalPayloadHash !== proof.canonicalPayload.value) {
    diagnostics.push({
      reason: 'invalidProofContract',
      subreason: 'canonicalPayloadHashMismatch',
      field: 'provenancePayloadHash',
      message: 'Provider authority proof V2 canonical payload hash aliases disagree.',
    });
  }
  if (!sameStringSet(proof.coveredFields, proof.canonicalPayload.coveredFields)) {
    diagnostics.push({
      reason: 'invalidProofContract',
      subreason: 'canonicalPayloadCoverageMismatch',
      message: 'Provider authority proof V2 advertised fields must match canonical covered fields.',
    });
  }
  return diagnostics;
}
