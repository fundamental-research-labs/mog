import type { ObjectDigest, VersionHead, WorkbookCommitId } from '@mog-sdk/contracts/api';

import { createWorkbook } from '../create-workbook';
import {
  addMogVersionMetadataToXlsx,
  maybeAddMogVersionMetadataToXlsx,
  MOG_VERSION_METADATA_PART,
  readAndValidateMogVersionMetadataFromXlsx,
  type MogWorkbookVersionXlsxMetadata,
} from '../xlsx-version-metadata';
import {
  REQUIRED_MOG_VERSION_METADATA_REDACTION_OMISSIONS,
  type MogVersionMetadataExportSink,
  type MogVersionMetadataExportSinkAuthorization,
} from '../version-xlsx-metadata-export-gate';

export const SOURCE_DOCUMENT_ID = 'vc10-xlsx-metadata-export-gate-source';
export const CLEAN_EXPORT_DOCUMENT_ID = 'vc10-xlsx-metadata-export-gate-clean';
export const METADATA_EXPORT_DOCUMENT_ID = 'vc10-xlsx-metadata-export-gate';
export const STALE_IMPORTED_DOCUMENT_ID = 'vc10-xlsx-metadata-export-gate-stale-imported';
export const STALE_IMPORTED_WORKSPACE_ID = 'vc10-xlsx-metadata-export-gate-stale-workspace';
export const METADATA_EXPORT_WORKSPACE_ID = 'vc10-xlsx-metadata-export-gate-workspace';
export const OTHER_METADATA_EXPORT_WORKSPACE_ID = 'vc10-xlsx-metadata-export-gate-other-workspace';
export const COPIED_METADATA_DOCUMENT_ID = 'vc10-xlsx-metadata-export-gate-copied';
export const METADATA_EXPORT_GRAPH_ID = 'vc10-xlsx-metadata-export-gate-graph';
export const OLD_METADATA_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
export const OTHER_METADATA_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
export const STALE_SOURCE_ROOT_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;
export const SEMANTIC_CHANGE_SET_DIGEST = objectDigest('1');
export const SNAPSHOT_ROOT_DIGEST = objectDigest('2');
export const REF_REVISION = { kind: 'counter', value: '1' } as const;
export const OTHER_REF_REVISION = { kind: 'counter', value: '2' } as const;
export const STALE_IMPORTED_REF_REVISION = {
  kind: 'opaque',
  value: 'vc10-xlsx-metadata-export-gate-stale-ref-revision',
} as const;
export const UNSAFE_AUTHORITY_DIAGNOSTICS = [
  { message: 'vc10-metadata-export-authority-leak', dependency: 'secret://authority' },
] as const;

export async function expectCleanExportOmitsImportedMetadata(
  options: Parameters<typeof maybeAddMogVersionMetadataToXlsx>[3],
): Promise<void> {
  const xlsxBytes = addMogVersionMetadataToXlsx(
    await createSourceXlsx(),
    testVersionMetadata({
      documentId: STALE_IMPORTED_DOCUMENT_ID,
      workspaceId: STALE_IMPORTED_WORKSPACE_ID,
      commitId: OTHER_METADATA_COMMIT_ID,
      refRevision: STALE_IMPORTED_REF_REVISION,
    }),
  );
  const staleMetadataArchiveText = decodeUtf8(xlsxBytes);
  expect(staleMetadataArchiveText).toContain(STALE_IMPORTED_DOCUMENT_ID);
  expect(staleMetadataArchiveText).toContain(STALE_IMPORTED_WORKSPACE_ID);
  expect(staleMetadataArchiveText).toContain(OTHER_METADATA_COMMIT_ID);
  expect(staleMetadataArchiveText).toContain(STALE_IMPORTED_REF_REVISION.value);

  const exported = await maybeAddMogVersionMetadataToXlsx(
    metadataExportContext({ documentId: CLEAN_EXPORT_DOCUMENT_ID }),
    {
      getHead: async () => {
        throw new Error('clean metadata export must not read the version head without opt-in');
      },
    } as Parameters<typeof maybeAddMogVersionMetadataToXlsx>[1],
    xlsxBytes,
    options,
    blockedMetadataSink(),
  );
  expect(
    readAndValidateMogVersionMetadataFromXlsx(exported, {
      expectedDocumentId: CLEAN_EXPORT_DOCUMENT_ID,
    }),
  ).toMatchObject({ status: 'absent' });
  const cleanArchiveText = decodeUtf8(exported);
  expect(cleanArchiveText).not.toContain(STALE_IMPORTED_DOCUMENT_ID);
  expect(cleanArchiveText).not.toContain(STALE_IMPORTED_WORKSPACE_ID);
  expect(cleanArchiveText).not.toContain(OTHER_METADATA_COMMIT_ID);
  expect(cleanArchiveText).not.toContain(STALE_IMPORTED_REF_REVISION.value);
}

