import type { ObjectDigest, Workbook, WorkbookCommitId } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { createWorkbook } from '../create-workbook';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  addMogVersionMetadataToXlsx,
  readAndValidateMogVersionMetadataFromXlsx,
  type MogWorkbookVersionXlsxMetadata,
  type MogWorkbookVersionXlsxMetadataExpectedHead,
  type MogWorkbookVersionXlsxMetadataTrustReason,
} from '../xlsx-version-metadata';
import {
  createDefaultVersionStoreProviderRegistry,
  selectVersionStoreProvider,
} from '../../../document/version-store/provider-registry';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import type { WorkbookCommit } from '../../../document/version-store/commit-store';
import { createVersionObjectRecord } from '../../../document/version-store/object-store';
import { captureWorkbookSnapshotRootRecord } from '../../../document/version-store/snapshot-root-capture';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb-backend';

export const DOCUMENT_ID = 'vc10-xlsx-reimport-trust';
export const WORKSPACE_ID = 'vc10-workspace-a';
export const OTHER_WORKSPACE_ID = 'vc10-workspace-b';
export const COPIED_DOCUMENT_ID = 'vc10-xlsx-reimport-copied-source';
export const WRONG_DOCUMENT_ID = 'vc10-xlsx-reimport-wrong-source';

export type TrustedExportSeed = {
  readonly rootCommitId: WorkbookCommitId;
  readonly exported: Uint8Array;
  readonly metadata: MogWorkbookVersionXlsxMetadata;
};

export async function seedTrustedExport(input: {
  readonly documentId: string;
  readonly workspaceId?: string;
  readonly a1Value: string;
}): Promise<TrustedExportSeed> {
  const imported = await importXlsxWithVersioning({
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    xlsxBytes: await createSourceXlsx(input.a1Value),
  });
  expect(imported.success).toBe(true);
  if (!imported.success || !imported.handle) {
    throw new Error(`expected seed import success: ${imported.error?.message}`);
  }

  let wb: Workbook | undefined;
  try {
    wb = await imported.handle.workbook({ versioning: versioning(input.workspaceId) });
    const head = await expectVersionHead(wb);
    const expectedHead = await readLocalExpectedHead(input.documentId, input.workspaceId);
    const metadata = trustedVersionMetadata(input.documentId, input.workspaceId, expectedHead);
    const exported = addMogVersionMetadataToXlsx(await createSourceXlsx(input.a1Value), metadata);
    const validatedMetadata = readAndValidateMogVersionMetadataFromXlsx(exported, {
      expectedDocumentId: input.documentId,
      ...(input.workspaceId ? { expectedWorkspaceId: input.workspaceId } : {}),
      expectedHead,
    });
    expect(validatedMetadata).toMatchObject({ status: 'trusted' });
    if (validatedMetadata.status !== 'trusted') {
      throw new Error(`expected trusted seed metadata: ${validatedMetadata.status}`);
    }
    return {
      rootCommitId: head.id,
      exported,
      metadata: validatedMetadata.metadata,
    };
  } finally {
    await wb?.close('skipSave').catch(() => {});
    await imported.handle.dispose().catch(() => {});
  }
}

export async function advanceLocalHead(seed: TrustedExportSeed): Promise<WorkbookCommitId> {
  const { provider, graph, namespace } = await openIndexedDbGraph(DOCUMENT_ID, WORKSPACE_ID);
  try {
    const head = await graph.readHead();
    expect(head.status).toBe('success');
    if (head.status !== 'success') throw new Error(`expected local graph head`);
    expect(head.head.id).toBe(seed.rootCommitId);

    const semanticState = localAdvanceSemanticState();
    const snapshotRootRecord = await captureWorkbookSnapshotRootRecord(namespace, {
      encodeDiff: async () => new Uint8Array([0x51, 0x52, 0x53]),
    });
    const semanticChangeSetRecord = await createVersionObjectRecord(namespace, {
      objectType: 'workbook.semanticChangeSet.v1',
      schemaVersion: 1,
      payloadEncoding: 'mog-canonical-json-v1',
      dependencies: [],
      payload: {
        schemaVersion: 1,
        source: {
          kind: 'testLocalAdvance',
          semanticStateDigest: semanticState.stateDigest,
        },
        semanticState,
        changes: [],
      },
    });

    const committed = await graph.commit({
      snapshotRootRecord,
      semanticChangeSetRecord,
      author: {
        authorId: 'test.local-advance',
        actorKind: 'user',
        displayName: 'Local Advance',
      },
      createdAt: '2026-06-23T00:00:00.000Z',
      completenessDiagnostics: [],
      expectedHeadCommitId: head.head.id,
      expectedMainRefVersion: head.main.revision,
    });
    expect(committed.status).toBe('success');
    if (committed.status !== 'success') {
      throw new Error(`expected local advance commit: ${committed.diagnostics[0]?.code}`);
    }
    return committed.commit.id;
  } finally {
    await provider.close('test-teardown').catch(() => {});
  }
}

