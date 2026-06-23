import type {
  ObjectDigest,
  VersionDiagnosticPublicPayload,
  VersionHead,
  VersionResult,
  WorkbookVersion,
  WorkbookXlsxExportOptions,
} from '@mog-sdk/contracts/api';
import type { ImportDiagnosticDto } from '@mog-sdk/contracts/data/diagnostics';
import type { DocumentContext } from '../../context';
import {
  namespaceForDocumentScope,
  type VersionStoreProvider,
} from '../../document/version-store/provider';

export const MOG_VERSION_METADATA_PART = 'customXml/mog-version-metadata.xml';
const MOG_VERSION_METADATA_MAX_BYTES = 64 * 1024;
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const OBJECT_DIGEST_RE = /^[0-9a-f]{64}$/;

export interface MogWorkbookVersionXlsxMetadata {
  readonly schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1';
  readonly exportedAt: string;
  readonly documentId: string;
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

interface CentralDirectoryEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly localHeaderOffset: number;
  readonly generalPurposeBitFlag: number;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
}

export type MogWorkbookVersionXlsxMetadataTrustReason =
  | 'duplicate-sidecar'
  | 'sidecar-too-large'
  | 'unsupported-compression'
  | 'malformed-sidecar'
  | 'invalid-schema'
  | 'wrong-document'
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
      readonly status: 'untrusted';
      readonly sidecarPart: typeof MOG_VERSION_METADATA_PART;
      readonly reason: MogWorkbookVersionXlsxMetadataTrustReason;
      readonly redacted: true;
    };

export interface MogWorkbookVersionXlsxMetadataExpectedHead {
  readonly commitId: VersionHead['id'];
  readonly refName?: VersionHead['refName'];
  readonly resolvedFrom?: VersionHead['resolvedFrom'];
  readonly refRevision?: VersionHead['refRevision'];
  readonly semanticChangeSetDigest?: ObjectDigest;
  readonly snapshotRootDigest?: ObjectDigest;
}

export interface MogWorkbookVersionXlsxMetadataTrustContext {
  readonly expectedDocumentId: string;
  readonly expectedHead?: MogWorkbookVersionXlsxMetadataExpectedHead;
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
      readonly status: 'untrusted';
      readonly reason: MogWorkbookVersionXlsxMetadataTrustReason;
      readonly metadata?: MogWorkbookVersionXlsxMetadata;
      readonly trust: Extract<MogWorkbookVersionXlsxMetadataTrustSummary, { status: 'untrusted' }>;
      readonly diagnostics: readonly ImportDiagnosticDto[];
    };

export function createMogWorkbookVersionXlsxMetadata(
  ctx: DocumentContext,
  head: VersionResult<VersionHead>,
  authority?: {
    readonly semanticChangeSetDigest: ObjectDigest;
    readonly snapshotRootDigest: ObjectDigest;
  },
): MogWorkbookVersionXlsxMetadata {
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: new Date(ctx.clock.dateNow()).toISOString(),
    documentId: resolveVersionDocumentId(ctx),
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
      policy: 'commit-document-and-object-digests-only',
      omitted: [
        'authors',
        'agentTraces',
        'rawWorkbookBytes',
        'credentials',
        'externalDataSecrets',
        'objectStoreNamespace',
        'workspaceId',
        'principalScope',
      ],
    },
  };
}

export function addMogVersionMetadataToXlsx(
  xlsxBytes: Uint8Array,
  metadata: MogWorkbookVersionXlsxMetadata,
): Uint8Array {
  return rewriteMogVersionMetadataInXlsx(xlsxBytes, metadata);
}

export function removeMogVersionMetadataFromXlsx(xlsxBytes: Uint8Array): Uint8Array {
  return rewriteMogVersionMetadataInXlsx(xlsxBytes, null);
}