export async function createSourceXlsx(): Promise<Uint8Array> {
  const wb = await createWorkbook({ documentId: SOURCE_DOCUMENT_ID, userTimezone: 'UTC' });
  try {
    await wb.activeSheet.setCell('A1', 'Metadata export gate');
    await wb.activeSheet.setCell('B1', 42);
    return wb.toXlsx();
  } finally {
    await wb.close('skipSave').catch(() => {
      wb.dispose();
    });
  }
}

export function metadataExportContext(input: {
  readonly documentId: string;
  readonly workspaceId?: string;
  readonly provider?: unknown;
}): Parameters<typeof maybeAddMogVersionMetadataToXlsx>[0] {
  return {
    clock: { dateNow: () => Date.parse('2026-06-23T00:00:00.000Z') },
    workbookLinkScope: () => ({
      requestingDocumentId: input.documentId,
      ...(input.workspaceId ? { requestingWorkspaceId: input.workspaceId } : {}),
    }),
    ...(input.provider ? { versioning: { provider: input.provider } } : {}),
  } as Parameters<typeof maybeAddMogVersionMetadataToXlsx>[0];
}

export function metadataExportAuthorityProvider(input: {
  readonly documentId: string;
  readonly workspaceId?: string;
  readonly head: VersionHead;
  readonly registryDocumentId?: string;
  readonly registryWorkspaceId?: string;
  readonly registryRootCommitId?: WorkbookCommitId;
  readonly sourceRootInClosure?: boolean;
  readonly graphNamespaceGraphId?: string;
  readonly graphNamespaceWorkspaceId?: string;
  readonly registryDiagnostics?: readonly unknown[];
  readonly headDiagnostics?: readonly unknown[];
  readonly closureDiagnostics?: readonly unknown[];
}) {
  const rootCommitId = input.registryRootCommitId ?? (input.head.id as WorkbookCommitId);
  const registryWorkspaceId = input.registryWorkspaceId ?? input.workspaceId;
  const graphWorkspaceId = input.graphNamespaceWorkspaceId ?? registryWorkspaceId;
  const graphNamespace = {
    ...(graphWorkspaceId ? { workspaceId: graphWorkspaceId } : {}),
    documentId: input.documentId,
    graphId: input.graphNamespaceGraphId ?? METADATA_EXPORT_GRAPH_ID,
  };
  const rootCommit = testCommit({
    id: rootCommitId,
    documentId: input.documentId,
    parentCommitIds: [],
  });
  const headCommit = testCommit({
    id: input.head.id as WorkbookCommitId,
    documentId: input.documentId,
    parentCommitIds: input.head.id === rootCommitId ? [] : [rootCommitId],
  });
  const commitClosure =
    input.sourceRootInClosure === false
      ? [headCommit]
      : input.head.id === rootCommitId
        ? [headCommit]
        : [headCommit, rootCommit];

  return {
    documentScope: {
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      documentId: input.documentId,
    },
    accessContext: {},
    readGraphRegistry: async () => ({
      status: 'ok',
      ...(input.registryDiagnostics ? { diagnostics: input.registryDiagnostics } : {}),
      registry: {
        ...(registryWorkspaceId ? { workspaceId: registryWorkspaceId } : {}),
        documentId: input.registryDocumentId ?? input.documentId,
        currentGraphId: METADATA_EXPORT_GRAPH_ID,
        rootCommitId,
      },
    }),
    openGraph: async () => ({
      namespace: graphNamespace,
      readHead: async () => ({
        status: 'success',
        head: input.head,
        ...(input.headDiagnostics ? { diagnostics: input.headDiagnostics } : {}),
      }),
      readCommitClosure: async () => ({
        status: 'success',
        commits: commitClosure,
        diagnostics: input.closureDiagnostics ?? [],
      }),
    }),
  };
}