export async function importXlsxWithVersioning(input: {
  readonly documentId: string;
  readonly workspaceId?: string;
  readonly xlsxBytes: Uint8Array;
}) {
  return DocumentFactory.createFromXlsx({ type: 'bytes', data: input.xlsxBytes }, {
    documentId: input.documentId,
    environment: 'headless',
    userTimezone: 'UTC',
    versioning: versioning(input.workspaceId),
  } as Parameters<typeof DocumentFactory.createFromXlsx>[1] & { versioning: unknown });
}

export async function expectUntrustedNewRootReimport(input: {
  readonly xlsxBytes: Uint8Array;
  readonly expectedHeadCommitId: WorkbookCommitId;
  readonly reason: MogWorkbookVersionXlsxMetadataTrustReason;
  readonly expectedA1Value?: string;
  readonly unexpectedCommitIds?: readonly WorkbookCommitId[];
}) {
  const imported = await importXlsxWithVersioning({
    documentId: DOCUMENT_ID,
    workspaceId: WORKSPACE_ID,
    xlsxBytes: input.xlsxBytes,
  });
  expect(imported.success).toBe(true);
  if (!imported.success || !imported.handle) {
    throw new Error(`expected untrusted reimport success: ${imported.error?.message}`);
  }
  expectMetadataWarning(imported.warnings, input.reason);
  const warningsJson = JSON.stringify(imported.warnings);
  expect(warningsJson).not.toContain('commit:sha256:');
  expect(warningsJson).not.toContain(DOCUMENT_ID);
  expect(warningsJson).not.toContain(WORKSPACE_ID);

  let wb: Workbook | undefined;
  try {
    wb = await imported.handle.workbook({ versioning: versioning(WORKSPACE_ID) });
    if (input.expectedA1Value) {
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: input.expectedA1Value,
      });
    }
    await expect(wb.version.getHead()).resolves.toMatchObject({
      ok: true,
      value: { id: input.expectedHeadCommitId },
    });
    await expect(wb.version.listCommits()).resolves.toMatchObject({
      ok: true,
      value: { items: [expect.objectContaining({ id: input.expectedHeadCommitId })] },
    });

    await expectImportBranchCounts(DOCUMENT_ID, WORKSPACE_ID, {
      externalChange: 0,
      newRoot: 0,
    });
    const commits = await wb.version.listCommits();
    expect(commits).toMatchObject({ ok: true });
    if (commits.ok) {
      for (const commitId of input.unexpectedCommitIds ?? []) {
        expect(commits.value.items).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ id: commitId })]),
        );
      }
    }
  } finally {
    await wb?.close('skipSave').catch(() => {});
    await imported.handle.dispose().catch(() => {});
  }
}

export function versioning(workspaceId?: string) {
  return withVersionManifest({
    providerSelection: versioningProviderSelection(workspaceId),
  });
}

function versioningProviderSelection(workspaceId?: string) {
  return {
    kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
    requireDurablePersistence: true,
    ...(workspaceId ? { workspaceId } : {}),
  };
}

