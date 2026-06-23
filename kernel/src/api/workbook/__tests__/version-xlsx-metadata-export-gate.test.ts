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
const STALE_IMPORTED_WORKSPACE_ID = 'vc10-xlsx-metadata-export-gate-stale-workspace';
const METADATA_EXPORT_WORKSPACE_ID = 'vc10-xlsx-metadata-export-gate-workspace';
const OTHER_METADATA_EXPORT_WORKSPACE_ID = 'vc10-xlsx-metadata-export-gate-other-workspace';
const COPIED_METADATA_DOCUMENT_ID = 'vc10-xlsx-metadata-export-gate-copied';
const METADATA_EXPORT_GRAPH_ID = 'vc10-xlsx-metadata-export-gate-graph';
const WRONG_METADATA_EXPORT_GRAPH_ID = 'vc10-xlsx-metadata-export-gate-wrong-graph';
const OLD_METADATA_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const OTHER_METADATA_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
const STALE_SOURCE_ROOT_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;
const SEMANTIC_CHANGE_SET_DIGEST = objectDigest('1');
const SNAPSHOT_ROOT_DIGEST = objectDigest('2');
const REF_REVISION = { kind: 'counter', value: '1' } as const;
const OTHER_REF_REVISION = { kind: 'counter', value: '2' } as const;
const STALE_IMPORTED_REF_REVISION = {
  kind: 'opaque',
  value: 'vc10-xlsx-metadata-export-gate-stale-ref-revision',
} as const;
const UNSAFE_AUTHORITY_DIAGNOSTICS = [
  { message: 'vc10-metadata-export-authority-leak', dependency: 'secret://authority' },
] as const;

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

  it('strips trusted-looking same-document Mog metadata on clean XLSX export without reading authority', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });
    const xlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx(),
      testVersionMetadata({
        documentId: CLEAN_EXPORT_DOCUMENT_ID,
        commitId: OLD_METADATA_COMMIT_ID,
      }),
    );
    const dirtyArchiveText = decodeUtf8(xlsxBytes);
    expect(dirtyArchiveText).toContain(CLEAN_EXPORT_DOCUMENT_ID);
    expect(dirtyArchiveText).toContain(OLD_METADATA_COMMIT_ID);
    expect(dirtyArchiveText).toContain(SEMANTIC_CHANGE_SET_DIGEST.digest);
    expect(dirtyArchiveText).toContain(SNAPSHOT_ROOT_DIGEST.digest);

    const sinkWrites = { count: 0 };
    const exported = await maybeAddMogVersionMetadataToXlsx(
      metadataExportContext({
        documentId: CLEAN_EXPORT_DOCUMENT_ID,
        provider: metadataExportAuthorityProvider({
          documentId: CLEAN_EXPORT_DOCUMENT_ID,
          head: currentHead,
        }),
      }),
      {
        getHead: async () => {
          throw new Error('clean metadata export must not read the version head without opt-in');
        },
      } as Parameters<typeof maybeAddMogVersionMetadataToXlsx>[1],
      xlsxBytes,
      { versionMetadata: 'omit' },
      blockedMetadataSink(sinkWrites),
    );

    expect(sinkWrites.count).toBe(0);
    expect(
      readAndValidateMogVersionMetadataFromXlsx(exported, {
        expectedDocumentId: CLEAN_EXPORT_DOCUMENT_ID,
      }),
    ).toMatchObject({ status: 'absent' });
    const cleanArchiveText = decodeUtf8(exported);
    expect(cleanArchiveText).not.toContain(OLD_METADATA_COMMIT_ID);
    expect(cleanArchiveText).not.toContain(SEMANTIC_CHANGE_SET_DIGEST.digest);
    expect(cleanArchiveText).not.toContain(SNAPSHOT_ROOT_DIGEST.digest);
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

  it('blocks Mog version metadata sidecar export when the exported ref revision is stale', async () => {
    const staleExportedHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: OTHER_REF_REVISION,
    });
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });

    await expectAuthorityExportBlocked(
      {
        exportedHead: staleExportedHead,
        provider: { documentId: METADATA_EXPORT_DOCUMENT_ID, head: currentHead },
      },
      'stale-head',
    );
  });

  it('blocks Mog version metadata sidecar export when the registry source root is stale', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });

    await expectMogMetadataExportBlocked(
      maybeAddMogVersionMetadataToXlsx(
        metadataExportContext({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          provider: metadataExportAuthorityProvider({
            documentId: METADATA_EXPORT_DOCUMENT_ID,
            head: currentHead,
            registryRootCommitId: STALE_SOURCE_ROOT_COMMIT_ID,
            sourceRootInClosure: false,
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

  it('blocks Mog version metadata sidecar export when the provider is bound to another document', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });

    await expectMogMetadataExportBlocked(
      maybeAddMogVersionMetadataToXlsx(
        metadataExportContext({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          provider: metadataExportAuthorityProvider({
            documentId: COPIED_METADATA_DOCUMENT_ID,
            head: currentHead,
          }),
        }),
        { getHead: async () => ({ ok: true, value: currentHead }) } as Parameters<
          typeof maybeAddMogVersionMetadataToXlsx
        >[1],
        await createSourceXlsx(),
        { versionMetadata: 'include' },
        blockedMetadataSink(),
      ),
      'head-unverified',
    );
  });

  it('blocks Mog version metadata sidecar export when the provider is bound to another workspace', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });

    await expectAuthorityExportBlocked(
      {
        contextWorkspaceId: METADATA_EXPORT_WORKSPACE_ID,
        provider: {
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          workspaceId: OTHER_METADATA_EXPORT_WORKSPACE_ID,
          head: currentHead,
        },
      },
      'head-unverified',
    );
  });

  it('blocks Mog version metadata sidecar export when the visible registry names another document', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });

    await expectMogMetadataExportBlocked(
      maybeAddMogVersionMetadataToXlsx(
        metadataExportContext({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          provider: metadataExportAuthorityProvider({
            documentId: METADATA_EXPORT_DOCUMENT_ID,
            head: currentHead,
            registryDocumentId: COPIED_METADATA_DOCUMENT_ID,
          }),
        }),
        { getHead: async () => ({ ok: true, value: currentHead }) } as Parameters<
          typeof maybeAddMogVersionMetadataToXlsx
        >[1],
        await createSourceXlsx(),
        { versionMetadata: 'include' },
        blockedMetadataSink(),
      ),
      'head-unverified',
    );
  });

  it.each([
    ['registry', { registryWorkspaceId: OTHER_METADATA_EXPORT_WORKSPACE_ID }],
    ['opened graph', { graphNamespaceWorkspaceId: OTHER_METADATA_EXPORT_WORKSPACE_ID }],
  ])(
    'blocks Mog version metadata sidecar export when the %s workspace is stale',
    async (_case, staleWorkspaceInput) => {
      const currentHead = versionHead({
        id: OLD_METADATA_COMMIT_ID,
        refRevision: REF_REVISION,
      });

      await expectAuthorityExportBlocked(
        {
          provider: {
            documentId: METADATA_EXPORT_DOCUMENT_ID,
            workspaceId: METADATA_EXPORT_WORKSPACE_ID,
            head: currentHead,
            ...staleWorkspaceInput,
          },
        },
        'head-unverified',
      );
    },
  );

  it('blocks Mog version metadata sidecar export when the opened graph identity is not the registry graph', async () => {
    const currentHead = versionHead({
      id: OLD_METADATA_COMMIT_ID,
      refRevision: REF_REVISION,
    });

    await expectMogMetadataExportBlocked(
      maybeAddMogVersionMetadataToXlsx(
        metadataExportContext({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          provider: metadataExportAuthorityProvider({
            documentId: METADATA_EXPORT_DOCUMENT_ID,
            head: currentHead,
            graphNamespaceGraphId: WRONG_METADATA_EXPORT_GRAPH_ID,
          }),
        }),
        { getHead: async () => ({ ok: true, value: currentHead }) } as Parameters<
          typeof maybeAddMogVersionMetadataToXlsx
        >[1],
        await createSourceXlsx(),
        { versionMetadata: 'include' },
        blockedMetadataSink(),
      ),
      'head-unverified',
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

  it('blocks Mog version metadata sidecar export when ref revision proof is malformed', async () => {
    const malformedRevisionHead = {
      ...versionHead({ id: OLD_METADATA_COMMIT_ID }),
      refRevision: { kind: 'counter', value: '01' },
    } satisfies VersionHead;

    await expectAuthorityExportBlocked(
      { provider: { documentId: METADATA_EXPORT_DOCUMENT_ID, head: malformedRevisionHead } },
      'head-unverified',
    );
  });

  it('blocks Mog version metadata sidecar export when commit identity is only lexical', async () => {
    const lexicalHead = {
      id: 'commit:sha256:not-a-real-commit-object' as WorkbookCommitId,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
      refRevision: REF_REVISION,
    } satisfies VersionHead;

    await expectMogMetadataExportBlocked(
      maybeAddMogVersionMetadataToXlsx(
        metadataExportContext({
          documentId: METADATA_EXPORT_DOCUMENT_ID,
          provider: metadataExportAuthorityProvider({
            documentId: METADATA_EXPORT_DOCUMENT_ID,
            head: versionHead({
              id: OLD_METADATA_COMMIT_ID,
              refRevision: REF_REVISION,
            }),
          }),
        }),
        { getHead: async () => ({ ok: true, value: lexicalHead }) } as Parameters<
          typeof maybeAddMogVersionMetadataToXlsx
        >[1],
        await createSourceXlsx(),
        { versionMetadata: 'include' },
        blockedMetadataSink(),
      ),
      'head-unverified',
    );
  });

  it.each([
    ['registry', { registryDiagnostics: UNSAFE_AUTHORITY_DIAGNOSTICS }],
    ['current head', { headDiagnostics: UNSAFE_AUTHORITY_DIAGNOSTICS }],
    ['commit closure', { closureDiagnostics: UNSAFE_AUTHORITY_DIAGNOSTICS }],
  ])(
    'blocks Mog version metadata sidecar export when %s authority has diagnostics',
    async (_case, diagnosticInput) => {
      const currentHead = versionHead({
        id: OLD_METADATA_COMMIT_ID,
        refRevision: REF_REVISION,
      });

      await expectAuthorityExportBlocked(
        {
          provider: {
            documentId: METADATA_EXPORT_DOCUMENT_ID,
            head: currentHead,
            ...diagnosticInput,
          },
        },
        'redaction-failed',
      );
    },
  );

  it('blocks Mog version metadata sidecar export instead of serializing failed-head diagnostics', async () => {
    const leakSentinel = 'vc10-metadata-export-redaction-leak';
    const externalPackageRef =
      'https://example.invalid/vc10-metadata-export-private-package-ref.xlsx?token=secret';
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
                  dependency: externalPackageRef,
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
      expect(JSON.stringify(error)).not.toContain(externalPackageRef);
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
      workspaceId: STALE_IMPORTED_WORKSPACE_ID,
      commitId: OTHER_METADATA_COMMIT_ID,
      refRevision: STALE_IMPORTED_REF_REVISION,
    }),
  );
  const staleMetadataArchiveText = decodeUtf8(xlsxBytes);
  expect(staleMetadataArchiveText).toContain(STALE_IMPORTED_DOCUMENT_ID);
  expect(staleMetadataArchiveText).toContain(STALE_IMPORTED_WORKSPACE_ID);
  expect(staleMetadataArchiveText).toContain(OTHER_METADATA_COMMIT_ID);
  expect(staleMetadataArchiveText).toContain(STALE_IMPORTED_REF_REVISION.value);

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
  const cleanArchiveText = decodeUtf8(exported);
  expect(cleanArchiveText).not.toContain(STALE_IMPORTED_DOCUMENT_ID);
  expect(cleanArchiveText).not.toContain(STALE_IMPORTED_WORKSPACE_ID);
  expect(cleanArchiveText).not.toContain(OTHER_METADATA_COMMIT_ID);
  expect(cleanArchiveText).not.toContain(STALE_IMPORTED_REF_REVISION.value);
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
  readonly workspaceId?: string;
  readonly provider?: unknown;
}): Parameters<typeof maybeAddMogVersionMetadataToXlsx>[0] {
  return {
    clock: { dateNow: () => Date.parse('2026-06-23T00:00:00.000Z') },
    workbookLinkScope: () => ({
      requestingDocumentId: input.documentId,
      ...(input.workspaceId ? { requestingWorkspaceId: input.workspaceId } : {}),
    }),
    ...(input.provider ? { versioning: { provider: input.provider } } : {}),
  } as Parameters<typeof maybeAddMogVersionMetadataToXlsx>[0];
}

