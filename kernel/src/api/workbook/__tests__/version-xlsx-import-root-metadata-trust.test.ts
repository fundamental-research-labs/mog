import 'fake-indexeddb/auto';

import type { ObjectDigest, Workbook, WorkbookCommitId } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  addMogVersionMetadataToXlsx,
  readAndValidateMogVersionMetadataFromXlsx,
  type MogWorkbookVersionXlsxMetadata,
} from '../xlsx-version-metadata';
import { withExportSupportedVersionManifest } from './version-domain-support-test-utils';
import {
  createSourceXlsx,
  durableIndexedDbVersioning,
  METADATA_TRUST_DOCUMENT_ID,
  METADATA_TRUST_REIMPORT_DOCUMENT_ID,
  OLD_METADATA_COMMIT_ID,
  OTHER_METADATA_COMMIT_ID,
  OTHER_REF_REVISION,
  OTHER_SEMANTIC_CHANGE_SET_DIGEST,
  OTHER_SNAPSHOT_ROOT_DIGEST,
  RAW_METADATA_DIAGNOSTIC_SECRET,
  readRootCommitPayload,
  readRootSemanticChangeSetPayload,
  REF_REVISION,
  resetVersionStoreIndexedDbForXlsxImportRootTests,
  SEMANTIC_CHANGE_SET_DIGEST,
  SNAPSHOT_ROOT_DIGEST,
  testVersionMetadata,
} from './version-xlsx-import-root-test-utils';

beforeEach(resetVersionStoreIndexedDbForXlsxImportRootTests);
afterEach(resetVersionStoreIndexedDbForXlsxImportRootTests);