function trustedVersionMetadata(
  documentId: string,
  workspaceId: string | undefined,
  expectedHead: MogWorkbookVersionXlsxMetadataExpectedHead,
): MogWorkbookVersionXlsxMetadata {
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: '2026-06-23T00:00:00.000Z',
    documentId,
    ...(workspaceId ? { workspaceId } : {}),
    head: {
      commitId: expectedHead.commitId,
      ...(expectedHead.refName ? { refName: expectedHead.refName } : {}),
      ...(expectedHead.resolvedFrom ? { resolvedFrom: expectedHead.resolvedFrom } : {}),
      ...(expectedHead.refRevision ? { refRevision: expectedHead.refRevision } : {}),
      ...(expectedHead.semanticChangeSetDigest
        ? { semanticChangeSetDigest: expectedHead.semanticChangeSetDigest }
        : {}),
      ...(expectedHead.snapshotRootDigest
        ? { snapshotRootDigest: expectedHead.snapshotRootDigest }
        : {}),
    },
    diagnostics: [],
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

export async function createSourceXlsx(a1Value: string): Promise<Uint8Array> {
  const wb = await createWorkbook({
    documentId: `vc10-xlsx-reimport-source-${a1Value.replace(/\W+/g, '-').toLowerCase()}`,
    userTimezone: 'UTC',
  });
  try {
    await wb.activeSheet.setCell('A1', a1Value);
    await wb.activeSheet.setCell('B1', 42);
    return wb.toXlsx();
  } finally {
    await wb.close('skipSave').catch(() => {
      wb.dispose();
    });
  }
}

export async function expectVersionHead(wb: Workbook) {
  const head = await wb.version.getHead();
  expect(head).toMatchObject({ ok: true });
  if (!head.ok) throw new Error(`expected version head: ${head.error.code}`);
  if (!head.value.refRevision) throw new Error('expected version head ref revision');
  return head.value;
}

async function readLocalExpectedHead(
  documentId: string,
  workspaceId?: string,
): Promise<MogWorkbookVersionXlsxMetadataExpectedHead> {
  const { provider, graph } = await openIndexedDbGraph(documentId, workspaceId);
  try {
    const head = await graph.readHead();
    expect(head.status).toBe('success');
    if (head.status !== 'success') throw new Error(`expected local graph head`);

    const commit = await graph.readCommit(head.head.id);
    expect(commit.status).toBe('success');
    if (commit.status !== 'success') throw new Error(`expected local graph commit`);

    return {
      commitId: head.head.id,
      refName: head.head.refName,
      resolvedFrom: head.head.resolvedFrom,
      refRevision: head.head.refRevision,
      semanticChangeSetDigest: commit.commit.payload.semanticChangeSetDigest as ObjectDigest,
      snapshotRootDigest: commit.commit.payload.snapshotRootDigest as ObjectDigest,
    };
  } finally {
    await provider.close('test-teardown').catch(() => {});
  }
}

export async function readSemanticChangeSetPayload(
  commitId: WorkbookCommitId,
  documentId: string,
  workspaceId?: string,
): Promise<Record<string, unknown>> {
  const { provider, graph } = await openIndexedDbGraph(documentId, workspaceId);
  try {
    const commit = await graph.readCommit(commitId);
    expect(commit.status).toBe('success');
    if (commit.status !== 'success') throw new Error(`expected commit ${commitId}`);

    const semanticRecord = await graph.getObjectRecord({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: commit.commit.payload.semanticChangeSetDigest,
    });
    return semanticRecord.preimage.payload as Record<string, unknown>;
  } finally {
    await provider.close('test-teardown').catch(() => {});
  }
}

export async function readOnlyImportBranchCommitId(
  documentId: string,
  workspaceId?: string,
): Promise<WorkbookCommitId> {
  return (await readOnlyImportExternalChangeBranchCommit(documentId, workspaceId)).id;
}

export async function readOnlyImportExternalChangeBranchCommit(
  documentId: string,
  workspaceId?: string,
): Promise<WorkbookCommit> {
  return readOnlyImportBranchCommit(documentId, workspaceId, /^import\/external-change\//);
}

export async function readOnlyImportNewRootBranchCommit(
  documentId: string,
  workspaceId?: string,
): Promise<WorkbookCommit> {
  return readOnlyImportBranchCommit(documentId, workspaceId, /^import\/new-root\//);
}

async function readOnlyImportBranchCommit(
  documentId: string,
  workspaceId?: string,
  branchNamePattern?: RegExp,
): Promise<WorkbookCommit> {
  const { provider, graph } = await openIndexedDbGraph(documentId, workspaceId);
  try {
    const branches = await graph.listBranches({ prefix: 'import' });
    expect(branches).toMatchObject({ ok: true });
    if (!branches.ok) throw new Error(`expected import branches: ${branches.error.code}`);
    const matchingBranches = branchNamePattern
      ? branches.branches.filter((branch) => branchNamePattern.test(branch.name))
      : branches.branches;
    expect(matchingBranches).toHaveLength(1);
    const branch = matchingBranches[0];
    if (!branch) throw new Error('expected one import branch');
    if (branchNamePattern) expect(branch.name).toMatch(branchNamePattern);
    const commit = await graph.readCommit(branch.ref.targetCommitId);
    expect(commit.status).toBe('success');
    if (commit.status !== 'success') {
      throw new Error(`expected branch commit: ${commit.diagnostics[0]?.code}`);
    }
    return commit.commit;
  } finally {
    await provider.close('test-teardown').catch(() => {});
  }
}

export async function expectImportBranchCounts(
  documentId: string,
  workspaceId: string | undefined,
  expected: {
    readonly externalChange: number;
    readonly newRoot: number;
  },
): Promise<void> {
  const { provider, graph } = await openIndexedDbGraph(documentId, workspaceId);
  try {
    const branches = await graph.listBranches({ prefix: 'import' });
    expect(branches).toMatchObject({ ok: true });
    if (!branches.ok) throw new Error(`expected import branches: ${branches.error.code}`);
    expect(
      branches.branches.filter((branch) => /^import\/external-change\//.test(branch.name)),
    ).toHaveLength(expected.externalChange);
    expect(
      branches.branches.filter((branch) => /^import\/new-root\//.test(branch.name)),
    ).toHaveLength(expected.newRoot);
  } finally {
    await provider.close('test-teardown').catch(() => {});
  }
}

async function openIndexedDbGraph(documentId: string, workspaceId?: string) {
  const documentScope: VersionDocumentScope = {
    ...(workspaceId ? { workspaceId } : {}),
    documentId,
  };
  const provider = selectVersionStoreProvider(
    {
      kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
      documentScope,
      requireDurablePersistence: true,
    },
    createDefaultVersionStoreProviderRegistry(),
  );
  const registry = await provider.readGraphRegistry();
  expect(registry.status).toBe('ok');
  if (registry.status !== 'ok') {
    throw new Error(`expected version registry: ${registry.diagnostics[0]?.code}`);
  }
  return {
    provider,
    namespace: namespaceForDocumentScope(documentScope, registry.registry.currentGraphId),
    graph: await provider.openGraph(
      namespaceForDocumentScope(documentScope, registry.registry.currentGraphId),
    ),
  };
}

export function expectMetadataWarning(
  warnings: readonly unknown[],
  reason: MogWorkbookVersionXlsxMetadataTrustReason,
): void {
  expect(warnings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'import_error',
        reason,
        diagnostic: expect.objectContaining({
          code: 'mogVersionMetadataUntrusted',
          reason,
          details: expect.objectContaining({ redacted: true }),
        }),
      }),
    ]),
  );
}

export function expectNoMetadataWarning(warnings: readonly unknown[]): void {
  expect(warnings).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        diagnostic: expect.objectContaining({ code: 'mogVersionMetadataUntrusted' }),
      }),
    ]),
  );
}

