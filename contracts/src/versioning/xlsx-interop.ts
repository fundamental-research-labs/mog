import type { ImportDiagnosticDto } from '../data/diagnostics';

export const MOG_WORKBOOK_VERSION_XLSX_METADATA_SCHEMA_VERSION =
  'mog.workbookVersion.xlsxMetadata.v1';
export type MogWorkbookVersionXlsxMetadataSchemaVersion =
  typeof MOG_WORKBOOK_VERSION_XLSX_METADATA_SCHEMA_VERSION;

export const MOG_WORKBOOK_VERSION_XLSX_METADATA_PART =
  'customXml/mog-version-metadata.xml';
export type MogWorkbookVersionXlsxMetadataPart = typeof MOG_WORKBOOK_VERSION_XLSX_METADATA_PART;

export const MOG_WORKBOOK_VERSION_XLSX_METADATA_REDACTION_POLICIES = Object.freeze([
  'commit-and-document-only',
  'commit-document-and-object-digests-only',
] as const);
export type MogWorkbookVersionXlsxMetadataRedactionPolicy =
  (typeof MOG_WORKBOOK_VERSION_XLSX_METADATA_REDACTION_POLICIES)[number];

export const MOG_WORKBOOK_VERSION_XLSX_METADATA_TRUST_STATUSES = Object.freeze([
  'absent',
  'trusted',
  'untrusted',
] as const);
export type MogWorkbookVersionXlsxMetadataTrustStatus =
  (typeof MOG_WORKBOOK_VERSION_XLSX_METADATA_TRUST_STATUSES)[number];

export const MOG_WORKBOOK_VERSION_XLSX_METADATA_TRUST_REASONS = Object.freeze([
  'duplicate-sidecar',
  'sidecar-too-large',
  'unsupported-compression',
  'malformed-sidecar',
  'invalid-schema',
  'wrong-document',
  'missing-head',
  'head-unverified',
  'head-mismatch',
  'missing-object-digests',
  'commit-missing',
  'object-digest-mismatch',
  'snapshot-root-mismatch',
] as const);
export type MogWorkbookVersionXlsxMetadataTrustReason =
  (typeof MOG_WORKBOOK_VERSION_XLSX_METADATA_TRUST_REASONS)[number];

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
      readonly status: Extract<MogWorkbookVersionXlsxMetadataTrustStatus, 'untrusted'>;
      readonly sidecarPart: MogWorkbookVersionXlsxMetadataPart;
      readonly reason: MogWorkbookVersionXlsxMetadataTrustReason;
      readonly redacted: true;
    };

export type MogWorkbookVersionXlsxMetadataExpectedHead = MogWorkbookVersionXlsxMetadataHead;

export interface MogWorkbookVersionXlsxMetadataTrustContext {
  readonly expectedDocumentId: string;
  readonly expectedHead?: MogWorkbookVersionXlsxMetadataExpectedHead;
}

export type MogWorkbookVersionXlsxMetadataTrustResult =
  | {
      readonly status: Extract<MogWorkbookVersionXlsxMetadataTrustStatus, 'absent'>;
      readonly trust: Extract<
        MogWorkbookVersionXlsxMetadataTrustSummary,
        { status: 'absent' }
      >;
      readonly diagnostics: readonly ImportDiagnosticDto[];
    }
  | {
      readonly status: Extract<MogWorkbookVersionXlsxMetadataTrustStatus, 'trusted'>;
      readonly metadata: MogWorkbookVersionXlsxMetadata;
      readonly trust: Extract<
        MogWorkbookVersionXlsxMetadataTrustSummary,
        { status: 'trusted' }
      >;
      readonly diagnostics: readonly ImportDiagnosticDto[];
    }
  | {
      readonly status: Extract<MogWorkbookVersionXlsxMetadataTrustStatus, 'untrusted'>;
      readonly reason: MogWorkbookVersionXlsxMetadataTrustReason;
      readonly metadata?: MogWorkbookVersionXlsxMetadata;
      readonly trust: Extract<
        MogWorkbookVersionXlsxMetadataTrustSummary,
        { status: 'untrusted' }
      >;
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
