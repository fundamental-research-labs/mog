import 'fake-indexeddb/auto';

import type { ObjectDigest, Workbook, WorkbookCommitId } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { createWorkbook } from '../create-workbook';
import {
  withExportSupportedVersionManifest,
  withVersionManifest,
} from './version-domain-support-test-utils';
import {
  addMogVersionMetadataToXlsx,
  MOG_VERSION_METADATA_PART,
  readAndValidateMogVersionMetadataFromXlsx,
  type MogWorkbookVersionXlsxMetadata,
} from '../xlsx-version-metadata';
import {
  createDefaultVersionStoreProviderRegistry,
  selectVersionStoreProvider,
} from '../../../document/version-store/provider-registry';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb-backend';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';

const DOCUMENT_ID = 'vc10-xlsx-import-root';
const CLEAN_EXPORT_DOCUMENT_ID = 'vc10-xlsx-clean-export';
const METADATA_EXPORT_DOCUMENT_ID = 'vc10-xlsx-metadata-export';
const METADATA_REPLACE_DOCUMENT_ID = 'vc10-xlsx-metadata-replace';
const METADATA_TRUST_DOCUMENT_ID = 'vc10-xlsx-metadata-trust';
const METADATA_TRUST_REIMPORT_DOCUMENT_ID = 'vc10-xlsx-metadata-trust-reimport';
const OLD_METADATA_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const OTHER_METADATA_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
const SEMANTIC_CHANGE_SET_DIGEST = objectDigest('1');
const SNAPSHOT_ROOT_DIGEST = objectDigest('2');
const OTHER_SEMANTIC_CHANGE_SET_DIGEST = objectDigest('3');
const OTHER_SNAPSHOT_ROOT_DIGEST = objectDigest('4');

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('WorkbookVersion XLSX import root', () => {
  it('initializes a durable semantic import-root commit for XLSX imports', async () => {
    const xlsxBytes = await createSourceXlsx();
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
      {
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected XLSX import success: ${imported.error?.message}`);
    }

    let wb: Workbook | undefined;
    let reopenedWb: Workbook | undefined;
    let reopenedHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    try {
      wb = await imported.handle.workbook({
        versioning: {
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        },
      });

      const head = await wb.version.getHead();
      expect(head).toMatchObject({
        ok: true,
        value: {
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
        },
      });
      if (!head.ok) throw new Error(`expected import-root head: ${head.error.code}`);
      const rootCommitId = head.value.id;

      await expect(wb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: [
            expect.objectContaining({
              id: rootCommitId,
              parents: [],
              author: expect.objectContaining({
                actorKind: 'system',
                displayName: 'Mog XLSX Import',
              }),
            }),
          ],
        },
      });
      await expect(wb.version.commit({ mode: { kind: 'import-root' } })).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          diagnostics: [expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' })],
        },
      });

      const semanticPayload = await readRootSemanticChangeSetPayload(rootCommitId);
      expect(semanticPayload).toMatchObject({
        schemaVersion: 1,
        source: {
          kind: 'xlsxImportRoot',
          source: {
            sourceType: 'bytes',
            byteLength: xlsxBytes.byteLength,
          },
        },
        importDiagnostics: expect.any(Array),
        changes: [],
      });
      expect(semanticPayload).toHaveProperty('semanticState.stateDigest');
      expect(semanticPayload).not.toHaveProperty('xlsxBytes');
      expect(semanticPayload).not.toHaveProperty('rawBytes');

      await wb.close('skipSave');
      wb = undefined;
      await imported.handle.dispose();

      reopenedHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      reopenedWb = await reopenedHandle.workbook({
        versioning: {
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        },
      });

      await expect(reopenedWb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: { id: rootCommitId },
      });
    } finally {
      await reopenedWb?.close('skipSave').catch(() => {});
      await reopenedHandle?.dispose().catch(() => {});
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('fails closed before clean XLSX export while public registry export is contracted', async () => {
    const xlsxBytes = await createSourceXlsx();
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
      {
        documentId: CLEAN_EXPORT_DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected XLSX import success: ${imported.error?.message}`);
    }

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });

      await expect(wb.version.getHead()).resolves.toMatchObject({ ok: true });

      await expectContractedXlsxExportBlocked(wb.toXlsx({ contextStripped: true }));
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('exports a clean XLSX without Mog version metadata when export support is explicit', async () => {
    const xlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx(),
      testVersionMetadata({
        documentId: 'stale-imported-document',
        commitId: OLD_METADATA_COMMIT_ID,
      }),
    );
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
      {
        documentId: CLEAN_EXPORT_DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected XLSX import success: ${imported.error?.message}`);
    }

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({
        versioning: withExportSupportedVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });

      await expect(wb.version.getHead()).resolves.toMatchObject({ ok: true });

      const cleanExport = await wb.toXlsx();
      expect(zipEntriesNamed(cleanExport, MOG_VERSION_METADATA_PART)).toHaveLength(0);
      expect(countUtf8Occurrences(cleanExport, MOG_VERSION_METADATA_PART)).toBe(0);
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('fails closed before redacted Mog version metadata sidecar export while export is contracted', async () => {
    const xlsxBytes = await createSourceXlsx();
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
      {
        documentId: METADATA_EXPORT_DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected XLSX import success: ${imported.error?.message}`);
    }

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });

      const head = await wb.version.getHead();
      expect(head).toMatchObject({ ok: true });
      if (!head.ok) throw new Error(`expected import-root head: ${head.error.code}`);

      await expectContractedXlsxExportBlocked(
        wb.toXlsx({ contextStripped: true, versionMetadata: 'include' }),
      );
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('exports one redacted Mog version metadata sidecar bound to the current head', async () => {
    const xlsxBytes = await createSourceXlsx();
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
      {
        documentId: METADATA_EXPORT_DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected XLSX import success: ${imported.error?.message}`);
    }

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({
        versioning: withExportSupportedVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });

      const head = await wb.version.getHead();
      expect(head).toMatchObject({ ok: true });
      if (!head.ok) throw new Error(`expected import-root head: ${head.error.code}`);
      const commitPayload = await readRootCommitPayload(head.value.id, METADATA_EXPORT_DOCUMENT_ID);

      const metadataExport = await wb.toXlsx({ versionMetadata: 'include' });
      const metadataEntries = zipEntriesNamed(metadataExport, MOG_VERSION_METADATA_PART);
      expect(metadataEntries).toHaveLength(1);
      expect(countUtf8Occurrences(metadataExport, MOG_VERSION_METADATA_PART)).toBe(2);

      const metadata = parseVersionMetadataXml(decodeUtf8(singleZipEntry(metadataEntries).data));
      expect(metadata).toMatchObject({
        schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
        documentId: METADATA_EXPORT_DOCUMENT_ID,
        head: {
          commitId: head.value.id,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          semanticChangeSetDigest: commitPayload.semanticChangeSetDigest,
          snapshotRootDigest: commitPayload.snapshotRootDigest,
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
      });
      expect(metadata).toHaveProperty('exportedAt');
      expect(metadata).not.toHaveProperty('authors');
      expect(metadata).not.toHaveProperty('agentTraces');
      expect(metadata).not.toHaveProperty('rawWorkbookBytes');
      expect(metadata).not.toHaveProperty('credentials');
      expect(metadata).not.toHaveProperty('externalDataSecrets');
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('replaces an imported Mog version metadata sidecar instead of duplicating it', async () => {
    const xlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx(),
      testVersionMetadata({
        documentId: 'stale-imported-document',
        commitId: OLD_METADATA_COMMIT_ID,
      }),
    );
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
      {
        documentId: METADATA_REPLACE_DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected XLSX import success: ${imported.error?.message}`);
    }

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({
        versioning: withExportSupportedVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });

      const head = await wb.version.getHead();
      expect(head).toMatchObject({ ok: true });
      if (!head.ok) throw new Error(`expected import-root head: ${head.error.code}`);

      const metadataExport = await wb.toXlsx({ versionMetadata: 'include' });
      const metadataEntries = zipEntriesNamed(metadataExport, MOG_VERSION_METADATA_PART);
      expect(metadataEntries).toHaveLength(1);
      expect(countUtf8Occurrences(metadataExport, MOG_VERSION_METADATA_PART)).toBe(2);

      const metadata = parseVersionMetadataXml(decodeUtf8(singleZipEntry(metadataEntries).data));
      expect(metadata.documentId).toBe(METADATA_REPLACE_DOCUMENT_ID);
      expect(metadata.head).toMatchObject({ commitId: head.value.id });
      expect(JSON.stringify(metadata)).not.toContain('stale-imported-document');
      expect(JSON.stringify(metadata)).not.toContain(OLD_METADATA_COMMIT_ID);
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });

  it('validates Mog version metadata only against authoritative document and head identity', async () => {
    const xlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx(),
      testVersionMetadata({
        documentId: METADATA_TRUST_DOCUMENT_ID,
        commitId: OLD_METADATA_COMMIT_ID,
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
        },
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'missing-object-digests',
    });

    const digestBoundXlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx(),
      testVersionMetadata({
        documentId: METADATA_TRUST_DOCUMENT_ID,
        commitId: OLD_METADATA_COMMIT_ID,
        semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
        snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
      }),
    );

    expect(
      readAndValidateMogVersionMetadataFromXlsx(digestBoundXlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: {
          commitId: OLD_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
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
        versioning: {
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        },
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

  it('fails closed on same-document XLSX metadata without import-time authority', async () => {
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
        versioning: withExportSupportedVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });
      const head = await originalWb.version.getHead();
      expect(head).toMatchObject({ ok: true });
      if (!head.ok) throw new Error(`expected original import-root head: ${head.error.code}`);
      originalRootId = head.value.id;
      const metadataExport = await originalWb.toXlsx({ versionMetadata: 'include' });
      originalMetadata = parseVersionMetadataXml(
        decodeUtf8(singleZipEntry(zipEntriesNamed(metadataExport, MOG_VERSION_METADATA_PART)).data),
      ) as unknown as MogWorkbookVersionXlsxMetadata;
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
    expect(reimported.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'import_error',
          reason: 'head-unverified',
          diagnostic: expect.objectContaining({
            code: 'mogVersionMetadataUntrusted',
            details: expect.objectContaining({ redacted: true }),
          }),
        }),
      ]),
    );

    let reimportedWb: Workbook | undefined;
    try {
      reimportedWb = await reimported.handle.workbook({
        versioning: {
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        },
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

async function createSourceXlsx(a1Value = 'Imported'): Promise<Uint8Array> {
  const wb = await createWorkbook({ documentId: 'vc10-xlsx-import-source', userTimezone: 'UTC' });
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

async function readRootSemanticChangeSetPayload(
  rootCommitId: WorkbookCommitId,
  documentId = DOCUMENT_ID,
): Promise<Record<string, unknown>> {
  const { graph, root } = await readRootCommit(rootCommitId, documentId);
  const semanticRecord = await graph.getObjectRecord({
    kind: 'object',
    objectType: 'workbook.semanticChangeSet.v1',
    digest: root.commit.payload.semanticChangeSetDigest,
  });
  return semanticRecord.preimage.payload as Record<string, unknown>;
}

async function readRootCommitPayload(
  rootCommitId: WorkbookCommitId,
  documentId = DOCUMENT_ID,
): Promise<Record<string, unknown>> {
  const { root } = await readRootCommit(rootCommitId, documentId);
  return root.commit.payload as unknown as Record<string, unknown>;
}

async function readRootCommit(
  rootCommitId: WorkbookCommitId,
  documentId: string,
) {
  const documentScope: VersionDocumentScope = { documentId };
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
  const graph = await provider.openGraph(
    namespaceForDocumentScope(documentScope, registry.registry.currentGraphId),
  );
  const root = await graph.readCommit(rootCommitId);
  expect(root.status).toBe('success');
  if (root.status !== 'success') {
    throw new Error(`expected root commit: ${root.diagnostics[0]?.code}`);
  }
  return { graph, root };
}

async function expectContractedXlsxExportBlocked(
  exportAttempt: Promise<Uint8Array>,
): Promise<void> {
  await expect(exportAttempt).rejects.toMatchObject({
    name: 'MogSdkError',
    code: 'EXPORT_ERROR',
    operation: 'workbook.toXlsx',
    diagnostics: {
      domain: 'VERSION',
      issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
      severity: 'error',
    },
    details: {
      issue: 'export-domain-support-manifest-blocked',
      operation: 'workbook.toXlsx',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'export',
            diagnosticCode: 'capability-state-blocked',
            domainId: 'workbook-metadata',
            capabilityKey: 'export',
            capabilityState: 'contracted',
          }),
        }),
      ]),
    },
  });
}

