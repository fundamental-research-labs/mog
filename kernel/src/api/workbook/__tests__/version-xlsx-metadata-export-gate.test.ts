import 'fake-indexeddb/auto';

import type { ObjectDigest, VersionHead, WorkbookCommitId } from '@mog-sdk/contracts/api';

import { createWorkbook } from '../create-workbook';
import {
  addMogVersionMetadataToXlsx,
  maybeAddMogVersionMetadataToXlsx,
  MOG_VERSION_METADATA_PART,
  readAndValidateMogVersionMetadataFromXlsx,
  type MogWorkbookVersionXlsxMetadata,
} from '../xlsx-version-metadata';
import type {
  MogVersionMetadataExportSink,
  MogVersionMetadataExportSinkAuthorization,
} from '../version-xlsx-metadata-export-gate';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';

const SOURCE_DOCUMENT_ID = 'vc10-xlsx-metadata-export-gate-source';
const CLEAN_EXPORT_DOCUMENT_ID = 'vc10-xlsx-metadata-export-gate-clean';
const METADATA_EXPORT_DOCUMENT_ID = 'vc10-xlsx-metadata-export-gate';
const STALE_IMPORTED_DOCUMENT_ID = 'vc10-xlsx-metadata-export-gate-stale-imported';
const COPIED_METADATA_DOCUMENT_ID = 'vc10-xlsx-metadata-export-gate-copied';
const OLD_METADATA_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const OTHER_METADATA_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
const SEMANTIC_CHANGE_SET_DIGEST = objectDigest('1');
const SNAPSHOT_ROOT_DIGEST = objectDigest('2');
const REF_REVISION = { kind: 'counter', value: '1' } as const;
const OTHER_REF_REVISION = { kind: 'counter', value: '2' } as const;

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('VC-10 XLSX metadata export gating', () => {
  it('omits Mog version metadata by default on clean XLSX export', async () => {
    await expectCleanExportOmitsImportedMetadata(undefined);
  });

  it('omits Mog version metadata when clean XLSX export explicitly requests omit', async () => {
    await expectCleanExportOmitsImportedMetadata({ versionMetadata: 'omit' });
  });

  it('writes trusted Mog version metadata sidecar when export explicitly opts in', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });

    const exported = await maybeAddMogVersionMetadataToXlsx(
      metadataExportContext({
        documentId: METADATA_EXPORT_DOCUMENT_ID,
        provider: metadataExportAuthorityProvider({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          head: currentHead,
        }),
      }),
      { getHead: async () => ({ ok: true, value: currentHead }) } as Parameters<
        typeof maybeAddMogVersionMetadataToXlsx
      >[1],
      await createSourceXlsx(),
      { versionMetadata: 'include' },
    );

    const metadata = readAndValidateMogVersionMetadataFromXlsx(exported, {
      expectedDocumentId: METADATA_EXPORT_DOCUMENT_ID,
      expectedHead: expectedMetadataHead(currentHead),
      currentHead: expectedMetadataHead(currentHead),
    });
    expect(metadata).toMatchObject({
      status: 'trusted',
      metadata: {
        documentId: METADATA_EXPORT_DOCUMENT_ID,
        diagnostics: [],
        head: {
          commitId: OLD_METADATA_COMMIT_ID,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
        redaction: {
          policy: 'commit-document-and-object-digests-only',
          omitted: expect.arrayContaining([
            'authors',
            'agentTraces',
            'rawWorkbookBytes',
            'credentials',
            'externalDataSecrets',
            'objectStoreNamespace',
            'principalScope',
          ]),
        },
      },
      trust: {
        status: 'trusted',
        sidecarPart: MOG_VERSION_METADATA_PART,
        redacted: true,
      },
      diagnostics: [],
    });
  });

  it('blocks Mog version metadata sidecar export when current head authority is stale', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });
    const staleAuthorityHead = versionHead({
      id: OTHER_METADATA_COMMIT_ID,
      refRevision: OTHER_REF_REVISION,
    });

    await expectMogMetadataExportBlocked(
      maybeAddMogVersionMetadataToXlsx(
        metadataExportContext({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          provider: metadataExportAuthorityProvider({
            documentId: METADATA_EXPORT_DOCUMENT_ID,
            head: staleAuthorityHead,
          }),
        }),
        { getHead: async () => ({ ok: true, value: currentHead }) } as Parameters<
          typeof maybeAddMogVersionMetadataToXlsx
        >[1],
        await createSourceXlsx(),
        { versionMetadata: 'include' },
        blockedMetadataSink(),
      ),
      'stale-head',
    );
  });

  it('replaces a stale imported Mog version metadata sidecar when opt-in export is authorized', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });
    const xlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx(),
      testVersionMetadata({
        documentId: STALE_IMPORTED_DOCUMENT_ID,
        commitId: OTHER_METADATA_COMMIT_ID,
      }),
    );

    const exported = await maybeAddMogVersionMetadataToXlsx(
      metadataExportContext({
        documentId: METADATA_EXPORT_DOCUMENT_ID,
        provider: metadataExportAuthorityProvider({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          head: currentHead,
        }),
      }),
      { getHead: async () => ({ ok: true, value: currentHead }) } as Parameters<
        typeof maybeAddMogVersionMetadataToXlsx
      >[1],
      xlsxBytes,
      { versionMetadata: 'include' },
    );

    const metadata = readAndValidateMogVersionMetadataFromXlsx(exported, {
      expectedDocumentId: METADATA_EXPORT_DOCUMENT_ID,
      expectedHead: expectedMetadataHead(currentHead),
      currentHead: expectedMetadataHead(currentHead),
    });
    expect(metadata).toMatchObject({
      status: 'trusted',
      metadata: {
        documentId: METADATA_EXPORT_DOCUMENT_ID,
        head: {
          commitId: OLD_METADATA_COMMIT_ID,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
      },
    });
    expect(JSON.stringify(metadata)).not.toContain(STALE_IMPORTED_DOCUMENT_ID);
    expect(JSON.stringify(metadata)).not.toContain(OTHER_METADATA_COMMIT_ID);
  });

  it('authorizes the metadata sink only after redaction and object-store authority preflight', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });
    const captured: {
      writes: number;
      authorization?: MogVersionMetadataExportSinkAuthorization;
    } = { writes: 0 };
    const sinkResult = new Uint8Array([1, 2, 3]);

    const exported = await maybeAddMogVersionMetadataToXlsx(
      metadataExportContext({
        documentId: METADATA_EXPORT_DOCUMENT_ID,
        provider: metadataExportAuthorityProvider({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          head: currentHead,
        }),
      }),
      { getHead: async () => ({ ok: true, value: currentHead }) } as Parameters<
        typeof maybeAddMogVersionMetadataToXlsx
      >[1],
      await createSourceXlsx(),
      { versionMetadata: 'include' },
      recordingMetadataSink(captured, sinkResult),
    );

    expect(exported).toBe(sinkResult);
    expect(captured.writes).toBe(1);
    expect(captured.authorization).toMatchObject({
      sidecarPart: MOG_VERSION_METADATA_PART,
      currentHead: {
        commitId: OLD_METADATA_COMMIT_ID,
        refName: 'refs/heads/main',
        resolvedFrom: 'HEAD',
        refRevision: REF_REVISION,
      },
      objectStoreAuthority: {
        semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
        snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
      },
      redaction: {
        diagnostics: 'none',
        redacted: true,
      },
      metadata: {
        diagnostics: [],
        redaction: {
          policy: 'commit-document-and-object-digests-only',
          omitted: expect.arrayContaining([
            'authors',
            'agentTraces',
            'rawWorkbookBytes',
            'credentials',
            'externalDataSecrets',
            'objectStoreNamespace',
            'principalScope',
          ]),
        },
        head: {
          commitId: OLD_METADATA_COMMIT_ID,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
      },
    });
  });

  it('rejects imported Mog version metadata sidecars that name the wrong document', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });
    const xlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx(),
      testVersionMetadata({
        documentId: COPIED_METADATA_DOCUMENT_ID,
        commitId: OLD_METADATA_COMMIT_ID,
      }),
    );

    const metadata = readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
      expectedDocumentId: METADATA_EXPORT_DOCUMENT_ID,
      expectedHead: expectedMetadataHead(currentHead),
      currentHead: expectedMetadataHead(currentHead),
    });

    expect(metadata).toMatchObject({
      status: 'untrusted',
      reason: 'wrong-document',
      metadata: {
        documentId: COPIED_METADATA_DOCUMENT_ID,
      },
      trust: {
        status: 'untrusted',
        sidecarPart: MOG_VERSION_METADATA_PART,
        reason: 'wrong-document',
        redacted: true,
      },
      diagnostics: [
        expect.objectContaining({
          code: 'mogVersionMetadataUntrusted',
          reason: 'wrong-document',
          details: expect.objectContaining({
            reason: 'wrong-document',
            sidecarPart: MOG_VERSION_METADATA_PART,
            trusted: false,
            redacted: true,
          }),
        }),
      ],
    });
  });

  it('blocks Mog version metadata sidecar export when stale-head revision proof is missing', async () => {
    const unprovenHead = versionHead({ id: OLD_METADATA_COMMIT_ID });

    await expectMogMetadataExportBlocked(
      maybeAddMogVersionMetadataToXlsx(
        metadataExportContext({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          provider: metadataExportAuthorityProvider({
            documentId: METADATA_EXPORT_DOCUMENT_ID,
            head: unprovenHead,
          }),
        }),
        { getHead: async () => ({ ok: true, value: unprovenHead }) } as Parameters<
          typeof maybeAddMogVersionMetadataToXlsx
        >[1],
        await createSourceXlsx(),
        { versionMetadata: 'include' },
        blockedMetadataSink(),
      ),
      'head-unverified',
    );
  });

  it('blocks Mog version metadata sidecar export instead of serializing failed-head diagnostics', async () => {
    const leakSentinel = 'vc10-metadata-export-redaction-leak';
    const sinkWrites = { count: 0 };

    try {
      await maybeAddMogVersionMetadataToXlsx(
        metadataExportContext({ documentId: METADATA_EXPORT_DOCUMENT_ID }),
        {
          getHead: async () => ({
            ok: false,
            error: {
              code: 'target_unavailable',
              target: 'HEAD',
              diagnostics: [
                {
                  code: 'VERSION_TEST_HEAD_FAILURE',
                  severity: 'error',
                  message: leakSentinel,
                },
              ],
            },
          }),
        } as Parameters<typeof maybeAddMogVersionMetadataToXlsx>[1],
        await createSourceXlsx(),
        { versionMetadata: 'include' },
        blockedMetadataSink(sinkWrites),
      );
      throw new Error('expected metadata export to be blocked');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'MogSdkError',
        code: 'EXPORT_ERROR',
        operation: 'workbook.toXlsx',
        details: expect.objectContaining({ metadataIssue: 'redaction-failed' }),
      });
      expect(JSON.stringify(error)).not.toContain(leakSentinel);
      expect(JSON.stringify(error)).not.toContain('VERSION_TEST_HEAD_FAILURE');
      expect(JSON.stringify(error)).not.toContain('target_unavailable');
      expect(error).toMatchObject({
        details: {
          diagnostics: [
            expect.objectContaining({
              issueCode: 'VERSION_XLSX_METADATA_EXPORT_BLOCKED',
              safeMessage:
                'Mog version metadata export is blocked because the sidecar cannot be proven current and redacted.',
              redacted: true,
              payload: expect.objectContaining({
                reason: 'redaction-failed',
                redacted: true,
              }),
            }),
          ],
        },
      });
    }
    expect(sinkWrites.count).toBe(0);
  });
});