describe('WorkbookVersion XLSX import root metadata trust', () => {
  it('validates Mog version metadata only against authoritative document and head identity', async () => {
    const xlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx(),
      testVersionMetadata({
        documentId: METADATA_TRUST_DOCUMENT_ID,
        commitId: OLD_METADATA_COMMIT_ID,
        refRevision: REF_REVISION,
      }),
    );

    expect(
      readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'head-unverified',
      diagnostics: [
        expect.objectContaining({
          code: 'mogVersionMetadataUntrusted',
          reason: 'head-unverified',
          details: expect.objectContaining({ redacted: true }),
        }),
      ],
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
        expectedDocumentId: 'copied-target-document',
        expectedHead: {
          commitId: OLD_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: REF_REVISION,
        },
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'wrong-document',
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: {
          commitId: OTHER_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: REF_REVISION,
        },
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'head-mismatch',
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: {
          commitId: OLD_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: REF_REVISION,
        },
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'missing-object-digests',
    });

    const missingHeadXlsxBytes = addMogVersionMetadataToXlsx(await createSourceXlsx(), {
      ...testVersionMetadata({
        documentId: METADATA_TRUST_DOCUMENT_ID,
        commitId: OLD_METADATA_COMMIT_ID,
      }),
      head: null,
    });
    expect(
      readAndValidateMogVersionMetadataFromXlsx(missingHeadXlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
      }),
    ).toMatchObject({ status: 'untrusted', reason: 'missing-head' });

    const digestBoundXlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx(),
      testVersionMetadata({
        documentId: METADATA_TRUST_DOCUMENT_ID,
        commitId: OLD_METADATA_COMMIT_ID,
        refRevision: REF_REVISION,
        semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
        snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
      }),
    );

    const digestBoundWithoutRevisionXlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx(),
      testVersionMetadata({
        documentId: METADATA_TRUST_DOCUMENT_ID,
        commitId: OLD_METADATA_COMMIT_ID,
        semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
        snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
      }),
    );

    expect(
      readAndValidateMogVersionMetadataFromXlsx(digestBoundWithoutRevisionXlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: {
          commitId: OLD_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: REF_REVISION,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'head-unverified',
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(digestBoundXlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: {
          commitId: OLD_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'head-unverified',
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(digestBoundXlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: {
          commitId: OLD_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: REF_REVISION,
          semanticChangeSetDigest: OTHER_SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'object-digest-mismatch',
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(digestBoundXlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: {
          commitId: OLD_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: REF_REVISION,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: OTHER_SNAPSHOT_ROOT_DIGEST,
        },
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'snapshot-root-mismatch',
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(digestBoundXlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: {
          commitId: OLD_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: OTHER_REF_REVISION,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'head-mismatch',
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(digestBoundXlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: {
          commitId: OLD_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: REF_REVISION,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
      }),
    ).toMatchObject({
      status: 'trusted',
      metadata: {
        documentId: METADATA_TRUST_DOCUMENT_ID,
        head: {
          commitId: OLD_METADATA_COMMIT_ID,
          refRevision: REF_REVISION,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
      },
      diagnostics: [],
    });
  });

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

  it('trusts same-document XLSX metadata when local authority is available', async () => {
    const originalXlsxBytes = await createSourceXlsx('Original import root');
    const originalImport = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: originalXlsxBytes },
      {
        documentId: METADATA_TRUST_REIMPORT_DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(originalImport.success).toBe(true);
    if (!originalImport.success || !originalImport.handle) {
      throw new Error(`expected original XLSX import success: ${originalImport.error?.message}`);
    }

    let originalWb: Workbook | undefined;
    let originalRootId: WorkbookCommitId | undefined;
    let originalMetadata: MogWorkbookVersionXlsxMetadata | undefined;
    try {
      originalWb = await originalImport.handle.workbook({
        versioning: withExportSupportedVersionManifest(durableIndexedDbVersioning()),
      });
      const head = await originalWb.version.getHead();
      expect(head).toMatchObject({ ok: true });
      if (!head.ok) throw new Error(`expected original import-root head: ${head.error.code}`);
      originalRootId = head.value.id;
      const commitPayload = await readRootCommitPayload(
        originalRootId,
        METADATA_TRUST_REIMPORT_DOCUMENT_ID,
      );
      originalMetadata = testVersionMetadata({
        documentId: METADATA_TRUST_REIMPORT_DOCUMENT_ID,
        commitId: originalRootId,
        ...(head.value.refRevision ? { refRevision: head.value.refRevision } : {}),
        semanticChangeSetDigest: commitPayload.semanticChangeSetDigest as ObjectDigest,
        snapshotRootDigest: commitPayload.snapshotRootDigest as ObjectDigest,
      });
    } finally {
      await originalWb?.close('skipSave').catch(() => {});
      await originalImport.handle.dispose().catch(() => {});
    }
    if (!originalRootId) throw new Error('expected original root id');
    if (!originalMetadata) throw new Error('expected original metadata sidecar');

    const reimportedXlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx('Externally edited import'),
      originalMetadata,
    );
    const reimported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: reimportedXlsxBytes },
      {
        documentId: METADATA_TRUST_REIMPORT_DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(reimported.success).toBe(true);
    if (!reimported.success || !reimported.handle) {
      throw new Error(`expected reimport XLSX import success: ${reimported.error?.message}`);
    }
    expect(reimported.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          diagnostic: expect.objectContaining({ code: 'mogVersionMetadataUntrusted' }),
        }),
      ]),
    );

    let reimportedWb: Workbook | undefined;
    try {
      reimportedWb = await reimported.handle.workbook({
        versioning: durableIndexedDbVersioning(),
      });
      await expect(reimportedWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'Externally edited import',
      });

      const reimportedHead = await reimportedWb.version.getHead();
      expect(reimportedHead).toMatchObject({ ok: true });
      if (!reimportedHead.ok) {
        throw new Error(`expected reimport version head: ${reimportedHead.error.code}`);
      }
      expect(reimportedHead.value.id).toBe(originalRootId);

      await expect(reimportedWb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: [
            expect.objectContaining({
              id: originalRootId,
              parents: [],
            }),
          ],
        },
      });
    } finally {
      await reimportedWb?.close('skipSave').catch(() => {});
      await reimported.handle.dispose().catch(() => {});
    }
  });
});
