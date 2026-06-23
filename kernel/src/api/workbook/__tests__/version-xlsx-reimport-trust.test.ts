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
import { createVersionObjectRecord } from '../../../document/version-store/object-store';
import { captureWorkbookSnapshotRootRecord } from '../../../document/version-store/snapshot-root-capture';
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

  it('fails closed for a real copied sidecar from another document', async () => {
    const copiedSource = await seedTrustedExport({
      documentId: COPIED_DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      a1Value: 'Copied source',
    });
    const targetSeed = await seedTrustedExport({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      a1Value: 'Target original',
    });

    const copiedSidecar = addMogVersionMetadataToXlsx(
      await createSourceXlsx('Copied sidecar payload'),
      copiedSource.metadata,
    );

    await expectUntrustedNewRootReimport({
      xlsxBytes: copiedSidecar,
      expectedHeadCommitId: targetSeed.rootCommitId,
      reason: 'wrong-document',
      expectedA1Value: 'Copied sidecar payload',
      unexpectedCommitIds: [copiedSource.rootCommitId],
    });
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
      name: 'wrong-workspace',
      reason: 'wrong-workspace' as const,
      xlsx: async (seed: TrustedExportSeed) =>
        addMogVersionMetadataToXlsx(
          await createSourceXlsx('Wrong workspace metadata'),
          testVersionMetadata({
            ...seed.metadata,
            workspaceId: OTHER_WORKSPACE_ID,
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

    await expectUntrustedNewRootReimport({
      xlsxBytes: await xlsx(seed),
      expectedHeadCommitId: seed.rootCommitId,
      reason,
    });
  });

  it('fails closed for a forged lexical commit id that is absent from the selected graph', async () => {
    const seed = await seedTrustedExport({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      a1Value: 'Original',
    });
    const forgedLexicalCommit = addMogVersionMetadataToXlsx(
      await createSourceXlsx('Forged lexical commit'),
      testVersionMetadata({
        ...seed.metadata,
        head: seed.metadata.head
          ? {
              ...seed.metadata.head,
              commitId: workbookCommitId('f'),
            }
          : null,
      }),
    );

    await expectUntrustedNewRootReimport({
      xlsxBytes: forgedLexicalCommit,
      expectedHeadCommitId: seed.rootCommitId,
      reason: 'commit-missing',
    });
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

      const branchCommit = await readOnlyImportExternalChangeBranchCommit(
        DOCUMENT_ID,
        WORKSPACE_ID,
      );
      expect(branchCommit.id).not.toBe(seed.rootCommitId);
      expect(branchCommit.id).not.toBe(advancedHeadId);
      expect(branchCommit.payload.parentCommitIds).toEqual([seed.rootCommitId]);
      await expectImportBranchCounts(DOCUMENT_ID, WORKSPACE_ID, {
        externalChange: 1,
        newRoot: 0,
      });

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

  it('fails closed when trusted remote metadata authority is unavailable', async () => {
    const seed = await seedTrustedExport({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      a1Value: 'Original',
    });
    const remoteOnlyMetadata = addMogVersionMetadataToXlsx(
      await createSourceXlsx('Remote authority unavailable'),
      testVersionMetadata({
        ...seed.metadata,
        head: seed.metadata.head
          ? {
              ...seed.metadata.head,
              refName: 'remote/trusted-main',
              resolvedFrom: 'trusted-remote',
              refRevision: { kind: 'opaque', value: 'remote-revision-1' },
            }
          : null,
      }),
    );

    await expectUntrustedNewRootReimport({
      xlsxBytes: remoteOnlyMetadata,
      expectedHeadCommitId: seed.rootCommitId,
      reason: 'head-unverified',
    });
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

      const rootBranchCommit = await readOnlyImportNewRootBranchCommit(DOCUMENT_ID, WORKSPACE_ID);
      expect(rootBranchCommit.id).not.toBe(seed.rootCommitId);
      expect(rootBranchCommit.payload.parentCommitIds).toEqual([]);

      const rootPayload = await readSemanticChangeSetPayload(
        rootBranchCommit.id,
        DOCUMENT_ID,
        WORKSPACE_ID,
      );
      expect(rootPayload).toMatchObject({
        source: {
          kind: 'xlsxImportRoot',
          versionMetadataTrust: {
            status: 'absent',
          },
        },
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

async function advanceLocalHead(seed: TrustedExportSeed): Promise<WorkbookCommitId> {
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

async function expectUntrustedNewRootReimport(input: {
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

    const rootBranchCommit = await readOnlyImportNewRootBranchCommit(DOCUMENT_ID, WORKSPACE_ID);
    expect(rootBranchCommit.id).not.toBe(input.expectedHeadCommitId);
    for (const commitId of input.unexpectedCommitIds ?? []) {
      expect(rootBranchCommit.id).not.toBe(commitId);
    }
    expect(rootBranchCommit.payload.parentCommitIds).toEqual([]);
    await expectImportBranchCounts(DOCUMENT_ID, WORKSPACE_ID, {
      externalChange: 0,
      newRoot: 1,
    });

    const rootPayload = await readSemanticChangeSetPayload(
      rootBranchCommit.id,
      DOCUMENT_ID,
      WORKSPACE_ID,
    );
    expect(rootPayload).toMatchObject({
      source: {
        kind: 'xlsxImportRoot',
        versionMetadataTrust: {
          status: 'untrusted',
          reason: input.reason,
          redacted: true,
        },
      },
    });
  } finally {
    await wb?.close('skipSave').catch(() => {});
    await imported.handle.dispose().catch(() => {});
  }
}

function versioning(workspaceId?: string) {
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
  return (await readOnlyImportExternalChangeBranchCommit(documentId, workspaceId)).id;
}

async function readOnlyImportExternalChangeBranchCommit(
  documentId: string,
  workspaceId?: string,
): Promise<WorkbookCommit> {
  return readOnlyImportBranchCommit(documentId, workspaceId, /^import\/external-change\//);
}

async function readOnlyImportNewRootBranchCommit(
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

async function expectImportBranchCounts(
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

function workbookCommitId(seed: string): WorkbookCommitId {
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