function metadataExportAuthorityProvider(input: {
  readonly documentId: string;
  readonly workspaceId?: string;
  readonly head: VersionHead;
  readonly registryDocumentId?: string;
  readonly registryWorkspaceId?: string;
  readonly registryRootCommitId?: WorkbookCommitId;
  readonly sourceRootInClosure?: boolean;
  readonly graphNamespaceGraphId?: string;
  readonly graphNamespaceWorkspaceId?: string;
  readonly registryDiagnostics?: readonly unknown[];
  readonly headDiagnostics?: readonly unknown[];
  readonly closureDiagnostics?: readonly unknown[];
}) {
  const rootCommitId = input.registryRootCommitId ?? (input.head.id as WorkbookCommitId);
  const registryWorkspaceId = input.registryWorkspaceId ?? input.workspaceId;
  const graphWorkspaceId = input.graphNamespaceWorkspaceId ?? registryWorkspaceId;
  const graphNamespace = {
    ...(graphWorkspaceId ? { workspaceId: graphWorkspaceId } : {}),
    documentId: input.documentId,
    graphId: input.graphNamespaceGraphId ?? METADATA_EXPORT_GRAPH_ID,
  };
  const rootCommit = testCommit({
    id: rootCommitId,
    documentId: input.documentId,
    parentCommitIds: [],
  });
  const headCommit = testCommit({
    id: input.head.id as WorkbookCommitId,
    documentId: input.documentId,
    parentCommitIds: input.head.id === rootCommitId ? [] : [rootCommitId],
  });
  const commitClosure =
    input.sourceRootInClosure === false
      ? [headCommit]
      : input.head.id === rootCommitId
        ? [headCommit]
        : [headCommit, rootCommit];

  return {
    documentScope: {
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      documentId: input.documentId,
    },
    accessContext: {},
    readGraphRegistry: async () => ({
      status: 'ok',
      ...(input.registryDiagnostics ? { diagnostics: input.registryDiagnostics } : {}),
      registry: {
        ...(registryWorkspaceId ? { workspaceId: registryWorkspaceId } : {}),
        documentId: input.registryDocumentId ?? input.documentId,
        currentGraphId: METADATA_EXPORT_GRAPH_ID,
        rootCommitId,
      },
    }),
    openGraph: async () => ({
      namespace: graphNamespace,
      readHead: async () => ({
        status: 'success',
        head: input.head,
        ...(input.headDiagnostics ? { diagnostics: input.headDiagnostics } : {}),
      }),
      readCommitClosure: async () => ({
        status: 'success',
        commits: commitClosure,
        diagnostics: input.closureDiagnostics ?? [],
      }),
    }),
  };
}

