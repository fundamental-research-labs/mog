import 'fake-indexeddb/auto';

import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { addMogVersionMetadataToXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';
import { installMetadataTrustIndexedDbHooks } from './version-xlsx-import-root-metadata-trust-test-utils';
import {
  createSourceXlsx,
  durableIndexedDbVersioning,
  METADATA_TRUST_DOCUMENT_ID,
  OLD_METADATA_COMMIT_ID,
  RAW_METADATA_DIAGNOSTIC_SECRET,
  readRootSemanticChangeSetPayload,
  REF_REVISION,
  SEMANTIC_CHANGE_SET_DIGEST,
  SNAPSHOT_ROOT_DIGEST,
  testVersionMetadata,
} from './version-xlsx-import-root-test-utils';

installMetadataTrustIndexedDbHooks();

describe('WorkbookVersion XLSX import root metadata trust', () => {
  it('records copied Mog version metadata as untrusted and creates a fresh import root', async () => {
    const xlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx('Copied sidecar content'),
      testVersionMetadata({
        documentId: 'copied-source-document',
        commitId: OLD_METADATA_COMMIT_ID,
      }),
    );
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
      {
        documentId: METADATA_TRUST_DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected XLSX import success: ${imported.error?.message}`);
    }
    expect(imported.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'import_error',
          reason: 'wrong-document',
          diagnostic: expect.objectContaining({
            code: 'mogVersionMetadataUntrusted',
            details: expect.objectContaining({ redacted: true }),
          }),
        }),
      ]),
    );

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({
        versioning: durableIndexedDbVersioning(),
      });

      const head = await wb.version.getHead();
      expect(head).toMatchObject({ ok: true });
      if (!head.ok) throw new Error(`expected import-root head: ${head.error.code}`);
      expect(head.value.id).not.toBe(OLD_METADATA_COMMIT_ID);

      const semanticPayload = await readRootSemanticChangeSetPayload(
        head.value.id,
        METADATA_TRUST_DOCUMENT_ID,
      );
      expect(semanticPayload).toMatchObject({
        source: {
          kind: 'xlsxImportRoot',
          versionMetadataTrust: {
            status: 'untrusted',
            reason: 'wrong-document',
            redacted: true,
          },
        },
        importDiagnostics: [
          expect.objectContaining({
            code: 'mogVersionMetadataUntrusted',
            reason: 'wrong-document',
            details: expect.objectContaining({ redacted: true }),
          }),
        ],
      });
      expect(JSON.stringify(semanticPayload)).not.toContain('copied-source-document');
      expect(JSON.stringify(semanticPayload)).not.toContain(OLD_METADATA_COMMIT_ID);
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('redacts raw metadata diagnostics when creating an import root', async () => {
    const xlsxBytes = addMogVersionMetadataToXlsx(await createSourceXlsx('Raw diagnostics'), {
      ...testVersionMetadata({
        documentId: METADATA_TRUST_DOCUMENT_ID,
        commitId: OLD_METADATA_COMMIT_ID,
        refRevision: REF_REVISION,
        semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
        snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
      }),
      diagnostics: [{ message: RAW_METADATA_DIAGNOSTIC_SECRET }],
    });
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
      { documentId: METADATA_TRUST_DOCUMENT_ID, environment: 'headless', userTimezone: 'UTC' },
    );
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected raw diagnostic import success: ${imported.error?.message}`);
    }
    expect(imported.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'import_error', reason: 'invalid-schema' }),
      ]),
    );
    expect(JSON.stringify(imported.warnings)).not.toContain(RAW_METADATA_DIAGNOSTIC_SECRET);

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({
        versioning: durableIndexedDbVersioning(),
      });
      const head = await wb.version.getHead();
      expect(head).toMatchObject({ ok: true });
      if (!head.ok) throw new Error(`expected import-root head: ${head.error.code}`);
      const semanticPayload = await readRootSemanticChangeSetPayload(
        head.value.id,
        METADATA_TRUST_DOCUMENT_ID,
      );
      expect(semanticPayload).toMatchObject({
        source: {
          kind: 'xlsxImportRoot',
          versionMetadataTrust: { status: 'untrusted', reason: 'invalid-schema', redacted: true },
        },
      });
      expect(JSON.stringify(semanticPayload)).not.toContain(RAW_METADATA_DIAGNOSTIC_SECRET);
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });
});
