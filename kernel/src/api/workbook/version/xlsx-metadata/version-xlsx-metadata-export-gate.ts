import type {
  ObjectDigest,
  VersionDiagnosticPublicPayload,
  VersionHead,
  VersionResult,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { MogSdkError } from '../../../../errors';
import type { DocumentContext } from '../../../../context';
import type { VersionStoreProvider } from '../../../../document/version-store/provider';
import type { MogVersionMetadataAuthoritativeHeadIdentity } from './version-xlsx-metadata-export-authority';
import type { MogWorkbookVersionXlsxMetadata } from './xlsx-version-metadata';

const MOG_VERSION_METADATA_PART = 'customXml/mog-version-metadata.xml';
const METADATA_EXPORT_OPERATION = 'workbook.toXlsx';
const METADATA_EXPORT_BLOCKED_ISSUE_CODE = 'VERSION_XLSX_METADATA_EXPORT_BLOCKED';
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const OBJECT_DIGEST_RE = /^[0-9a-f]{64}$/;
const REF_REVISION_COUNTER_RE = /^(0|[1-9][0-9]*)$/;
export const MOG_VERSION_METADATA_REDACTION_POLICY = 'commit-document-and-object-digests-only';
export const REQUIRED_MOG_VERSION_METADATA_REDACTION_OMISSIONS = [
  'authors',
  'agentTraces',
  'rawWorkbookBytes',
  'credentials',
  'externalDataSecrets',
  'objectStoreNamespace',
  'principalScope',
] as const;

export type MogVersionMetadataExportBlockReason =
  | 'redaction-failed'
  | 'head-read-failed'
  | 'head-unverified'
  | 'stale-head'
  | 'commit-missing';

export interface MogVersionMetadataExportSinkAuthorization {
  readonly sidecarPart: typeof MOG_VERSION_METADATA_PART;
  readonly metadata: MogWorkbookVersionXlsxMetadata;
  readonly currentHead: MogVersionMetadataAuthoritativeHeadIdentity;
  readonly objectStoreAuthority: {
    readonly semanticChangeSetDigest: ObjectDigest;
    readonly snapshotRootDigest: ObjectDigest;
  };
  readonly redaction: {
    readonly diagnostics: 'none';
    readonly redacted: true;
  };
}

export interface MogVersionMetadataExportSink {
  readonly write: (
    xlsxBytes: Uint8Array,
    authorization: MogVersionMetadataExportSinkAuthorization,
  ) => Uint8Array;
}

export function createMogWorkbookVersionXlsxMetadata(
  ctx: DocumentContext,
  head: VersionResult<VersionHead>,
  authority?: {
    readonly semanticChangeSetDigest: ObjectDigest;
    readonly snapshotRootDigest: ObjectDigest;
  },
): MogWorkbookVersionXlsxMetadata {
  const workspace = optionalMetadataWorkspaceId(ctx);
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: new Date(ctx.clock.dateNow()).toISOString(),
    documentId: resolveVersionDocumentId(ctx),
    ...workspace,
    head: head.ok
      ? {
          commitId: head.value.id,
          ...(head.value.refName ? { refName: head.value.refName } : {}),
          ...(head.value.resolvedFrom ? { resolvedFrom: head.value.resolvedFrom } : {}),
          ...(head.value.refRevision ? { refRevision: head.value.refRevision } : {}),
          ...(authority
            ? {
                semanticChangeSetDigest: authority.semanticChangeSetDigest,
                snapshotRootDigest: authority.snapshotRootDigest,
              }
            : {}),
        }
      : null,
    diagnostics: head.ok ? [] : diagnosticsFromVersionError(head.error),
    redaction: {
      policy: MOG_VERSION_METADATA_REDACTION_POLICY,
      omitted: [
        ...REQUIRED_MOG_VERSION_METADATA_REDACTION_OMISSIONS,
        ...(workspace.workspaceId ? [] : ['workspaceId']),
      ],
    },
  };
}

export function hasVersionHeadFailureDiagnostics(
  error: Extract<VersionResult<VersionHead>, { readonly ok: false }>['error'],
): boolean {
  return diagnosticsFromVersionError(error).length > 0;
}

export function createMogVersionMetadataExportBlockedError(
  reason: MogVersionMetadataExportBlockReason,
): MogSdkError {
  const diagnostics = [mogVersionMetadataExportBlockedDiagnostic(reason)];
  return new MogSdkError(
    'EXPORT_ERROR',
    'workbook.toXlsx() cannot include Mog version metadata because the current version head, object-store authority, and redaction requirements were not proven.',
    {
      operation: METADATA_EXPORT_OPERATION,
      details: {
        issue: 'metadata-export-blocked',
        operation: METADATA_EXPORT_OPERATION,
        metadataIssue: reason,
        sidecarPart: MOG_VERSION_METADATA_PART,
        mutationGuarantee: 'no-write-attempted',
        diagnostics,
      },
      diagnostics: {
        domain: 'VERSION',
        issueCode: METADATA_EXPORT_BLOCKED_ISSUE_CODE,
        severity: 'error',
      },
    },
  );
}