export function readAndValidateMogVersionMetadataFromXlsx(
  xlsxBytes: Uint8Array,
  context: MogWorkbookVersionXlsxMetadataTrustContext,
): MogWorkbookVersionXlsxMetadataTrustResult {
  try {
    const metadataRead = readMogVersionMetadataXmlFromXlsx(xlsxBytes);
    if (metadataRead.status === 'absent') {
      return {
        status: 'absent',
        trust: {
          status: 'absent',
          sidecarPart: MOG_VERSION_METADATA_PART,
        },
        diagnostics: [],
      };
    }
    if (metadataRead.status === 'untrusted') {
      return untrustedMetadataResult(metadataRead.reason);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(unescapeXml(metadataJsonPayload(metadataRead.xml)));
    } catch {
      return untrustedMetadataResult('malformed-sidecar');
    }

    const metadata = parseMogWorkbookVersionXlsxMetadata(parsed);
    if (!metadata) return untrustedMetadataResult('invalid-schema');

    const validation = validateMogWorkbookVersionXlsxMetadata(metadata, context);
    if (validation.status === 'trusted') {
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

    return untrustedMetadataResult(validation.reason, metadata);
  } catch {
    return untrustedMetadataResult('malformed-sidecar');
  }
}

export function validateMogWorkbookVersionXlsxMetadata(
  metadata: MogWorkbookVersionXlsxMetadata,
  context: MogWorkbookVersionXlsxMetadataTrustContext,
):
  | { readonly status: 'trusted' }
  | { readonly status: 'untrusted'; readonly reason: MogWorkbookVersionXlsxMetadataTrustReason } {
  if (metadata.documentId !== context.expectedDocumentId) {
    return { status: 'untrusted', reason: 'wrong-document' };
  }
  if (!metadata.head) {
    return { status: 'untrusted', reason: 'missing-head' };
  }
  if (!hasVersionMetadataHeadAuthority(metadata.head)) {
    return { status: 'untrusted', reason: 'head-unverified' };
  }
  if (!context.expectedHead) {
    return { status: 'untrusted', reason: 'head-unverified' };
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
  return { status: 'trusted' };
}

function rewriteMogVersionMetadataInXlsx(
  xlsxBytes: Uint8Array,
  metadata: MogWorkbookVersionXlsxMetadata | null,
): Uint8Array {
  const view = new DataView(xlsxBytes.buffer, xlsxBytes.byteOffset, xlsxBytes.byteLength);
  const eocd = readEndOfCentralDirectory(view);
  const existingCentralDirectory = readCentralDirectoryEntries(xlsxBytes, view, eocd);
  const keptCentralDirectory = existingCentralDirectory.filter(
    (entry) => !isMogVersionMetadataPart(entry.name),
  );
  if (keptCentralDirectory.length === existingCentralDirectory.length && metadata === null) {
    return xlsxBytes;
  }

  const localFileParts: Uint8Array[] = [];
  const localHeaderOffsets = new Map<CentralDirectoryEntry, number>();
  let localOffset = 0;
  const archivePreamble = archivePreambleBytes(xlsxBytes, existingCentralDirectory);
  if (archivePreamble.byteLength > 0) {
    localFileParts.push(archivePreamble);
    localOffset += archivePreamble.byteLength;
  }
  for (const segment of localFileSegments(xlsxBytes, view, eocd, existingCentralDirectory)) {
    if (isMogVersionMetadataPart(segment.entry.name)) continue;
    localHeaderOffsets.set(segment.entry, localOffset);
    localFileParts.push(segment.bytes);
    localOffset += segment.bytes.byteLength;
  }

  const centralDirectory = keptCentralDirectory.map((entry) => {
    const newOffset = localHeaderOffsets.get(entry);
    if (newOffset === undefined) {
      throw new Error(`missing rewritten ZIP local file offset for ${entry.name}`);
    }
    return centralDirectoryHeaderWithLocalHeaderOffset(entry.bytes, newOffset);
  });

  if (metadata !== null) {
    const metadataBytes = encodeUtf8(versionMetadataXml(metadata));
    const metadataNameBytes = encodeUtf8(MOG_VERSION_METADATA_PART);
    const metadataCrc = crc32(metadataBytes);
    const metadataLocalHeaderOffset = localOffset;
    const metadataLocalFile = concatUint8Arrays([
      localFileHeader(metadataNameBytes, metadataBytes, metadataCrc),
      metadataBytes,
    ]);
    localFileParts.push(metadataLocalFile);
    localOffset += metadataLocalFile.byteLength;
    centralDirectory.push(
      centralDirectoryHeader(
        metadataNameBytes,
        metadataBytes,
        metadataCrc,
        metadataLocalHeaderOffset,
      ),
    );
  }

  const centralDirectoryOffset = localOffset;
  const centralDirectorySize = byteLength(centralDirectory);
  return concatUint8Arrays([
    ...localFileParts,
    ...centralDirectory,
    endOfCentralDirectory(
      centralDirectory.length,
      centralDirectorySize,
      centralDirectoryOffset,
      eocd.comment,
    ),
  ]);
}

export async function maybeAddMogVersionMetadataToXlsx(
  ctx: DocumentContext,
  version: Pick<WorkbookVersion, 'getHead'>,
  xlsxBytes: Uint8Array,
  options: WorkbookXlsxExportOptions | undefined,
): Promise<Uint8Array> {
  if (options?.versionMetadata !== 'include') return removeMogVersionMetadataFromXlsx(xlsxBytes);
  const head = await version.getHead();
  return addMogVersionMetadataToXlsx(
    xlsxBytes,
    createMogWorkbookVersionXlsxMetadata(
      ctx,
      head,
      await readCurrentHeadLocalObjectStoreAuthority(ctx, head),
    ),
  );
}

async function readCurrentHeadLocalObjectStoreAuthority(
  ctx: DocumentContext,
  head: VersionResult<VersionHead>,
): Promise<
  | {
      readonly semanticChangeSetDigest: ObjectDigest;
      readonly snapshotRootDigest: ObjectDigest;
    }
  | undefined
> {
  if (!head.ok) return undefined;
  const provider = versionStoreProviderFromContext(ctx);
  if (!provider) return undefined;

  try {
    const registry = await provider.readGraphRegistry();
    if (registry.status !== 'ok') return undefined;

    const graph = await provider.openGraph(
      namespaceForDocumentScope(provider.documentScope, registry.registry.currentGraphId),
      provider.accessContext,
    );
    const currentHead = await graph.readHead();
    if (currentHead.status !== 'success') return undefined;
    if (
      !metadataHeadIdentityMatchesExpected(
        {
          commitId: currentHead.head.id as VersionHead['id'],
          ...(currentHead.head.refName
            ? { refName: currentHead.head.refName as VersionHead['refName'] }
            : {}),
          ...(currentHead.head.resolvedFrom
            ? { resolvedFrom: currentHead.head.resolvedFrom as VersionHead['resolvedFrom'] }
            : {}),
          ...(currentHead.head.refRevision
            ? { refRevision: currentHead.head.refRevision }
            : {}),
        },
        {
          commitId: head.value.id,
          ...(head.value.refName ? { refName: head.value.refName } : {}),
          ...(head.value.resolvedFrom ? { resolvedFrom: head.value.resolvedFrom } : {}),
          ...(head.value.refRevision ? { refRevision: head.value.refRevision } : {}),
        },
      )
    ) {
      return undefined;
    }

    const commit = await graph.readCommit(head.value.id);
    if (commit.status !== 'success') return undefined;
    return {
      semanticChangeSetDigest: commit.commit.payload.semanticChangeSetDigest,
      snapshotRootDigest: commit.commit.payload.snapshotRootDigest,
    };
  } catch {
    return undefined;
  }
}

function readMogVersionMetadataXmlFromXlsx(
  xlsxBytes: Uint8Array,
):
  | { readonly status: 'absent' }
  | { readonly status: 'present'; readonly xml: string }
  | { readonly status: 'untrusted'; readonly reason: MogWorkbookVersionXlsxMetadataTrustReason } {
  const view = new DataView(xlsxBytes.buffer, xlsxBytes.byteOffset, xlsxBytes.byteLength);
  const eocd = readEndOfCentralDirectory(view);
  const metadataEntries = readCentralDirectoryEntries(xlsxBytes, view, eocd).filter((entry) =>
    isMogVersionMetadataPart(entry.name),
  );

  if (metadataEntries.length === 0) return { status: 'absent' };
  if (metadataEntries.length !== 1) {
    return { status: 'untrusted', reason: 'duplicate-sidecar' };
  }

  const entry = metadataEntries[0];
  if (!entry) return { status: 'absent' };
  if (entry.compressedSize > MOG_VERSION_METADATA_MAX_BYTES) {
    return { status: 'untrusted', reason: 'sidecar-too-large' };
  }
  if (
    entry.compressionMethod !== 0 ||
    entry.compressedSize !== entry.uncompressedSize ||
    (entry.generalPurposeBitFlag & 0x0008) !== 0
  ) {
    return { status: 'untrusted', reason: 'unsupported-compression' };
  }

  const localHeaderOffset = entry.localHeaderOffset;
  if (
    localHeaderOffset < 0 ||
    localHeaderOffset + 30 > view.byteLength ||
    view.getUint32(localHeaderOffset, true) !== 0x04034b50
  ) {
    return { status: 'untrusted', reason: 'malformed-sidecar' };
  }

  const localGeneralPurposeBitFlag = view.getUint16(localHeaderOffset + 6, true);
  const localCompressionMethod = view.getUint16(localHeaderOffset + 8, true);
  if (
    localCompressionMethod !== entry.compressionMethod ||
    localGeneralPurposeBitFlag !== entry.generalPurposeBitFlag
  ) {
    return { status: 'untrusted', reason: 'malformed-sidecar' };
  }

  const nameLength = view.getUint16(localHeaderOffset + 26, true);
  const extraLength = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (
    dataStart < localHeaderOffset ||
    dataEnd > view.byteLength ||
    dataEnd > eocd.centralDirectoryOffset
  ) {
    return { status: 'untrusted', reason: 'malformed-sidecar' };
  }

  return {
    status: 'present',
    xml: decodeUtf8(xlsxBytes.subarray(dataStart, dataEnd)),
  };
}

function metadataJsonPayload(xml: string): string {
  const match = /<json>([\s\S]*)<\/json>/.exec(xml);
  const json = match?.[1];
  if (!json) throw new Error('missing Mog version metadata JSON payload');
  return json;
}

function parseMogWorkbookVersionXlsxMetadata(
  value: unknown,
): MogWorkbookVersionXlsxMetadata | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== 'mog.workbookVersion.xlsxMetadata.v1') return null;
  if (typeof value.exportedAt !== 'string' || !value.exportedAt) return null;
  if (typeof value.documentId !== 'string' || !value.documentId) return null;
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
    head: value.head,
    diagnostics: value.diagnostics,
    redaction: value.redaction,
  };
}