async function expectAuthorityExportBlocked(
  input: {
    readonly contextWorkspaceId?: string;
    readonly exportedHead?: VersionHead;
    readonly provider: Parameters<typeof metadataExportAuthorityProvider>[0];
  },
  metadataIssue: string,
): Promise<void> {
  const exportedHead = input.exportedHead ?? input.provider.head;
  await expectMogMetadataExportBlocked(
    maybeAddMogVersionMetadataToXlsx(
      metadataExportContext({
        documentId: METADATA_EXPORT_DOCUMENT_ID,
        ...(input.contextWorkspaceId ? { workspaceId: input.contextWorkspaceId } : {}),
        provider: metadataExportAuthorityProvider(input.provider),
      }),
      { getHead: async () => ({ ok: true, value: exportedHead }) } as Parameters<
        typeof maybeAddMogVersionMetadataToXlsx
      >[1],
      await createSourceXlsx(),
      { versionMetadata: 'include' },
      blockedMetadataSink(),
    ),
    metadataIssue,
  );
}

function testCommit(input: {
  readonly id: WorkbookCommitId;
  readonly documentId: string;
  readonly parentCommitIds: readonly WorkbookCommitId[];
}) {
  return {
    id: input.id,
    payload: {
      documentId: input.documentId,
      parentCommitIds: input.parentCommitIds,
      semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
      snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
    },
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
  readonly workspaceId?: string;
  readonly commitId: WorkbookCommitId;
  readonly refRevision?: NonNullable<VersionHead['refRevision']>;
}): MogWorkbookVersionXlsxMetadata {
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: '2026-06-23T00:00:00.000Z',
    documentId: input.documentId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    head: {
      commitId: input.commitId,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
      refRevision: input.refRevision ?? REF_REVISION,
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

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}