async function expectCleanExportOmitsImportedMetadata(
  options: Parameters<typeof maybeAddMogVersionMetadataToXlsx>[3],
): Promise<void> {
  const xlsxBytes = addMogVersionMetadataToXlsx(
    await createSourceXlsx(),
    testVersionMetadata({
      documentId: STALE_IMPORTED_DOCUMENT_ID,
      commitId: OLD_METADATA_COMMIT_ID,
    }),
  );

  const exported = await maybeAddMogVersionMetadataToXlsx(
    metadataExportContext({ documentId: CLEAN_EXPORT_DOCUMENT_ID }),
    {
      getHead: async () => {
        throw new Error('clean metadata export must not read the version head without opt-in');
      },
    } as Parameters<typeof maybeAddMogVersionMetadataToXlsx>[1],
    xlsxBytes,
    options,
    blockedMetadataSink(),
  );
  expect(
    readAndValidateMogVersionMetadataFromXlsx(exported, {
      expectedDocumentId: CLEAN_EXPORT_DOCUMENT_ID,
    }),
  ).toMatchObject({ status: 'absent' });
}

async function createSourceXlsx(): Promise<Uint8Array> {
  const wb = await createWorkbook({ documentId: SOURCE_DOCUMENT_ID, userTimezone: 'UTC' });
  try {
    await wb.activeSheet.setCell('A1', 'Metadata export gate');
    await wb.activeSheet.setCell('B1', 42);
    return wb.toXlsx();
  } finally {
    await wb.close('skipSave').catch(() => {
      wb.dispose();
    });
  }
}