export function expectStaleMetadataWarning(warnings: readonly unknown[]): void {
  expect(warnings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'import_error',
        reason: 'trusted-stale-base',
        diagnostic: expect.objectContaining({
          code: 'mogVersionMetadataStale',
          reason: 'trusted-stale-base',
          details: expect.objectContaining({
            trusted: true,
            staleBase: true,
            redacted: true,
          }),
        }),
      }),
    ]),
  );
  const serialized = JSON.stringify(warnings);
  expect(serialized).not.toContain(DOCUMENT_ID);
  expect(serialized).not.toContain(WORKSPACE_ID);
  expect(serialized).not.toContain('commit:sha256:');
}

export function testVersionMetadata(
  metadata: MogWorkbookVersionXlsxMetadata,
): MogWorkbookVersionXlsxMetadata {
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: metadata.exportedAt,
    documentId: metadata.documentId,
    ...(metadata.workspaceId ? { workspaceId: metadata.workspaceId } : {}),
    head: metadata.head ? { ...metadata.head } : null,
    diagnostics: metadata.diagnostics,
    redaction: metadata.redaction,
  };
}

export function objectDigest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}

export function workbookCommitId(seed: string): WorkbookCommitId {
  return `commit:sha256:${seed.repeat(64).slice(0, 64)}` as WorkbookCommitId;
}

function localAdvanceSemanticState() {
  return {
    state: {
      schemaVersion: 'semantic-workbook-state.v1',
      workbookId: 'local-advance',
      domains: {},
      sheets: {},
    },
    stateDigest: {
      algorithm: 'sha256',
      value: 'localadvance'.repeat(6).slice(0, 64),
    },
  };
}
