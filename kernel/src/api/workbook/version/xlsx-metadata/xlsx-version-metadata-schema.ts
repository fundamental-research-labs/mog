import type {
  ObjectDigest,
  VersionDiagnosticPublicPayload,
  VersionHead,
} from '@mog-sdk/contracts/api';

export const MOG_VERSION_METADATA_PART = 'customXml/mog-version-metadata.xml';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const OBJECT_DIGEST_RE = /^[0-9a-f]{64}$/;
const REF_REVISION_COUNTER_RE = /^(0|[1-9][0-9]*)$/;

export interface MogWorkbookVersionXlsxMetadata {
  readonly schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1';
  readonly exportedAt: string;
  readonly documentId: string;
  readonly workspaceId?: string;
  readonly head: {
    readonly commitId: VersionHead['id'];
    readonly refName?: VersionHead['refName'];
    readonly resolvedFrom?: VersionHead['resolvedFrom'];
    readonly refRevision?: VersionHead['refRevision'];
    readonly semanticChangeSetDigest?: ObjectDigest;
    readonly snapshotRootDigest?: ObjectDigest;
  } | null;
  readonly diagnostics: readonly VersionDiagnosticPublicPayload[];
  readonly redaction: {
    readonly policy: 'commit-and-document-only' | 'commit-document-and-object-digests-only';
    readonly omitted: readonly string[];
  };
}

export interface MogWorkbookVersionXlsxMetadataExpectedHead {
  readonly commitId: VersionHead['id'];
  readonly refName?: VersionHead['refName'];
  readonly resolvedFrom?: VersionHead['resolvedFrom'];
  readonly refRevision?: VersionHead['refRevision'];
  readonly semanticChangeSetDigest?: ObjectDigest;
  readonly snapshotRootDigest?: ObjectDigest;
}

export function parseMogWorkbookVersionXlsxMetadata(
  value: unknown,
): MogWorkbookVersionXlsxMetadata | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== 'mog.workbookVersion.xlsxMetadata.v1') return null;
  if (
    typeof value.exportedAt !== 'string' ||
    !value.exportedAt ||
    Number.isNaN(Date.parse(value.exportedAt))
  ) {
    return null;
  }
  if (typeof value.documentId !== 'string' || !value.documentId) return null;
  if ('workspaceId' in value && (typeof value.workspaceId !== 'string' || !value.workspaceId)) {
    return null;
  }
  if (!isVersionMetadataHead(value.head)) return null;
  if (
    !Array.isArray(value.diagnostics) ||
    !value.diagnostics.every(isVersionDiagnosticPublicPayload)
  ) {
    return null;
  }
  if (!isVersionMetadataRedaction(value.redaction)) return null;
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: value.exportedAt,
    documentId: value.documentId,
    ...(typeof value.workspaceId === 'string' ? { workspaceId: value.workspaceId } : {}),
    head: value.head,
    diagnostics: value.diagnostics,
    redaction: value.redaction,
  };
}

export function metadataHeadIdentityMatchesExpected(
  actual: NonNullable<MogWorkbookVersionXlsxMetadata['head']>,
  expected: MogWorkbookVersionXlsxMetadataExpectedHead,
): boolean {
  return (
    actual.commitId === expected.commitId &&
    optionalStringMatches(actual.refName, expected.refName) &&
    optionalStringMatches(actual.resolvedFrom, expected.resolvedFrom) &&
    versionRecordRevisionMatches(actual.refRevision, expected.refRevision)
  );
}

export function hasVersionMetadataHeadObjectDigests(
  head: NonNullable<MogWorkbookVersionXlsxMetadata['head']>,
): head is NonNullable<MogWorkbookVersionXlsxMetadata['head']> & {
  readonly semanticChangeSetDigest: ObjectDigest;
  readonly snapshotRootDigest: ObjectDigest;
} {
  return isObjectDigest(head.semanticChangeSetDigest) && isObjectDigest(head.snapshotRootDigest);
}

export function hasVersionMetadataHeadAuthority(
  head: NonNullable<MogWorkbookVersionXlsxMetadata['head']>,
): boolean {
  return (
    isWorkbookCommitId(head.commitId) &&
    isNonEmptyString(head.refName) &&
    isNonEmptyString(head.resolvedFrom) &&
    isVersionRecordRevision(head.refRevision)
  );
}

export function hasExpectedHeadObjectDigests(
  head: MogWorkbookVersionXlsxMetadataExpectedHead,
): head is MogWorkbookVersionXlsxMetadataExpectedHead & {
  readonly semanticChangeSetDigest: ObjectDigest;
  readonly snapshotRootDigest: ObjectDigest;
} {
  return isObjectDigest(head.semanticChangeSetDigest) && isObjectDigest(head.snapshotRootDigest);
}

export function hasExpectedHeadAuthority(
  head: MogWorkbookVersionXlsxMetadataExpectedHead,
): boolean {
  return (
    isNonEmptyString(head.refName) &&
    isNonEmptyString(head.resolvedFrom) &&
    isVersionRecordRevision(head.refRevision)
  );
}

export function objectDigestMatches(left: ObjectDigest, right: ObjectDigest): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function isVersionMetadataHead(value: unknown): value is MogWorkbookVersionXlsxMetadata['head'] {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (!isWorkbookCommitId(value.commitId)) return false;
  if ('refName' in value && typeof value.refName !== 'string') return false;
  if ('resolvedFrom' in value && typeof value.resolvedFrom !== 'string') return false;
  if ('refRevision' in value && !isVersionRecordRevision(value.refRevision)) return false;
  if ('semanticChangeSetDigest' in value && !isObjectDigest(value.semanticChangeSetDigest)) {
    return false;
  }
  if ('snapshotRootDigest' in value && !isObjectDigest(value.snapshotRootDigest)) return false;
  return true;
}

function isVersionMetadataRedaction(
  value: unknown,
): value is MogWorkbookVersionXlsxMetadata['redaction'] {
  return (
    isRecord(value) &&
    (value.policy === 'commit-and-document-only' ||
      value.policy === 'commit-document-and-object-digests-only') &&
    Array.isArray(value.omitted) &&
    value.omitted.every((item) => typeof item === 'string')
  );
}

function isVersionDiagnosticPublicPayload(value: unknown): value is VersionDiagnosticPublicPayload {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isPublicPrimitive);
}

function isObjectDigest(value: unknown): value is ObjectDigest {
  return (
    isRecord(value) &&
    value.algorithm === 'sha256' &&
    typeof value.digest === 'string' &&
    OBJECT_DIGEST_RE.test(value.digest)
  );
}

function isVersionRecordRevision(value: unknown): value is NonNullable<VersionHead['refRevision']> {
  if (!isRecord(value) || typeof value.value !== 'string') return false;
  if (value.kind === 'counter') return REF_REVISION_COUNTER_RE.test(value.value);
  if (value.kind === 'opaque') return value.value.length > 0;
  return false;
}

function isWorkbookCommitId(value: unknown): value is VersionHead['id'] {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value);
}

function optionalStringMatches(left: string | undefined, right: string | undefined): boolean {
  return left === right;
}

function versionRecordRevisionMatches(
  left: VersionHead['refRevision'] | undefined,
  right: VersionHead['refRevision'] | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.kind === right.kind && left.value === right.value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPublicPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
