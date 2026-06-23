import 'fake-indexeddb/auto';

import type { ObjectDigest, Workbook, WorkbookCommitId } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { createWorkbook } from '../create-workbook';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  addMogVersionMetadataToXlsx,
  readAndValidateMogVersionMetadataFromXlsx,
  removeMogVersionMetadataFromXlsx,
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
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb-backend';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';

const DOCUMENT_ID = 'vc10-xlsx-reimport-trust';
const WORKSPACE_ID = 'vc10-workspace-a';
const OTHER_WORKSPACE_ID = 'vc10-workspace-b';
const COPIED_DOCUMENT_ID = 'vc10-xlsx-reimport-copied-source';
const WRONG_DOCUMENT_ID = 'vc10-xlsx-reimport-wrong-source';

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('VC-10 XLSX trusted reimport matrix', () => {
  it('trusts a valid same-document local sidecar without creating a duplicate commit', async () => {
    const seed = await seedTrustedExport({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      a1Value: 'Original',
    });

    const imported = await importXlsxWithVersioning({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      xlsxBytes: seed.exported,
    });
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected trusted reimport success: ${imported.error?.message}`);
    }
    expectNoMetadataWarning(imported.warnings);

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({ versioning: versioning(WORKSPACE_ID) });
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'Original' });
      await expect(wb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: { id: seed.rootCommitId },
      });
      await expect(wb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: [expect.objectContaining({ id: seed.rootCommitId, parents: [] })],
        },
      });
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('creates a trusted import-change commit for externally edited bytes', async () => {
    const seed = await seedTrustedExport({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      a1Value: 'Original',
    });
    const externallyEdited = addMogVersionMetadataToXlsx(
      await createSourceXlsx('Externally edited'),
      seed.metadata,
    );

    const imported = await importXlsxWithVersioning({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      xlsxBytes: externallyEdited,
    });
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected externally edited reimport success: ${imported.error?.message}`);
    }
    expectNoMetadataWarning(imported.warnings);

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({ versioning: versioning(WORKSPACE_ID) });
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'Externally edited',
      });

      const head = await expectVersionHead(wb);
      expect(head.id).toBe(seed.rootCommitId);

      const branchCommitId = await readOnlyImportBranchCommitId(DOCUMENT_ID, WORKSPACE_ID);
      expect(branchCommitId).not.toBe(seed.rootCommitId);

      const changePayload = await readSemanticChangeSetPayload(
        branchCommitId,
        DOCUMENT_ID,
        WORKSPACE_ID,
      );
      expect(changePayload).toMatchObject({
        source: {
          kind: 'xlsxImportChange',
          versionMetadataTrust: {
            status: 'trusted',
            redacted: true,
          },
        },
      });
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it.each([
    {
      name: 'copied',
      reason: 'wrong-document' as const,
      xlsx: async (seed: TrustedExportSeed) =>
        addMogVersionMetadataToXlsx(
          await createSourceXlsx('Copied metadata'),
          testVersionMetadata({
            ...seed.metadata,
            documentId: COPIED_DOCUMENT_ID,
          }),
        ),
    },
    {
      name: 'forged',
      reason: 'object-digest-mismatch' as const,
      xlsx: async (seed: TrustedExportSeed) =>
        addMogVersionMetadataToXlsx(
          await createSourceXlsx('Forged metadata'),
          testVersionMetadata({
            ...seed.metadata,
            head: {
              ...seed.metadata.head,
              semanticChangeSetDigest: objectDigest('f'),
            },
          }),
        ),
    },
    {
      name: 'wrong-document',
      reason: 'wrong-document' as const,
      xlsx: async (seed: TrustedExportSeed) =>
        addMogVersionMetadataToXlsx(
          await createSourceXlsx('Wrong document metadata'),
          testVersionMetadata({
            ...seed.metadata,
            documentId: WRONG_DOCUMENT_ID,
          }),
        ),
    },
  ])('fails closed for $name metadata', async ({ reason, xlsx }) => {
    const seed = await seedTrustedExport({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      a1Value: 'Original',
    });

    const imported = await importXlsxWithVersioning({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      xlsxBytes: await xlsx(seed),
    });
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected untrusted reimport success: ${imported.error?.message}`);
    }
    expectMetadataWarning(imported.warnings, reason);

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({ versioning: versioning(WORKSPACE_ID) });
      await expect(wb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: { id: seed.rootCommitId },
      });
      await expect(wb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: { items: [expect.objectContaining({ id: seed.rootCommitId })] },
      });
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('routes stale trusted-base external edits to an external-change branch with redacted diagnostics', async () => {
    const seed = await seedTrustedExport({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      a1Value: 'Original',
    });
    const advancedHeadId = await advanceLocalHead(seed);
    const staleReimport = addMogVersionMetadataToXlsx(
      await createSourceXlsx('Stale external edit'),
      seed.metadata,
    );

    const imported = await importXlsxWithVersioning({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      xlsxBytes: staleReimport,
    });
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected stale reimport success: ${imported.error?.message}`);
    }
    expectStaleMetadataWarning(imported.warnings);

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({ versioning: versioning(WORKSPACE_ID) });
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'Stale external edit',
      });
      await expect(wb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: { id: advancedHeadId },
      });
      await expect(wb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: expect.arrayContaining([
            expect.objectContaining({ id: advancedHeadId, parents: [seed.rootCommitId] }),
            expect.objectContaining({ id: seed.rootCommitId }),
          ]),
        },
      });

      const branchCommit = await readOnlyImportBranchCommit(DOCUMENT_ID, WORKSPACE_ID);
      expect(branchCommit.id).not.toBe(seed.rootCommitId);
      expect(branchCommit.id).not.toBe(advancedHeadId);
      expect(branchCommit.payload.parentCommitIds).toEqual([seed.rootCommitId]);

      const changePayload = await readSemanticChangeSetPayload(
        branchCommit.id,
        DOCUMENT_ID,
        WORKSPACE_ID,
      );
      expect(changePayload).toMatchObject({
        source: {
          kind: 'xlsxImportChange',
          versionMetadataTrust: {
            status: 'trusted-stale-base',
            redacted: true,
          },
        },
        importDiagnostics: [
          expect.objectContaining({
            code: 'mogVersionMetadataStale',
            reason: 'trusted-stale-base',
            details: expect.objectContaining({ redacted: true }),
          }),
        ],
      });
      const diagnosticsJson = JSON.stringify(
        (changePayload as { importDiagnostics?: unknown }).importDiagnostics,
      );
      expect(diagnosticsJson).not.toContain(seed.rootCommitId);
      expect(diagnosticsJson).not.toContain(advancedHeadId);
      expect(diagnosticsJson).not.toContain(DOCUMENT_ID);
      expect(diagnosticsJson).not.toContain(WORKSPACE_ID);
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('fails closed for wrong-workspace metadata', async () => {
    const seed = await seedTrustedExport({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      a1Value: 'Original',
    });

    const imported = await importXlsxWithVersioning({
      documentId: DOCUMENT_ID,
      workspaceId: OTHER_WORKSPACE_ID,
      xlsxBytes: seed.exported,
    });
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected wrong-workspace import success: ${imported.error?.message}`);
    }
    expectMetadataWarning(imported.warnings, 'wrong-workspace');

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({ versioning: versioning(OTHER_WORKSPACE_ID) });
      const head = await expectVersionHead(wb);
      expect(head.id).not.toBe(seed.rootCommitId);
      await expect(wb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: { items: [expect.objectContaining({ id: head.id, parents: [] })] },
      });
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('treats missing metadata as absent and never attaches to a lexical commit', async () => {
    const seed = await seedTrustedExport({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      a1Value: 'Original',
    });
    const missingMetadata = removeMogVersionMetadataFromXlsx(
      await createSourceXlsx('Missing metadata edit'),
    );

    const imported = await importXlsxWithVersioning({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      xlsxBytes: missingMetadata,
    });
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected missing metadata import success: ${imported.error?.message}`);
    }
    expectNoMetadataWarning(imported.warnings);

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({ versioning: versioning(WORKSPACE_ID) });
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'Missing metadata edit',
      });
      await expect(wb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: { id: seed.rootCommitId },
      });
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('leaves unresolved metadata untrusted when local or remote authority is unavailable', async () => {
    const seed = await seedTrustedExport({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      a1Value: 'Original',
    });

    const imported = await DocumentFactory.createFromXlsx({ type: 'bytes', data: seed.exported }, {
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
      versioning: {
        providerSelection: {
          kind: 'unavailable',
          workspaceId: WORKSPACE_ID,
        },
      },
    } as Parameters<typeof DocumentFactory.createFromXlsx>[1] & { versioning: unknown });
    expect(imported.success).toBe(true);
    try {
      expectMetadataWarning(imported.warnings, 'head-unverified');
    } finally {
      if (imported.success) {
        await imported.handle?.dispose().catch(() => {});
      }
    }
  });
});