function testVersionMetadata(input: {
  readonly documentId: string;
  readonly commitId: WorkbookCommitId;
  readonly semanticChangeSetDigest?: ObjectDigest;
  readonly snapshotRootDigest?: ObjectDigest;
}): MogWorkbookVersionXlsxMetadata {
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: '2026-06-21T00:00:00.000Z',
    documentId: input.documentId,
    head: {
      commitId: input.commitId,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
      ...(input.semanticChangeSetDigest
        ? { semanticChangeSetDigest: input.semanticChangeSetDigest }
        : {}),
      ...(input.snapshotRootDigest ? { snapshotRootDigest: input.snapshotRootDigest } : {}),
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

function objectDigest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}

function zipEntriesNamed(
  bytes: Uint8Array,
  name: string,
): Array<{ readonly name: string; readonly data: Uint8Array }> {
  return readZipEntries(bytes).filter((entry) => entry.name === name);
}

function singleZipEntry(entries: readonly { readonly name: string; readonly data: Uint8Array }[]): {
  readonly name: string;
  readonly data: Uint8Array;
} {
  const entry = entries[0];
  if (!entry) throw new Error('expected one ZIP entry');
  return entry;
}

function readZipEntries(
  bytes: Uint8Array,
): Array<{ readonly name: string; readonly data: Uint8Array }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const entries: Array<{ readonly name: string; readonly data: Uint8Array }> = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(`invalid ZIP central directory header at ${offset}`);
    }
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const name = decodeUtf8(bytes.subarray(nameStart, nameStart + nameLength));
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    entries.push({
      name,
      data: bytes.subarray(dataStart, dataStart + compressedSize),
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(view: DataView): number {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('missing ZIP end of central directory');
}

function parseVersionMetadataXml(xml: string): Record<string, unknown> {
  const match = /<json>(.*)<\/json>/.exec(xml);
  const json = match?.[1];
  if (!json) throw new Error(`missing metadata JSON payload in ${xml}`);
  return JSON.parse(unescapeXml(json)) as Record<string, unknown>;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function countUtf8Occurrences(bytes: Uint8Array, needle: string): number {
  const haystack = decodeUtf8(bytes);
  let count = 0;
  let offset = 0;
  while (true) {
    const next = haystack.indexOf(needle, offset);
    if (next === -1) return count;
    count += 1;
    offset = next + needle.length;
  }
}

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}
