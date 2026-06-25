import 'fake-indexeddb/auto';

import type { Workbook } from '@mog-sdk/contracts/api';

import { addMogVersionMetadataToXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';
import { DOCUMENT_ID, WORKSPACE_ID } from './version-xlsx-reimport-trust-constants';
import { expectStaleMetadataWarning } from './version-xlsx-reimport-trust-metadata';
import { installXlsxReimportTrustVersionStoreHooks } from './version-xlsx-reimport-trust-setup';
import {
  expectImportBranchCounts,
  readOnlyImportExternalChangeBranchCommit,
  readSemanticChangeSetPayload,
} from './version-xlsx-reimport-trust-version-store';
import {
  advanceLocalHead,
  createSourceXlsx,
  importXlsxWithVersioning,
  seedTrustedExport,
  versioning,
} from './version-xlsx-reimport-trust-workbook';

installXlsxReimportTrustVersionStoreHooks();

describe('VC-10 XLSX trusted reimport stale-base handling', () => {
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
});
