import type { ImportDiagnosticDto } from '@mog/types-data/data/diagnostics';

export type MogWorkbookVersionXlsxMetadataSchemaVersion = 'mog.workbookVersion.xlsxMetadata.v1';

export type MogWorkbookVersionXlsxMetadataPart = 'customXml/mog-version-metadata.xml';

export type MogWorkbookVersionXlsxMetadataRedactionPolicy =
  | 'commit-and-document-only'
  | 'commit-document-and-object-digests-only';

export type MogWorkbookVersionXlsxMetadataTrustStatus =
  | 'absent'
  | 'trusted'
  | 'trusted-stale-base'
  | 'untrusted';

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

export type MogWorkbookVersionXlsxCommitId = `commit:sha256:${string}` & {
  readonly __brand?: 'MogWorkbookVersionXlsxCommitId';
};

export interface MogWorkbookVersionXlsxObjectDigest {
  readonly algorithm: 'sha256';
  readonly digest: string;
  readonly byteLength?: number;
}

export type MogWorkbookVersionXlsxRefRevision =
  | {
      readonly kind: 'counter';
      readonly value: string;
    }
  | {
      readonly kind: 'opaque';
      readonly value: string;
    };

export type MogWorkbookVersionXlsxDiagnosticPublicPayload = Readonly<
  Record<string, string | number | boolean | null>
>;

export type Vc10XlsxInteropDiagnosticCode =
  | 'VC10_XLSX_METADATA_TRUST_ABSENT'
  | 'VC10_XLSX_METADATA_TRUSTED'
  | 'VC10_XLSX_METADATA_UNTRUSTED'
  | 'VC10_XLSX_EXTERNAL_CHANGE_BRANCH_RECORDED'
  | 'VC10_XLSX_EXTERNAL_CHANGE_BRANCH_BLOCKED';

export type Vc10XlsxInteropDiagnosticPhase =
  | 'export-sidecar'
  | 'import-root'
  | 'metadata-trust'
  | 'external-change-branch';

export type Vc10XlsxInteropDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface Vc10XlsxInteropDiagnostic {
  readonly diagnosticId: string;
  readonly code: Vc10XlsxInteropDiagnosticCode | (string & {});
  readonly severity: Vc10XlsxInteropDiagnosticSeverity;
  readonly phase: Vc10XlsxInteropDiagnosticPhase;
  readonly message: string;
  readonly redacted: true;
  readonly payload?: MogWorkbookVersionXlsxDiagnosticPublicPayload;
}

export interface MogWorkbookVersionXlsxMetadataHead {
  readonly commitId: MogWorkbookVersionXlsxCommitId;
  readonly refName?: string;
  readonly resolvedFrom?: string;
  readonly refRevision?: MogWorkbookVersionXlsxRefRevision;
  readonly semanticChangeSetDigest?: MogWorkbookVersionXlsxObjectDigest;
  readonly snapshotRootDigest?: MogWorkbookVersionXlsxObjectDigest;
}

export interface MogWorkbookVersionXlsxMetadata {
  readonly schemaVersion: MogWorkbookVersionXlsxMetadataSchemaVersion;
  readonly exportedAt: string;
  readonly documentId: string;
  readonly workspaceId?: string;
  readonly head: MogWorkbookVersionXlsxMetadataHead | null;
  readonly diagnostics: readonly MogWorkbookVersionXlsxDiagnosticPublicPayload[];
  readonly redaction: {
    readonly policy: MogWorkbookVersionXlsxMetadataRedactionPolicy;
    readonly omitted: readonly string[];
  };
}

export type MogWorkbookVersionXlsxMetadataTrustSummary =
  | {
      readonly status: Extract<MogWorkbookVersionXlsxMetadataTrustStatus, 'absent'>;
      readonly sidecarPart: MogWorkbookVersionXlsxMetadataPart;
    }
  | {
      readonly status: Extract<MogWorkbookVersionXlsxMetadataTrustStatus, 'trusted'>;
      readonly sidecarPart: MogWorkbookVersionXlsxMetadataPart;
      readonly redacted: true;
    }
  | {
      readonly status: Extract<MogWorkbookVersionXlsxMetadataTrustStatus, 'trusted-stale-base'>;
      readonly sidecarPart: MogWorkbookVersionXlsxMetadataPart;
      readonly redacted: true;
    }
  | {
      readonly status: Extract<MogWorkbookVersionXlsxMetadataTrustStatus, 'untrusted'>;
      readonly sidecarPart: MogWorkbookVersionXlsxMetadataPart;
      readonly reason: MogWorkbookVersionXlsxMetadataTrustReason;
      readonly redacted: true;
    };

export type MogWorkbookVersionXlsxMetadataExpectedHead = MogWorkbookVersionXlsxMetadataHead;

