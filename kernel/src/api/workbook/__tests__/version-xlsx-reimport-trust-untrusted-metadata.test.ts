import 'fake-indexeddb/auto';

import { addMogVersionMetadataToXlsx } from '../xlsx-version-metadata';
import { expectUntrustedNewRootReimport } from './version-xlsx-reimport-trust-assertions';
import {
  COPIED_DOCUMENT_ID,
  DOCUMENT_ID,
  OTHER_WORKSPACE_ID,
  WORKSPACE_ID,
  WRONG_DOCUMENT_ID,
} from './version-xlsx-reimport-trust-constants';
import {
  objectDigest,
  testVersionMetadata,
  workbookCommitId,
} from './version-xlsx-reimport-trust-metadata';
import { installXlsxReimportTrustVersionStoreHooks } from './version-xlsx-reimport-trust-setup';
import {
  createSourceXlsx,
  seedTrustedExport,
  type TrustedExportSeed,
} from './version-xlsx-reimport-trust-workbook';

installXlsxReimportTrustVersionStoreHooks();

describe('VC-10 XLSX trusted reimport untrusted metadata', () => {
  it('fails closed for a real copied sidecar from another document', async () => {
    const copiedSource = await seedTrustedExport({
      documentId: COPIED_DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      a1Value: 'Copied source',
    });
    const targetSeed = await seedTrustedExport({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      a1Value: 'Target original',
    });

    const copiedSidecar = addMogVersionMetadataToXlsx(
      await createSourceXlsx('Copied sidecar payload'),
      copiedSource.metadata,
    );

    await expectUntrustedNewRootReimport({
      xlsxBytes: copiedSidecar,
      expectedHeadCommitId: targetSeed.rootCommitId,
      reason: 'wrong-document',
      expectedA1Value: 'Copied sidecar payload',
      unexpectedCommitIds: [copiedSource.rootCommitId],
    });
  });

  it.each([
    {
      name: 'copied',
      reason: 'wrong-document' as const,
      xlsx: async (seed: TrustedExportSeed) =>
        addMogVersionMetadataToXlsx(
          await createSourceXlsx('Copied metadata'),
          testVersionMetadata({
            ...seed.metadata,
            documentId: COPIED_DOCUMENT_ID,
          }),
        ),
    },
    {
      name: 'wrong-root',
      reason: 'snapshot-root-mismatch' as const,
      xlsx: async (seed: TrustedExportSeed) =>
        addMogVersionMetadataToXlsx(
          await createSourceXlsx('Wrong root metadata'),
          testVersionMetadata({
            ...seed.metadata,
            head: {
              ...seed.metadata.head,
              snapshotRootDigest: objectDigest('f'),
            },
          }),
        ),
    },
    {
      name: 'wrong-workspace',
      reason: 'wrong-workspace' as const,
      xlsx: async (seed: TrustedExportSeed) =>
        addMogVersionMetadataToXlsx(
          await createSourceXlsx('Wrong workspace metadata'),
          testVersionMetadata({
            ...seed.metadata,
            workspaceId: OTHER_WORKSPACE_ID,
          }),
        ),
    },
    {
      name: 'wrong-document',
      reason: 'wrong-document' as const,
      xlsx: async (seed: TrustedExportSeed) =>
        addMogVersionMetadataToXlsx(
          await createSourceXlsx('Wrong document metadata'),
          testVersionMetadata({
            ...seed.metadata,
            documentId: WRONG_DOCUMENT_ID,
          }),
        ),
    },
    {
      name: 'malformed-ref-revision',
      reason: 'invalid-schema' as const,
      xlsx: async (seed: TrustedExportSeed) =>
        addMogVersionMetadataToXlsx(
          await createSourceXlsx('Malformed ref revision metadata'),
          testVersionMetadata({
            ...seed.metadata,
            head: { ...seed.metadata.head!, refRevision: { kind: 'counter', value: '01' } },
          }),
        ),
    },
  ])('fails closed for $name metadata', async ({ reason, xlsx }) => {
    const seed = await seedTrustedExport({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      a1Value: 'Original',
    });

    await expectUntrustedNewRootReimport({
      xlsxBytes: await xlsx(seed),
      expectedHeadCommitId: seed.rootCommitId,
      reason,
    });
  });

  it('fails closed for a forged lexical commit id that is absent from the selected graph', async () => {
    const seed = await seedTrustedExport({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      a1Value: 'Original',
    });
    const forgedLexicalCommit = addMogVersionMetadataToXlsx(
      await createSourceXlsx('Forged lexical commit'),
      testVersionMetadata({
        ...seed.metadata,
        head: seed.metadata.head
          ? {
              ...seed.metadata.head,
              commitId: workbookCommitId('f'),
            }
          : null,
      }),
    );

    await expectUntrustedNewRootReimport({
      xlsxBytes: forgedLexicalCommit,
      expectedHeadCommitId: seed.rootCommitId,
      reason: 'commit-missing',
    });
  });

  it('fails closed when trusted remote metadata authority is unavailable', async () => {
    const seed = await seedTrustedExport({
      documentId: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      a1Value: 'Original',
    });
    const remoteOnlyMetadata = addMogVersionMetadataToXlsx(
      await createSourceXlsx('Remote authority unavailable'),
      testVersionMetadata({
        ...seed.metadata,
        head: seed.metadata.head
          ? {
              ...seed.metadata.head,
              refName: 'remote/trusted-main',
              resolvedFrom: 'trusted-remote',
              refRevision: { kind: 'opaque', value: 'remote-revision-1' },
            }
          : null,
      }),
    );

    await expectUntrustedNewRootReimport({
      xlsxBytes: remoteOnlyMetadata,
      expectedHeadCommitId: seed.rootCommitId,
      reason: 'head-unverified',
    });
  });
});
