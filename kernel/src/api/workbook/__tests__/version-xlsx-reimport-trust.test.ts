import 'fake-indexeddb/auto';

import type { Workbook } from '@mog-sdk/contracts/api';

import { addMogVersionMetadataToXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';
import { DOCUMENT_ID, WORKSPACE_ID } from './version-xlsx-reimport-trust-constants';
import { expectNoMetadataWarning } from './version-xlsx-reimport-trust-metadata';
import { installXlsxReimportTrustVersionStoreHooks } from './version-xlsx-reimport-trust-setup';
import {
  readOnlyImportBranchCommitId,
  readSemanticChangeSetPayload,
} from './version-xlsx-reimport-trust-version-store';
import {
  createSourceXlsx,
  expectVersionHead,
  importXlsxWithVersioning,
  seedTrustedExport,
  versioning,
} from './version-xlsx-reimport-trust-workbook';

installXlsxReimportTrustVersionStoreHooks();

describe('VC-10 XLSX trusted reimport same-document trust', () => {
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
});
