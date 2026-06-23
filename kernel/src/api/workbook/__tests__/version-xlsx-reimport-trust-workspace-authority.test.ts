import 'fake-indexeddb/auto';

import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  DOCUMENT_ID,
  OTHER_WORKSPACE_ID,
  WORKSPACE_ID,
} from './version-xlsx-reimport-trust-constants';
import { expectMetadataWarning } from './version-xlsx-reimport-trust-metadata';
import { installXlsxReimportTrustVersionStoreHooks } from './version-xlsx-reimport-trust-setup';
import {
  expectVersionHead,
  importXlsxWithVersioning,
  seedTrustedExport,
  versioning,
} from './version-xlsx-reimport-trust-workbook';

installXlsxReimportTrustVersionStoreHooks();

describe('VC-10 XLSX trusted reimport workspace and authority checks', () => {
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
