import 'fake-indexeddb/auto';

import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  addMogVersionMetadataToXlsx,
  removeMogVersionMetadataFromXlsx,
} from '../xlsx-version-metadata';
import {
  advanceLocalHead,
  COPIED_DOCUMENT_ID,
  createSourceXlsx,
  DOCUMENT_ID,
  expectImportBranchCounts,
  expectMetadataWarning,
  expectNoMetadataWarning,
  expectStaleMetadataWarning,
  expectUntrustedNewRootReimport,
  expectVersionHead,
  importXlsxWithVersioning,
  objectDigest,
  OTHER_WORKSPACE_ID,
  readOnlyImportBranchCommitId,
  readOnlyImportExternalChangeBranchCommit,
  readSemanticChangeSetPayload,
  seedTrustedExport,
  testVersionMetadata,
  type TrustedExportSeed,
  versioning,
  workbookCommitId,
  WORKSPACE_ID,
  WRONG_DOCUMENT_ID,
} from './version-xlsx-reimport-trust-test-utils';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';

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
      name: 'wrong-root',
      reason: 'snapshot-root-mismatch' as const,
      xlsx: async (seed: TrustedExportSeed) =>
        addMogVersionMetadataToXlsx(
          await createSourceXlsx('Wrong root metadata'),
          testVersionMetadata({
            ...seed.metadata,
            head: {
              ...seed.metadata.head,
              snapshotRootDigest: objectDigest('f'),
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
    {
      name: 'malformed-ref-revision',
      reason: 'invalid-schema' as const,
      xlsx: async (seed: TrustedExportSeed) =>
        addMogVersionMetadataToXlsx(
          await createSourceXlsx('Malformed ref revision metadata'),
          testVersionMetadata({
            ...seed.metadata,
            head: { ...seed.metadata.head!, refRevision: { kind: 'counter', value: '01' } },
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

      await expectImportBranchCounts(DOCUMENT_ID, WORKSPACE_ID, {
        externalChange: 0,
        newRoot: 0,
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
