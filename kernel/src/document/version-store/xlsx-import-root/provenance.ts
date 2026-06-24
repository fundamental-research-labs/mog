import type { ImportDiagnosticDto } from '@mog-sdk/contracts/data/diagnostics';

import type { WorkbookCommitId } from '../object-digest';
import type { VersionRecordRevision } from '../registry';

const MOG_VERSION_METADATA_SIDECAR_PART = 'customXml/mog-version-metadata.xml';

export type XlsxVersionImportRootSource =
  | {
      readonly sourceType: 'bytes';
      readonly byteLength: number;
    }
  | {
      readonly sourceType: 'path';
      readonly pathRedacted: true;
    };

export type XlsxVersionMetadataHeadCandidate = {
  readonly documentId: string;
  readonly head: {
    readonly commitId: WorkbookCommitId | string;
    readonly refName?: string;
    readonly resolvedFrom?: string;
    readonly refRevision?:
      | VersionRecordRevision
      | { readonly kind: 'opaque'; readonly value: string };
    readonly semanticChangeSetDigest?: unknown;
    readonly snapshotRootDigest?: unknown;
  };
};

export type XlsxVersionImportRootProvenance = {
  readonly kind: 'xlsx';
  readonly source: XlsxVersionImportRootSource;
  readonly diagnostics: readonly ImportDiagnosticDto[];
  readonly versionMetadataTrust?: {
    readonly status: 'absent' | 'trusted' | 'trusted-stale-base' | 'untrusted';
    readonly sidecarPart: string;
    readonly reason?: string;
    readonly redacted?: true;
  };
  /**
   * Internal-only parsed sidecar identity used to verify a same-document reimport
   * against the selected version provider head. This must never be copied into
   * persisted semantic payloads; those payloads only receive redacted trust
   * summaries.
   */
  readonly versionMetadataHeadCandidate?: XlsxVersionMetadataHeadCandidate;
};

export type XlsxVersionMetadataTrustDowngradeReason =
  | 'wrong-document'
  | 'missing-head'
  | 'head-unverified'
  | 'missing-object-digests'
  | 'commit-missing'
  | 'object-digest-mismatch'
  | 'snapshot-root-mismatch';

export function trustedVersionMetadataTrust(
  provenance: XlsxVersionImportRootProvenance,
): NonNullable<XlsxVersionImportRootProvenance['versionMetadataTrust']> {
  const status =
    provenance.versionMetadataTrust?.status === 'trusted-stale-base'
      ? 'trusted-stale-base'
      : 'trusted';
  return {
    status,
    sidecarPart: provenance.versionMetadataTrust?.sidecarPart ?? MOG_VERSION_METADATA_SIDECAR_PART,
    redacted: true,
  };
}

export function trustedVersionMetadataHeadCandidate(
  provenance: XlsxVersionImportRootProvenance,
): XlsxVersionMetadataHeadCandidate | undefined {
  const trustStatus = provenance.versionMetadataTrust?.status;
  if (trustStatus !== 'trusted' && trustStatus !== 'trusted-stale-base') return undefined;
  return provenance.versionMetadataHeadCandidate;
}

export function untrustedImportRootProvenance(
  provenance: XlsxVersionImportRootProvenance,
  reason: XlsxVersionMetadataTrustDowngradeReason,
): XlsxVersionImportRootProvenance {
  const { versionMetadataHeadCandidate: _candidate, ...rest } = provenance;
  return {
    ...rest,
    diagnostics: redactedMetadataTrustDiagnostics(provenance.diagnostics, reason),
    versionMetadataTrust: {
      status: 'untrusted',
      sidecarPart:
        provenance.versionMetadataTrust?.sidecarPart ?? MOG_VERSION_METADATA_SIDECAR_PART,
      reason,
      redacted: true,
    },
  };
}

export function importRootProvenanceWithoutTrustedCandidate(
  provenance: XlsxVersionImportRootProvenance,
): XlsxVersionImportRootProvenance {
  const trustStatus = provenance.versionMetadataTrust?.status;
  if (trustStatus === 'trusted' || trustStatus === 'trusted-stale-base') {
    return untrustedImportRootProvenance(provenance, 'missing-head');
  }
  const { versionMetadataHeadCandidate: _candidate, ...rest } = provenance;
  return rest;
}

function redactedMetadataTrustDiagnostics(
  diagnostics: readonly ImportDiagnosticDto[],
  reason: XlsxVersionMetadataTrustDowngradeReason,
): readonly ImportDiagnosticDto[] {
  return [
    mogVersionMetadataUntrustedDiagnostic(reason),
    ...diagnostics.filter((diagnostic) => !isMogVersionMetadataTrustDiagnostic(diagnostic)),
  ];
}

function isMogVersionMetadataTrustDiagnostic(diagnostic: ImportDiagnosticDto): boolean {
  return (
    diagnostic.code === 'mogVersionMetadataUntrusted' ||
    diagnostic.code === 'mogVersionMetadataStale' ||
    (isRecord(diagnostic.details) && diagnostic.details.kind === 'mogVersionMetadataTrust')
  );
}

function mogVersionMetadataUntrustedDiagnostic(
  reason: XlsxVersionMetadataTrustDowngradeReason,
): ImportDiagnosticDto {
  return {
    id: `mog-version-metadata-${reason}`,
    code: 'mogVersionMetadataUntrusted',
    severity: 'warning',
    feature: 'workbook-metadata',
    recoverability: 'unsupportedDropped',
    message: 'Mog version metadata sidecar was ignored because it could not be trusted.',
    reason,
    details: {
      kind: 'mogVersionMetadataTrust',
      reason,
      sidecarPart: MOG_VERSION_METADATA_SIDECAR_PART,
      trusted: false,
      redacted: true,
    },
    importPhases: ['parser'],
    firstImportPhase: 'parser',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