function metadataExportContext(input: {
  readonly documentId: string;
  readonly provider?: unknown;
}): Parameters<typeof maybeAddMogVersionMetadataToXlsx>[0] {
  return {
    clock: { dateNow: () => Date.parse('2026-06-23T00:00:00.000Z') },
    workbookLinkScope: () => ({ requestingDocumentId: input.documentId }),
    ...(input.provider ? { versioning: { provider: input.provider } } : {}),
  } as Parameters<typeof maybeAddMogVersionMetadataToXlsx>[0];
}

function metadataExportAuthorityProvider(input: {
  readonly documentId: string;
  readonly head: VersionHead;
}) {
  return {
    documentScope: { documentId: input.documentId },
    accessContext: {},
    readGraphRegistry: async () => ({
      status: 'ok',
      registry: { currentGraphId: 'vc10-xlsx-metadata-export-gate-graph' },
    }),
    openGraph: async () => ({
      readHead: async () => ({ status: 'success', head: input.head }),
      readCommit: async () => ({
        status: 'success',
        commit: {
          payload: {
            semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
            snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
          },
        },
      }),
    }),
  };
}

async function expectMogMetadataExportBlocked(
  exportAttempt: Promise<Uint8Array>,
  metadataIssue: string,
): Promise<void> {
  await expect(exportAttempt).rejects.toMatchObject({
    name: 'MogSdkError',
    code: 'EXPORT_ERROR',
    operation: 'workbook.toXlsx',
    diagnostics: {
      domain: 'VERSION',
      issueCode: 'VERSION_XLSX_METADATA_EXPORT_BLOCKED',
      severity: 'error',
    },
    details: {
      issue: 'metadata-export-blocked',
      operation: 'workbook.toXlsx',
      metadataIssue,
      sidecarPart: MOG_VERSION_METADATA_PART,
      mutationGuarantee: 'no-write-attempted',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_XLSX_METADATA_EXPORT_BLOCKED',
          mutationGuarantee: 'no-write-attempted',
          redacted: true,
          payload: expect.objectContaining({
            operation: 'export',
            phase: 'export-sidecar',
            reason: metadataIssue,
            sidecarPart: MOG_VERSION_METADATA_PART,
            redacted: true,
          }),
        }),
      ]),
    },
  });
}

