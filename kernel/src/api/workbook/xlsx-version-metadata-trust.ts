import type { ImportDiagnosticDto } from '@mog-sdk/contracts/data/diagnostics';

import {
  MOG_VERSION_METADATA_REDACTION_POLICY,
  REQUIRED_MOG_VERSION_METADATA_REDACTION_OMISSIONS,
} from './version-xlsx-metadata-export-gate';
import {
  hasExpectedHeadAuthority,
  hasExpectedHeadObjectDigests,
  hasVersionMetadataHeadAuthority,
  hasVersionMetadataHeadObjectDigests,
  MOG_VERSION_METADATA_PART,
  metadataHeadIdentityMatchesExpected,
  objectDigestMatches,
  type MogWorkbookVersionXlsxMetadata,
  type MogWorkbookVersionXlsxMetadataExpectedHead,
} from './xlsx-version-metadata-schema';

export type MogWorkbookVersionXlsxMetadataTrustReason =
  | 'duplicate-sidecar'
  | 'sidecar-too-large'
  | 'unsupported-compression'
  | 'malformed-sidecar'
  | 'invalid-schema'
  | 'wrong-document'
  | 'wrong-workspace'
  | 'missing-head'
  | 'head-unverified'
  | 'head-mismatch'
  | 'missing-object-digests'
  | 'commit-missing'
  | 'object-digest-mismatch'
  | 'snapshot-root-mismatch';

export type MogWorkbookVersionXlsxMetadataTrustSummary =
  | {
      readonly status: 'absent';
      readonly sidecarPart: typeof MOG_VERSION_METADATA_PART;
    }
  | {
      readonly status: 'trusted';
      readonly sidecarPart: typeof MOG_VERSION_METADATA_PART;
      readonly redacted: true;
    }
  | {
      readonly status: 'trusted-stale-base';
      readonly sidecarPart: typeof MOG_VERSION_METADATA_PART;
      readonly redacted: true;
    }
  | {
      readonly status: 'untrusted';
      readonly sidecarPart: typeof MOG_VERSION_METADATA_PART;
      readonly reason: MogWorkbookVersionXlsxMetadataTrustReason;
      readonly redacted: true;
    };

export interface MogWorkbookVersionXlsxMetadataTrustContext {
  readonly expectedDocumentId: string;
  readonly expectedWorkspaceId?: string;
  readonly expectedHead?: MogWorkbookVersionXlsxMetadataExpectedHead;
  readonly currentHead?: MogWorkbookVersionXlsxMetadataExpectedHead;
  readonly expectedHeadFailureReason?: Extract<
    MogWorkbookVersionXlsxMetadataTrustReason,
    'head-unverified' | 'commit-missing'
  >;
}

export type MogWorkbookVersionXlsxMetadataTrustResult =
  | {
      readonly status: 'absent';
      readonly trust: Extract<MogWorkbookVersionXlsxMetadataTrustSummary, { status: 'absent' }>;
      readonly diagnostics: readonly ImportDiagnosticDto[];
    }
  | {
      readonly status: 'trusted';
      readonly metadata: MogWorkbookVersionXlsxMetadata;
      readonly trust: Extract<MogWorkbookVersionXlsxMetadataTrustSummary, { status: 'trusted' }>;
      readonly diagnostics: readonly ImportDiagnosticDto[];
    }
  | {
      readonly status: 'trusted-stale-base';
      readonly metadata: MogWorkbookVersionXlsxMetadata;
      readonly trust: Extract<
        MogWorkbookVersionXlsxMetadataTrustSummary,
        { status: 'trusted-stale-base' }
      >;
      readonly diagnostics: readonly ImportDiagnosticDto[];
    }
  | {
      readonly status: 'untrusted';
      readonly reason: MogWorkbookVersionXlsxMetadataTrustReason;
      readonly metadata?: MogWorkbookVersionXlsxMetadata;
      readonly trust: Extract<MogWorkbookVersionXlsxMetadataTrustSummary, { status: 'untrusted' }>;
      readonly diagnostics: readonly ImportDiagnosticDto[];
    };

export function hasRequiredVersionMetadataImportRedaction(
  metadata: MogWorkbookVersionXlsxMetadata,
): boolean {
  const redaction = metadata.redaction;
  return (
    metadata.diagnostics.length === 0 &&
    redaction.policy === MOG_VERSION_METADATA_REDACTION_POLICY &&
    REQUIRED_MOG_VERSION_METADATA_REDACTION_OMISSIONS.every((item) =>
      redaction.omitted.includes(item),
    ) &&
    (metadata.workspaceId !== undefined || redaction.omitted.includes('workspaceId'))
  );
}