function isVersionMetadataHead(value: unknown): value is MogWorkbookVersionXlsxMetadata['head'] {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (typeof value.commitId !== 'string' || !WORKBOOK_COMMIT_ID_RE.test(value.commitId)) {
    return false;
  }
  if ('refName' in value && typeof value.refName !== 'string') return false;
  if ('resolvedFrom' in value && typeof value.resolvedFrom !== 'string') return false;
  if ('refRevision' in value && !isVersionRecordRevision(value.refRevision)) return false;
  if ('semanticChangeSetDigest' in value && !isObjectDigest(value.semanticChangeSetDigest)) {
    return false;
  }
  if ('snapshotRootDigest' in value && !isObjectDigest(value.snapshotRootDigest)) return false;
  return true;
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
  return (
    isRecord(value) &&
    (value.kind === 'counter' || value.kind === 'opaque') &&
    typeof value.value === 'string'
  );
}

function isVersionDiagnosticPublicPayload(value: unknown): value is VersionDiagnosticPublicPayload {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isPublicPrimitive);
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

function metadataHeadIdentityMatchesExpected(
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

function hasVersionMetadataHeadObjectDigests(
  head: NonNullable<MogWorkbookVersionXlsxMetadata['head']>,
): head is NonNullable<MogWorkbookVersionXlsxMetadata['head']> & {
  readonly semanticChangeSetDigest: ObjectDigest;
  readonly snapshotRootDigest: ObjectDigest;
} {
  return isObjectDigest(head.semanticChangeSetDigest) && isObjectDigest(head.snapshotRootDigest);
}

function hasVersionMetadataHeadAuthority(
  head: NonNullable<MogWorkbookVersionXlsxMetadata['head']>,
): boolean {
  return (
    isNonEmptyString(head.refName) &&
    isNonEmptyString(head.resolvedFrom) &&
    isVersionRecordRevision(head.refRevision)
  );
}

function hasExpectedHeadObjectDigests(
  head: MogWorkbookVersionXlsxMetadataExpectedHead,
): head is MogWorkbookVersionXlsxMetadataExpectedHead & {
  readonly semanticChangeSetDigest: ObjectDigest;
  readonly snapshotRootDigest: ObjectDigest;
} {
  return isObjectDigest(head.semanticChangeSetDigest) && isObjectDigest(head.snapshotRootDigest);
}

function hasExpectedHeadAuthority(head: MogWorkbookVersionXlsxMetadataExpectedHead): boolean {
  return (
    isNonEmptyString(head.refName) &&
    isNonEmptyString(head.resolvedFrom) &&
    isVersionRecordRevision(head.refRevision)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function objectDigestMatches(left: ObjectDigest, right: ObjectDigest): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function untrustedMetadataResult(
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

function versionMetadataXml(metadata: MogWorkbookVersionXlsxMetadata): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<mogVersionMetadata xmlns="https://schemas.mog.dev/workbook/version-metadata/1">',
    `<json>${escapeXml(JSON.stringify(metadata))}</json>`,
    '</mogVersionMetadata>',
  ].join('');
}

function readCentralDirectoryEntries(
  bytes: Uint8Array,
  view: DataView,
  eocd: ReturnType<typeof readEndOfCentralDirectory>,
): CentralDirectoryEntry[] {
  const entries: CentralDirectoryEntry[] = [];
  let offset = eocd.centralDirectoryOffset;
  const end = eocd.centralDirectoryOffset + eocd.centralDirectorySize;
  while (offset < end) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(`invalid ZIP central directory header at ${offset}`);
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const nextOffset = nameStart + nameLength + extraLength + commentLength;
    const name = decodeUtf8(bytes.subarray(nameStart, nameStart + nameLength));
    entries.push({
      name,
      bytes: bytes.subarray(offset, nextOffset),
      localHeaderOffset: view.getUint32(offset + 42, true),
      generalPurposeBitFlag: view.getUint16(offset + 8, true),
      compressionMethod: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
    });
    offset = nextOffset;
  }
  if (entries.length !== eocd.entryCount) {
    throw new Error(`ZIP central directory entry count mismatch: ${entries.length}`);
  }
  return entries;
}

function archivePreambleBytes(
  bytes: Uint8Array,
  entries: readonly CentralDirectoryEntry[],
): Uint8Array {
  if (entries.length === 0) return bytes.subarray(0, 0);
  const firstLocalHeaderOffset = Math.min(...entries.map((entry) => entry.localHeaderOffset));
  return bytes.subarray(0, firstLocalHeaderOffset);
}

function localFileSegments(
  bytes: Uint8Array,
  view: DataView,
  eocd: ReturnType<typeof readEndOfCentralDirectory>,
  entries: readonly CentralDirectoryEntry[],
): Array<{ readonly entry: CentralDirectoryEntry; readonly bytes: Uint8Array }> {
  const sortedEntries = [...entries].sort((left, right) => {
    if (left.localHeaderOffset !== right.localHeaderOffset) {
      return left.localHeaderOffset - right.localHeaderOffset;
    }
    return left.name.localeCompare(right.name);
  });
  const segments: Array<{ readonly entry: CentralDirectoryEntry; readonly bytes: Uint8Array }> = [];
  for (let index = 0; index < sortedEntries.length; index += 1) {
    const entry = sortedEntries[index];
    if (!entry) continue;
    const start = entry.localHeaderOffset;
    const nextEntry = sortedEntries[index + 1];
    const end = nextEntry ? nextEntry.localHeaderOffset : eocd.centralDirectoryOffset;
    if (start >= eocd.centralDirectoryOffset || start < 0 || end <= start) {
      throw new Error(`invalid ZIP local file offset for ${entry.name}`);
    }
    if (view.getUint32(start, true) !== 0x04034b50) {
      throw new Error(`invalid ZIP local file header for ${entry.name}`);
    }
    segments.push({ entry, bytes: bytes.subarray(start, end) });
  }
  return segments;
}

function readEndOfCentralDirectory(view: DataView): {
  readonly entryCount: number;
  readonly centralDirectorySize: number;
  readonly centralDirectoryOffset: number;
  readonly comment: Uint8Array;
} {
  const offset = findEndOfCentralDirectory(view);
  const commentLength = view.getUint16(offset + 20, true);
  return {
    entryCount: view.getUint16(offset + 10, true),
    centralDirectorySize: view.getUint32(offset + 12, true),
    centralDirectoryOffset: view.getUint32(offset + 16, true),
    comment: new Uint8Array(view.buffer, view.byteOffset + offset + 22, commentLength),
  };
}

function localFileHeader(nameBytes: Uint8Array, data: Uint8Array, crc: number): Uint8Array {
  const header = new Uint8Array(30 + nameBytes.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, data.byteLength, true);
  view.setUint32(22, data.byteLength, true);
  view.setUint16(26, nameBytes.byteLength, true);
  header.set(nameBytes, 30);
  return header;
}

function centralDirectoryHeader(
  nameBytes: Uint8Array,
  data: Uint8Array,
  crc: number,
  localHeaderOffset: number,
): Uint8Array {
  const header = new Uint8Array(46 + nameBytes.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, data.byteLength, true);
  view.setUint32(24, data.byteLength, true);
  view.setUint16(28, nameBytes.byteLength, true);
  view.setUint32(42, localHeaderOffset, true);
  header.set(nameBytes, 46);
  return header;
}

function centralDirectoryHeaderWithLocalHeaderOffset(
  entryBytes: Uint8Array,
  localHeaderOffset: number,
): Uint8Array {
  const header = new Uint8Array(entryBytes);
  new DataView(header.buffer).setUint32(42, localHeaderOffset, true);
  return header;
}

function endOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
  comment: Uint8Array,
): Uint8Array {
  const record = new Uint8Array(22 + comment.byteLength);
  const view = new DataView(record.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, comment.byteLength, true);
  record.set(comment, 22);
  return record;
}

function findEndOfCentralDirectory(view: DataView): number {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('missing ZIP end of central directory');
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = new Uint32Array(
  Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  }),
);

function byteLength(parts: readonly Uint8Array[]): number {
  return parts.reduce((sum, part) => sum + part.byteLength, 0);
}

function concatUint8Arrays(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(byteLength(parts));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function normalizePackagePath(value: string): string {
  return value.replace(/^\/+/, '');
}

function isMogVersionMetadataPart(value: string): boolean {
  return normalizePackagePath(value) === MOG_VERSION_METADATA_PART;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPublicPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  );
}