function blockedMetadataSink(
  writes: { count: number } = { count: 0 },
): MogVersionMetadataExportSink {
  return {
    write: () => {
      writes.count += 1;
      throw new Error('metadata export sink must not be called before authorization');
    },
  };
}

function recordingMetadataSink(
  captured: {
    writes: number;
    authorization?: MogVersionMetadataExportSinkAuthorization;
  },
  result: Uint8Array,
): MogVersionMetadataExportSink {
  return {
    write: (_xlsxBytes, authorization) => {
      captured.writes += 1;
      captured.authorization = authorization;
      return result;
    },
  };
}

function testVersionMetadata(input: {
  readonly documentId: string;
  readonly commitId: WorkbookCommitId;
}): MogWorkbookVersionXlsxMetadata {
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: '2026-06-23T00:00:00.000Z',
    documentId: input.documentId,
    head: {
      commitId: input.commitId,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
      refRevision: REF_REVISION,
      semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
      snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
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

function versionHead(input: {
  readonly id: WorkbookCommitId;
  readonly refRevision?: NonNullable<VersionHead['refRevision']>;
}): VersionHead {
  return {
    id: input.id,
    refName: 'refs/heads/main',
    resolvedFrom: 'HEAD',
    ...(input.refRevision ? { refRevision: input.refRevision } : {}),
  };
}

function expectedMetadataHead(head: VersionHead) {
  return {
    commitId: head.id,
    ...(head.refName ? { refName: head.refName } : {}),
    ...(head.resolvedFrom ? { resolvedFrom: head.resolvedFrom } : {}),
    ...(head.refRevision ? { refRevision: head.refRevision } : {}),
    semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
    snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
  };
}

function objectDigest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}
