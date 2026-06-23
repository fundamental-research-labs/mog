import 'fake-indexeddb/auto';

import type { VersionHead, WorkbookCommitId } from '@mog-sdk/contracts/api';

import {
  addMogVersionMetadataToXlsx,
  maybeAddMogVersionMetadataToXlsx,
  MOG_VERSION_METADATA_PART,
  readAndValidateMogVersionMetadataFromXlsx,
} from '../xlsx-version-metadata';
import {
  authorizeMetadataSinkWrite,
  REQUIRED_MOG_VERSION_METADATA_REDACTION_OMISSIONS,
  type MogVersionMetadataExportSinkAuthorization,
} from '../version-xlsx-metadata-export-gate';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import {
  blockedMetadataSink,
  CLEAN_EXPORT_DOCUMENT_ID,
  COPIED_METADATA_DOCUMENT_ID,
  createSourceXlsx,
  decodeUtf8,
  expectAuthorityExportBlocked,
  expectCleanExportOmitsImportedMetadata,
  expectMogMetadataExportBlocked,
  expectedMetadataHead,
  metadataExportAuthorityProvider,
  metadataExportContext,
  METADATA_EXPORT_DOCUMENT_ID,
  METADATA_EXPORT_GRAPH_ID,
  METADATA_EXPORT_WORKSPACE_ID,
  objectDigest,
  OLD_METADATA_COMMIT_ID,
  OTHER_METADATA_COMMIT_ID,
  OTHER_METADATA_EXPORT_WORKSPACE_ID,
  OTHER_REF_REVISION,
  recordingMetadataSink,
  REF_REVISION,
  SEMANTIC_CHANGE_SET_DIGEST,
  SNAPSHOT_ROOT_DIGEST,
  STALE_IMPORTED_DOCUMENT_ID,
  STALE_SOURCE_ROOT_COMMIT_ID,
  testVersionMetadata,
  UNSAFE_AUTHORITY_DIAGNOSTICS,
  versionHead,
} from './version-xlsx-metadata-export-gate-test-helpers';

beforeEach(deleteVersionStoreIndexedDbForTesting);
afterEach(deleteVersionStoreIndexedDbForTesting);

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
          omitted: expect.arrayContaining(REQUIRED_MOG_VERSION_METADATA_REDACTION_OMISSIONS),
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
            graphNamespaceGraphId: `${METADATA_EXPORT_GRAPH_ID}-wrong`,
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
    const captured: { writes: number; authorization?: MogVersionMetadataExportSinkAuthorization } =
      { writes: 0 };
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
          omitted: expect.arrayContaining(REQUIRED_MOG_VERSION_METADATA_REDACTION_OMISSIONS),
        },
        head: {
          commitId: OLD_METADATA_COMMIT_ID,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
      },
    });
    const authorization = captured.authorization;
    if (!authorization) throw new Error('expected metadata sink authorization');
    const sinkAuthority = {
      currentHead: authorization.currentHead,
      semanticChangeSetDigest: authorization.objectStoreAuthority.semanticChangeSetDigest,
      snapshotRootDigest: authorization.objectStoreAuthority.snapshotRootDigest,
    };
    const metadata = authorization.metadata;
    for (const [unsafeMetadata, reason] of [
      [{ ...metadata, diagnostics: [{ message: 'secret' }] }, 'redaction-failed'],
      [
        { ...metadata, redaction: { ...metadata.redaction, omitted: ['authors'] } },
        'redaction-failed',
      ],
      [
        {
          ...metadata,
          head: { ...metadata.head!, commitId: 'commit:sha256:not-real' as VersionHead['id'] },
        },
        'head-unverified',
      ],
      [
        { ...metadata, head: { ...metadata.head!, refRevision: { kind: 'counter', value: '01' } } },
        'head-unverified',
      ],
      [
        { ...metadata, head: { ...metadata.head!, snapshotRootDigest: objectDigest('3') } },
        'head-unverified',
      ],
    ] as const) {
      expect(authorizeMetadataSinkWrite(unsafeMetadata, sinkAuthority)).toEqual({
        ok: false,
        reason,
      });
    }
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
    expect(JSON.stringify(metadata)).not.toContain(COPIED_METADATA_DOCUMENT_ID);
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
