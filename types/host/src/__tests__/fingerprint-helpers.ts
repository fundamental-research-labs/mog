import { createHostCanonicalFingerprint } from '../fingerprints';
import type { HostCanonicalFingerprintProof } from '../fingerprints';
import type { VerifiedPrincipal } from '../identity';
import type {
  HostDocumentResourceContext,
  HostStorageAuthorizationIntent,
  HostDocumentRef,
  HostDocumentAuthorizationDetails,
} from '../kernel';

export const PRINCIPAL_COVERED_FIELDS = [
  'issuerId',
  'issuerKind',
  'subjectId',
  'tenantId',
  'workspaceId',
  'actorKind',
  'tags',
] as const;

export const RESOURCE_CONTEXT_COVERED_FIELDS = [
  'tenantId',
  'workspaceId',
  'documentId',
  'resolutionSource',
] as const;

export const STORAGE_INTENT_COVERED_FIELDS = [
  'openIntent',
  'durability',
  'rawBytesPolicy',
  'requestedConstraint',
  'providers',
] as const;

export const DOCUMENT_REF_COVERED_FIELDS = {
  document: ['kind', 'documentId'] as const,
  'source-handle': [
    'kind',
    'sourceHandleId',
    'issuanceId',
    'issuerHostId',
    'sourceKind',
    'sourceHostId',
    'sourceSessionId',
    'principalFingerprint',
    'resourceContext',
    'expiresAt',
    'singleUse',
  ] as const,
};

export const CONTENT_POLICY_COVERED_FIELDS = {
  'redacted-view': [
    'kind',
    'exportPathId',
    'format',
    'destination',
    'requestedExportSinkRefs',
    'workbookAccessProof',
  ] as const,
  'authorized-raw-snapshot': [
    'kind',
    'exportPathId',
    'format',
    'destination',
    'requestedExportSinkRefs',
    'rawMaterializationProof',
  ] as const,
};

export function createPrincipalFingerprintProof(
  principal: VerifiedPrincipal,
): HostCanonicalFingerprintProof {
  const payload = {
    issuerId: principal.issuer.issuerId,
    issuerKind: principal.issuer.issuerKind,
    subjectId: principal.subjectId,
    tenantId: principal.tenantId,
    workspaceId: principal.workspaceId,
    actorKind: principal.actorKind,
    tags: principal.tags,
  };
  return {
    version: 'v1',
    algorithm: 'sha256',
    digest: createHostCanonicalFingerprint(payload),
    canonicalization: 'jcs-rfc8785',
    coveredFields: [...PRINCIPAL_COVERED_FIELDS],
    issuedBy: 'test-fixture',
  };
}

export function createResourceContextFingerprintProof(
  ctx: HostDocumentResourceContext,
): HostCanonicalFingerprintProof {
  const payload = {
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    documentId: ctx.documentId,
    resolutionSource: ctx.resolutionSource,
  };
  return {
    version: 'v1',
    algorithm: 'sha256',
    digest: createHostCanonicalFingerprint(payload),
    canonicalization: 'jcs-rfc8785',
    coveredFields: [...RESOURCE_CONTEXT_COVERED_FIELDS],
    issuedBy: 'test-fixture',
  };
}

export function createStorageIntentFingerprintProof(
  intent: HostStorageAuthorizationIntent,
): HostCanonicalFingerprintProof {
  const payload = {
    openIntent: intent.openIntent,
    durability: intent.durability,
    rawBytesPolicy: intent.rawBytesPolicy,
    requestedConstraint: intent.requestedConstraint,
    providers: intent.providers,
  };
  return {
    version: 'v1',
    algorithm: 'sha256',
    digest: createHostCanonicalFingerprint(payload),
    canonicalization: 'jcs-rfc8785',
    coveredFields: [...STORAGE_INTENT_COVERED_FIELDS],
    issuedBy: 'test-fixture',
  };
}

export function createDocumentRefFingerprintProof(
  ref: HostDocumentRef,
): HostCanonicalFingerprintProof {
  const fields = DOCUMENT_REF_COVERED_FIELDS[ref.kind];
  const payload: Record<string, unknown> = { kind: ref.kind };
  if (ref.kind === 'document') {
    payload.documentId = ref.documentId;
  } else {
    payload.sourceHandleId = ref.sourceHandleId;
    payload.issuanceId = ref.issuance.issuanceId;
    payload.issuerHostId = ref.issuerHostId;
    payload.sourceKind = ref.sourceKind;
    payload.sourceHostId = ref.sourceHostId;
    payload.sourceSessionId = ref.sourceSessionId;
    payload.principalFingerprint = ref.principalFingerprint;
    payload.resourceContext = ref.resourceContext;
    payload.expiresAt = ref.expiresAt;
    payload.singleUse = ref.singleUse;
  }
  return {
    version: 'v1',
    algorithm: 'sha256',
    digest: createHostCanonicalFingerprint(payload),
    canonicalization: 'jcs-rfc8785',
    coveredFields: [...fields],
    issuedBy: 'test-fixture',
  };
}

export function createContentPolicyFingerprintProof(
  details: Extract<HostDocumentAuthorizationDetails, { readonly operation: 'export' }>,
): HostCanonicalFingerprintProof {
  const policyKind = details.contentPolicy.kind;
  const fields = CONTENT_POLICY_COVERED_FIELDS[policyKind];
  const payload: Record<string, unknown> = {
    kind: policyKind,
    exportPathId: details.exportPathId,
    format: details.format,
    destination: details.destination,
    requestedExportSinkRefs: details.requestedExportSinkRefs,
  };
  if (details.contentPolicy.kind === 'redacted-view') {
    payload.workbookAccessProof = details.contentPolicy.workbookAccessProof;
  } else {
    payload.rawMaterializationProof = details.contentPolicy.rawMaterializationProof;
  }
  return {
    version: 'v1',
    algorithm: 'sha256',
    digest: createHostCanonicalFingerprint(payload),
    canonicalization: 'jcs-rfc8785',
    coveredFields: [...fields],
    issuedBy: 'test-fixture',
  };
}