function mogVersionMetadataExportBlockedDiagnostic(
  reason: MogVersionMetadataExportBlockReason,
): VersionStoreDiagnostic {
  return {
    issueCode: METADATA_EXPORT_BLOCKED_ISSUE_CODE,
    severity: 'error',
    recoverability: reason === 'stale-head' ? 'retry' : 'none',
    messageTemplateId: 'version.xlsx.metadataExportBlocked',
    safeMessage:
      'Mog version metadata export is blocked because the sidecar cannot be proven current and redacted.',
    payload: {
      operation: 'export',
      phase: 'export-sidecar',
      reason,
      sidecarPart: MOG_VERSION_METADATA_PART,
      redacted: true,
    },
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}

export function authorizeMetadataSinkWrite(
  metadata: MogWorkbookVersionXlsxMetadata,
  authority: {
    readonly semanticChangeSetDigest: ObjectDigest;
    readonly snapshotRootDigest: ObjectDigest;
    readonly currentHead: MogVersionMetadataAuthoritativeHeadIdentity;
  },
):
  | { readonly ok: true; readonly value: MogVersionMetadataExportSinkAuthorization }
  | { readonly ok: false; readonly reason: MogVersionMetadataExportBlockReason } {
  if (!hasVersionMetadataExportEnvelope(metadata)) {
    return { ok: false, reason: 'redaction-failed' };
  }
  if (!hasRedactedDiagnostics(metadata)) {
    return { ok: false, reason: 'redaction-failed' };
  }
  if (!metadata.head) {
    return { ok: false, reason: 'head-unverified' };
  }
  if (!hasVersionMetadataHeadAuthority(metadata.head)) {
    return { ok: false, reason: 'head-unverified' };
  }
  if (!metadataHeadIdentityMatchesExpected(metadata.head, authority.currentHead)) {
    return { ok: false, reason: 'stale-head' };
  }
  if (!hasVersionMetadataHeadObjectDigests(metadata.head)) {
    return { ok: false, reason: 'head-unverified' };
  }
  if (
    !objectDigestMatches(metadata.head.semanticChangeSetDigest, authority.semanticChangeSetDigest)
  ) {
    return { ok: false, reason: 'head-unverified' };
  }
  if (!objectDigestMatches(metadata.head.snapshotRootDigest, authority.snapshotRootDigest)) {
    return { ok: false, reason: 'head-unverified' };
  }
  if (!hasRequiredVersionMetadataRedaction(metadata)) {
    return { ok: false, reason: 'redaction-failed' };
  }
  return {
    ok: true,
    value: {
      sidecarPart: MOG_VERSION_METADATA_PART,
      metadata,
      currentHead: authority.currentHead,
      objectStoreAuthority: {
        semanticChangeSetDigest: authority.semanticChangeSetDigest,
        snapshotRootDigest: authority.snapshotRootDigest,
      },
      redaction: {
        diagnostics: 'none',
        redacted: true,
      },
    },
  };
}

function hasVersionMetadataExportEnvelope(metadata: MogWorkbookVersionXlsxMetadata): boolean {
  return (
    metadata.schemaVersion === 'mog.workbookVersion.xlsxMetadata.v1' &&
    isNonEmptyString(metadata.exportedAt) &&
    !Number.isNaN(Date.parse(metadata.exportedAt)) &&
    isNonEmptyString(metadata.documentId) &&
    (metadata.workspaceId === undefined || isNonEmptyString(metadata.workspaceId)) &&
    isRecord(metadata.redaction) &&
    typeof metadata.redaction.policy === 'string' &&
    Array.isArray(metadata.redaction.omitted)
  );
}

function hasRedactedDiagnostics(metadata: MogWorkbookVersionXlsxMetadata): boolean {
  return Array.isArray(metadata.diagnostics) && metadata.diagnostics.length === 0;
}

function hasVersionMetadataHeadAuthority(
  head: NonNullable<MogWorkbookVersionXlsxMetadata['head']>,
): boolean {
  return (
    isWorkbookCommitId(head.commitId) &&
    isNonEmptyString(head.refName) &&
    isNonEmptyString(head.resolvedFrom) &&
    isVersionRecordRevision(head.refRevision)
  );
}

function hasVersionMetadataHeadObjectDigests(
  head: NonNullable<MogWorkbookVersionXlsxMetadata['head']>,
): head is NonNullable<MogWorkbookVersionXlsxMetadata['head']> & {
  readonly semanticChangeSetDigest: ObjectDigest;
  readonly snapshotRootDigest: ObjectDigest;
} {
  return isObjectDigest(head.semanticChangeSetDigest) && isObjectDigest(head.snapshotRootDigest);
}

function hasRequiredVersionMetadataRedaction(metadata: MogWorkbookVersionXlsxMetadata): boolean {
  const redaction = metadata.redaction;
  return (
    redaction.policy === MOG_VERSION_METADATA_REDACTION_POLICY &&
    REQUIRED_MOG_VERSION_METADATA_REDACTION_OMISSIONS.every((item) =>
      redaction.omitted.includes(item),
    ) &&
    (metadata.workspaceId !== undefined || redaction.omitted.includes('workspaceId'))
  );
}

function metadataHeadIdentityMatchesExpected(
  actual: NonNullable<MogWorkbookVersionXlsxMetadata['head']>,
  expected: MogVersionMetadataAuthoritativeHeadIdentity,
): boolean {
  return (
    actual.commitId === expected.commitId &&
    optionalStringMatches(actual.refName, expected.refName) &&
    optionalStringMatches(actual.resolvedFrom, expected.resolvedFrom) &&
    versionRecordRevisionMatches(actual.refRevision, expected.refRevision)
  );
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

function isVersionRecordRevision(value: unknown): value is NonNullable<VersionHead['refRevision']> {
  return (
    isRecord(value) &&
    typeof value.value === 'string' &&
    ((value.kind === 'counter' && REF_REVISION_COUNTER_RE.test(value.value)) ||
      (value.kind === 'opaque' && value.value.length > 0))
  );
}

function isWorkbookCommitId(value: unknown): value is VersionHead['id'] {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value);
}

function isObjectDigest(value: unknown): value is ObjectDigest {
  return (
    isRecord(value) &&
    value.algorithm === 'sha256' &&
    typeof value.digest === 'string' &&
    OBJECT_DIGEST_RE.test(value.digest)
  );
}

function objectDigestMatches(left: ObjectDigest, right: ObjectDigest): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function resolveVersionDocumentId(ctx: DocumentContext): string {
  const runtime = ctx as {
    readonly versioning?: unknown;
    readonly versionStore?: unknown;
    readonly version?: unknown;
  };
  for (const services of [runtime.versioning, runtime.versionStore, runtime.version]) {
    if (!isRecord(services)) continue;
    const provider = services.provider;
    if (isRecord(provider)) {
      const scope = provider.documentScope;
      if (isRecord(scope) && typeof scope.documentId === 'string') return scope.documentId;
    }
  }
  return ctx.workbookLinkScope().requestingDocumentId;
}

function optionalMetadataWorkspaceId(ctx: DocumentContext): { readonly workspaceId?: string } {
  const workspaceId = versionStoreProviderFromContext(ctx)?.documentScope.workspaceId;
  return workspaceId ? { workspaceId } : {};
}

function versionStoreProviderFromContext(ctx: DocumentContext): VersionStoreProvider | undefined {
  const runtime = ctx as {
    readonly versioning?: unknown;
    readonly versionStore?: unknown;
    readonly version?: unknown;
  };
  for (const services of [runtime.versioning, runtime.versionStore, runtime.version]) {
    if (!isRecord(services)) continue;
    if (isVersionStoreProvider(services.provider)) return services.provider;
  }
  return undefined;
}

function isVersionStoreProvider(value: unknown): value is VersionStoreProvider {
  return (
    isRecord(value) &&
    isRecord(value.documentScope) &&
    isRecord(value.accessContext) &&
    typeof value.readGraphRegistry === 'function' &&
    typeof value.openGraph === 'function'
  );
}

function diagnosticsFromVersionError(
  error: Extract<VersionResult<VersionHead>, { readonly ok: false }>['error'],
): readonly VersionDiagnosticPublicPayload[] {
  return 'diagnostics' in error && Array.isArray(error.diagnostics)
    ? error.diagnostics.map(diagnosticPublicPayload)
    : [];
}

function diagnosticPublicPayload(value: unknown): VersionDiagnosticPublicPayload {
  if (!isRecord(value)) return {};
  const payload: Record<string, string | number | boolean | null> = {};
  for (const key of ['code', 'severity', 'message', 'dependency']) {
    const field = value[key];
    if (isPublicPrimitive(field)) payload[key] = field;
  }
  return payload;
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
