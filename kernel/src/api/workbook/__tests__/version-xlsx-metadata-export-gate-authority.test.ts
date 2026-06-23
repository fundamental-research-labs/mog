import 'fake-indexeddb/auto';

import type { VersionHead, WorkbookCommitId } from '@mog-sdk/contracts/api';

import { maybeAddMogVersionMetadataToXlsx } from '../xlsx-version-metadata';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import {
  blockedMetadataSink,
  COPIED_METADATA_DOCUMENT_ID,
  createSourceXlsx,
  expectAuthorityExportBlocked,
  expectMogMetadataExportBlocked,
  metadataExportAuthorityProvider,
  metadataExportContext,
  METADATA_EXPORT_DOCUMENT_ID,
  METADATA_EXPORT_GRAPH_ID,
  METADATA_EXPORT_WORKSPACE_ID,
  OLD_METADATA_COMMIT_ID,
  OTHER_METADATA_COMMIT_ID,
  OTHER_METADATA_EXPORT_WORKSPACE_ID,
  OTHER_REF_REVISION,
  REF_REVISION,
  STALE_SOURCE_ROOT_COMMIT_ID,
  UNSAFE_AUTHORITY_DIAGNOSTICS,
  versionHead,
} from './version-xlsx-metadata-export-gate-test-helpers';

beforeEach(deleteVersionStoreIndexedDbForTesting);
afterEach(deleteVersionStoreIndexedDbForTesting);

describe('VC-10 XLSX metadata export gating - authority rejection', () => {
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