export interface MogWorkbookVersionXlsxMetadataTrustContext {
  readonly expectedDocumentId: string;
  readonly expectedWorkspaceId?: string;
  readonly expectedHead?: MogWorkbookVersionXlsxMetadataExpectedHead;
}

export type MogWorkbookVersionXlsxMetadataTrustResult =
  | {
      readonly status: Extract<MogWorkbookVersionXlsxMetadataTrustStatus, 'absent'>;
      readonly trust: Extract<MogWorkbookVersionXlsxMetadataTrustSummary, { status: 'absent' }>;
      readonly diagnostics: readonly ImportDiagnosticDto[];
    }
  | {
      readonly status: Extract<MogWorkbookVersionXlsxMetadataTrustStatus, 'trusted'>;
      readonly metadata: MogWorkbookVersionXlsxMetadata;
      readonly trust: Extract<MogWorkbookVersionXlsxMetadataTrustSummary, { status: 'trusted' }>;
      readonly diagnostics: readonly ImportDiagnosticDto[];
    }
  | {
      readonly status: Extract<MogWorkbookVersionXlsxMetadataTrustStatus, 'trusted-stale-base'>;
      readonly metadata: MogWorkbookVersionXlsxMetadata;
      readonly trust: Extract<
        MogWorkbookVersionXlsxMetadataTrustSummary,
        { status: 'trusted-stale-base' }
      >;
      readonly diagnostics: readonly ImportDiagnosticDto[];
    }
  | {
      readonly status: Extract<MogWorkbookVersionXlsxMetadataTrustStatus, 'untrusted'>;
      readonly reason: MogWorkbookVersionXlsxMetadataTrustReason;
      readonly metadata?: MogWorkbookVersionXlsxMetadata;
      readonly trust: Extract<MogWorkbookVersionXlsxMetadataTrustSummary, { status: 'untrusted' }>;
      readonly diagnostics: readonly ImportDiagnosticDto[];
    };

export type MogWorkbookVersionXlsxImportRootSource =
  | {
      readonly sourceType: 'bytes';
      readonly byteLength: number;
    }
  | {
      readonly sourceType: 'path';
      readonly pathRedacted: true;
    };

export interface MogWorkbookVersionXlsxImportRootProvenance {
  readonly kind: 'xlsx';
  readonly source: MogWorkbookVersionXlsxImportRootSource;
  readonly diagnostics: readonly ImportDiagnosticDto[];
  readonly versionMetadataTrust?: MogWorkbookVersionXlsxMetadataTrustSummary;
}

export type XlsxVersionImportRootProvenance = MogWorkbookVersionXlsxImportRootProvenance;

export type XlsxExternalChangeBranchRecordSchemaVersion = 1;

export type XlsxExternalChangeBranchStatus = 'created' | 'not-needed' | 'blocked' | 'failed';

export type XlsxExternalChangeBranchReason =
  | 'external-workbook-changed'
  | 'metadata-absent'
  | 'metadata-untrusted'
  | 'import-root-unverified'
  | 'branch-write-failed';

export interface XlsxExternalChangeBranchRecord {
  readonly schemaVersion: XlsxExternalChangeBranchRecordSchemaVersion;
  readonly recordKind: 'xlsx-external-change-branch';
  readonly branchRecordId: string;
  readonly documentId: string;
  readonly status: XlsxExternalChangeBranchStatus;
  readonly reason: XlsxExternalChangeBranchReason;
  readonly importRoot: XlsxVersionImportRootProvenance;
  readonly baseCommitId?: MogWorkbookVersionXlsxCommitId;
  readonly branchName?: string;
  readonly branchCommitId?: MogWorkbookVersionXlsxCommitId;
  readonly recordedAt: string;
  readonly sourcePackageDigest?: MogWorkbookVersionXlsxObjectDigest;
  readonly externalChangeDigest?: MogWorkbookVersionXlsxObjectDigest;
  readonly versionMetadataTrust: MogWorkbookVersionXlsxMetadataTrustSummary;
  readonly diagnostics: readonly Vc10XlsxInteropDiagnostic[];
  readonly redaction: {
    readonly policy: MogWorkbookVersionXlsxMetadataRedactionPolicy;
    readonly omitted: readonly string[];
    readonly sourcePathRedacted: true;
  };
}

export interface WorkbookXlsxExportOptions {
  /**
   * Internal import/export verification mode that disables imported
   * RoundTripContext preservation so corpus gates can prove modeled facts do
   * not depend on stale source package bytes.
   */
  readonly contextStripped?: boolean;

  /**
   * Controls Mog-owned version metadata sidecar export.
   *
   * Default export omits Mog version metadata. `include` writes a redacted
   * package sidecar containing document identity and the current version head.
   */
  readonly versionMetadata?: 'include' | 'omit';
}