type TrustedExportSeed = {
  readonly rootCommitId: WorkbookCommitId;
  readonly exported: Uint8Array;
  readonly metadata: MogWorkbookVersionXlsxMetadata;
};

async function seedTrustedExport(input: {
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
    const exported = await wb.toXlsx({ contextStripped: true, versionMetadata: 'include' });
    const metadata = readAndValidateMogVersionMetadataFromXlsx(exported, {
      expectedDocumentId: input.documentId,
      ...(input.workspaceId ? { expectedWorkspaceId: input.workspaceId } : {}),
      expectedHead,
    });
    expect(metadata).toMatchObject({ status: 'trusted' });
    if (metadata.status !== 'trusted') {
      throw new Error(`expected trusted seed metadata: ${metadata.status}`);
    }
    return {
      rootCommitId: head.id,
      exported,
      metadata: metadata.metadata,
    };
  } finally {
    await wb?.close('skipSave').catch(() => {});
    await imported.handle.dispose().catch(() => {});
  }
}

async function advanceLocalHead(seed: TrustedExportSeed): Promise<WorkbookCommitId> {
  const imported = await importXlsxWithVersioning({
    documentId: DOCUMENT_ID,
    workspaceId: WORKSPACE_ID,
    xlsxBytes: removeMogVersionMetadataFromXlsx(seed.exported),
  });
  expect(imported.success).toBe(true);
  if (!imported.success || !imported.handle) {
    throw new Error(`expected advance import success: ${imported.error?.message}`);
  }

  let wb: Workbook | undefined;
  try {
    wb = await imported.handle.workbook({ versioning: versioning(WORKSPACE_ID) });
    const rootHead = await expectVersionHead(wb);
    expect(rootHead.id).toBe(seed.rootCommitId);

    await wb.activeSheet.setCell('C1', 'Local advance');
    const committed = await wb.version.commit({
      expectedHead: {
        commitId: rootHead.id,
        revision: rootHead.refRevision,
      },
    });
    expect(committed).toMatchObject({ ok: true });
    if (!committed.ok) {
      throw new Error(`expected local advance commit: ${committed.error.code}`);
    }
    return committed.value.id;
  } finally {
    await wb?.close('skipSave').catch(() => {});
    await imported.handle.dispose().catch(() => {});
  }
}