export async function expectAuthorityExportBlocked(
  input: {
    readonly contextWorkspaceId?: string;
    readonly exportedHead?: VersionHead;
    readonly provider: Parameters<typeof metadataExportAuthorityProvider>[0];
  },
  metadataIssue: string,
): Promise<void> {
  const exportedHead = input.exportedHead ?? input.provider.head;
  await expectMogMetadataExportBlocked(
    maybeAddMogVersionMetadataToXlsx(
      metadataExportContext({
        documentId: METADATA_EXPORT_DOCUMENT_ID,
        ...(input.contextWorkspaceId ? { workspaceId: input.contextWorkspaceId } : {}),
        provider: metadataExportAuthorityProvider(input.provider),
      }),
      { getHead: async () => ({ ok: true, value: exportedHead }) } as Parameters<
        typeof maybeAddMogVersionMetadataToXlsx
      >[1],
      await createSourceXlsx(),
      { versionMetadata: 'include' },
      blockedMetadataSink(),
    ),
    metadataIssue,
  );
}

function testCommit(input: {
  readonly id: WorkbookCommitId;
  readonly documentId: string;
  readonly parentCommitIds: readonly WorkbookCommitId[];
}) {
  return {
    id: input.id,
    payload: {
      documentId: input.documentId,
      parentCommitIds: input.parentCommitIds,
      semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
      snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
    },
  };
}

export async function expectMogMetadataExportBlocked(
  exportAttempt: Promise<Uint8Array>,
  metadataIssue: string,
): Promise<void> {
  await expect(exportAttempt).rejects.toMatchObject({
    name: 'MogSdkError',
    code: 'EXPORT_ERROR',
    operation: 'workbook.toXlsx',
    diagnostics: {
      domain: 'VERSION',
      issueCode: 'VERSION_XLSX_METADATA_EXPORT_BLOCKED',
      severity: 'error',
    },
    details: {
      issue: 'metadata-export-blocked',
      operation: 'workbook.toXlsx',
      metadataIssue,
      sidecarPart: MOG_VERSION_METADATA_PART,
      mutationGuarantee: 'no-write-attempted',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_XLSX_METADATA_EXPORT_BLOCKED',
          mutationGuarantee: 'no-write-attempted',
          redacted: true,
          payload: expect.objectContaining({
            operation: 'export',
            phase: 'export-sidecar',
            reason: metadataIssue,
            sidecarPart: MOG_VERSION_METADATA_PART,
            redacted: true,
          }),
        }),
      ]),
    },
  });
}

export function blockedMetadataSink(
  writes: { count: number } = { count: 0 },
): MogVersionMetadataExportSink {
  return {
    write: () => {
      writes.count += 1;
      throw new Error('metadata export sink must not be called before authorization');
    },
  };
}

export function recordingMetadataSink(
  captured: {
    writes: number;
    authorization?: MogVersionMetadataExportSinkAuthorization;
  },
  result: Uint8Array,
): MogVersionMetadataExportSink {
  return {
    write: (_xlsxBytes, authorization) => {
      captured.writes += 1;
      captured.authorization = authorization;
      return result;
    },
  };
}

export function testVersionMetadata(input: {
  readonly documentId: string;
  readonly workspaceId?: string;
  readonly commitId: WorkbookCommitId;
  readonly refRevision?: NonNullable<VersionHead['refRevision']>;
}): MogWorkbookVersionXlsxMetadata {
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: '2026-06-23T00:00:00.000Z',
    documentId: input.documentId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    head: {
      commitId: input.commitId,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
      refRevision: input.refRevision ?? REF_REVISION,
      semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
      snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
    },
    diagnostics: [],
    redaction: {
      policy: 'commit-document-and-object-digests-only',
      omitted: [...REQUIRED_MOG_VERSION_METADATA_REDACTION_OMISSIONS, 'workspaceId'],
    },
  };
}

export function versionHead(input: {
  readonly id: WorkbookCommitId;
  readonly refRevision?: NonNullable<VersionHead['refRevision']>;
}): VersionHead {
  return {
    id: input.id,
    refName: 'refs/heads/main',
    resolvedFrom: 'HEAD',
    ...(input.refRevision ? { refRevision: input.refRevision } : {}),
  };
}

export function expectedMetadataHead(head: VersionHead) {
  return {
    commitId: head.id,
    ...(head.refName ? { refName: head.refName } : {}),
    ...(head.resolvedFrom ? { resolvedFrom: head.resolvedFrom } : {}),
    ...(head.refRevision ? { refRevision: head.refRevision } : {}),
    semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
    snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
  };
}

export function objectDigest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}

export function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}