export function validateMogWorkbookVersionXlsxMetadata(
  metadata: MogWorkbookVersionXlsxMetadata,
  context: MogWorkbookVersionXlsxMetadataTrustContext,
):
  | { readonly status: 'trusted' }
  | { readonly status: 'trusted-stale-base' }
  | { readonly status: 'untrusted'; readonly reason: MogWorkbookVersionXlsxMetadataTrustReason } {
  if (metadata.documentId !== context.expectedDocumentId) {
    return { status: 'untrusted', reason: 'wrong-document' };
  }
  if (metadata.workspaceId !== context.expectedWorkspaceId) {
    return { status: 'untrusted', reason: 'wrong-workspace' };
  }
  if (!metadata.head) {
    return { status: 'untrusted', reason: 'missing-head' };
  }
  if (!hasVersionMetadataHeadAuthority(metadata.head)) {
    return { status: 'untrusted', reason: 'head-unverified' };
  }
  if (!context.expectedHead) {
    return {
      status: 'untrusted',
      reason: context.expectedHeadFailureReason ?? 'head-unverified',
    };
  }
  if (!hasExpectedHeadAuthority(context.expectedHead)) {
    return { status: 'untrusted', reason: 'head-unverified' };
  }
  if (!metadataHeadIdentityMatchesExpected(metadata.head, context.expectedHead)) {
    return { status: 'untrusted', reason: 'head-mismatch' };
  }
  if (!hasVersionMetadataHeadObjectDigests(metadata.head)) {
    return { status: 'untrusted', reason: 'missing-object-digests' };
  }
  if (!hasExpectedHeadObjectDigests(context.expectedHead)) {
    return { status: 'untrusted', reason: 'head-unverified' };
  }
  if (
    !objectDigestMatches(
      metadata.head.semanticChangeSetDigest,
      context.expectedHead.semanticChangeSetDigest,
    )
  ) {
    return { status: 'untrusted', reason: 'object-digest-mismatch' };
  }
  if (
    !objectDigestMatches(metadata.head.snapshotRootDigest, context.expectedHead.snapshotRootDigest)
  ) {
    return { status: 'untrusted', reason: 'snapshot-root-mismatch' };
  }
  if (
    context.currentHead &&
    !metadataHeadIdentityMatchesExpected(metadata.head, context.currentHead)
  ) {
    return { status: 'trusted-stale-base' };
  }
  return { status: 'trusted' };
}

export function absentMogVersionMetadataResult(): Extract<
  MogWorkbookVersionXlsxMetadataTrustResult,
  { status: 'absent' }
> {
  return {
    status: 'absent',
    trust: {
      status: 'absent',
      sidecarPart: MOG_VERSION_METADATA_PART,
    },
    diagnostics: [],
  };
}

export function trustedMogVersionMetadataResult(
  metadata: MogWorkbookVersionXlsxMetadata,
): Extract<MogWorkbookVersionXlsxMetadataTrustResult, { status: 'trusted' }> {
  return {
    status: 'trusted',
    metadata,
    trust: {
      status: 'trusted',
      sidecarPart: MOG_VERSION_METADATA_PART,
      redacted: true,
    },
    diagnostics: [],
  };
}

export function trustedStaleBaseMogVersionMetadataResult(
  metadata: MogWorkbookVersionXlsxMetadata,
): Extract<MogWorkbookVersionXlsxMetadataTrustResult, { status: 'trusted-stale-base' }> {
  return {
    status: 'trusted-stale-base',
    metadata,
    trust: {
      status: 'trusted-stale-base',
      sidecarPart: MOG_VERSION_METADATA_PART,
      redacted: true,
    },
    diagnostics: [mogVersionMetadataStaleDiagnostic()],
  };
}

export function untrustedMogVersionMetadataResult(
  reason: MogWorkbookVersionXlsxMetadataTrustReason,
  metadata?: MogWorkbookVersionXlsxMetadata,
): Extract<MogWorkbookVersionXlsxMetadataTrustResult, { status: 'untrusted' }> {
  return {
    status: 'untrusted',
    reason,
    ...(metadata ? { metadata } : {}),
    trust: {
      status: 'untrusted',
      sidecarPart: MOG_VERSION_METADATA_PART,
      reason,
      redacted: true,
    },
    diagnostics: [mogVersionMetadataUntrustedDiagnostic(reason)],
  };
}

function mogVersionMetadataUntrustedDiagnostic(
  reason: MogWorkbookVersionXlsxMetadataTrustReason,
): ImportDiagnosticDto {
  return {
    id: `mog-version-metadata-${reason}`,
    code: 'mogVersionMetadataUntrusted',
    severity: 'warning',
    feature: 'workbook-metadata',
    recoverability: reason === 'malformed-sidecar' ? 'malformedDropped' : 'unsupportedDropped',
    message: 'Mog version metadata sidecar was ignored because it could not be trusted.',
    reason,
    details: {
      kind: 'mogVersionMetadataTrust',
      reason,
      sidecarPart: MOG_VERSION_METADATA_PART,
      trusted: false,
      redacted: true,
    },
    importPhases: ['parser'],
    firstImportPhase: 'parser',
  };
}

function mogVersionMetadataStaleDiagnostic(): ImportDiagnosticDto {
  return {
    id: 'mog-version-metadata-trusted-stale-base',
    code: 'mogVersionMetadataStale',
    severity: 'warning',
    feature: 'workbook-metadata',
    recoverability: 'mergeRequired',
    message:
      'Mog version metadata sidecar was trusted, but the current head advanced; external edits were routed to an external-change branch.',
    reason: 'trusted-stale-base',
    details: {
      kind: 'mogVersionMetadataTrust',
      reason: 'trusted-stale-base',
      sidecarPart: MOG_VERSION_METADATA_PART,
      trusted: true,
      staleBase: true,
      branchRouting: 'external-change',
      redacted: true,
    },
    importPhases: ['parser'],
    firstImportPhase: 'parser',
  };
}