async function importXlsxWithVersioning(input: {
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

function versioning(workspaceId?: string) {
  return withVersionManifest({
    providerSelection: {
      kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
      requireDurablePersistence: true,
      ...(workspaceId ? { workspaceId } : {}),
    },
  });
}

async function createSourceXlsx(a1Value: string): Promise<Uint8Array> {
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

async function expectVersionHead(wb: Workbook) {
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

async function readSemanticChangeSetPayload(
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

async function readOnlyImportBranchCommitId(
  documentId: string,
  workspaceId?: string,
): Promise<WorkbookCommitId> {
  return (await readOnlyImportBranchCommit(documentId, workspaceId)).id;
}

async function readOnlyImportBranchCommit(
  documentId: string,
  workspaceId?: string,
): Promise<WorkbookCommit> {
  const { provider, graph } = await openIndexedDbGraph(documentId, workspaceId);
  try {
    const branches = await graph.listBranches({ prefix: 'import' });
    expect(branches).toMatchObject({ ok: true });
    if (!branches.ok) throw new Error(`expected import branches: ${branches.error.code}`);
    expect(branches.branches).toHaveLength(1);
    const branch = branches.branches[0];
    if (!branch) throw new Error('expected one import branch');
    expect(branch.name).toMatch(/^import\/external-change\//);
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
    graph: await provider.openGraph(
      namespaceForDocumentScope(documentScope, registry.registry.currentGraphId),
    ),
  };
}

function expectMetadataWarning(
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

function expectNoMetadataWarning(warnings: readonly unknown[]): void {
  expect(warnings).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        diagnostic: expect.objectContaining({ code: 'mogVersionMetadataUntrusted' }),
      }),
    ]),
  );
}

function expectStaleMetadataWarning(warnings: readonly unknown[]): void {
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

function testVersionMetadata(
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

function objectDigest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}
