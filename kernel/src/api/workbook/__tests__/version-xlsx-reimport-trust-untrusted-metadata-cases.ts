import type { WorkbookCommitId } from '@mog-sdk/contracts/api';

import {
  addMogVersionMetadataToXlsx,
  type MogWorkbookVersionXlsxMetadataTrustReason,
} from '../xlsx-version-metadata';
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
import {
  createSourceXlsx,
  seedTrustedExport,
  type TrustedExportSeed,
} from './version-xlsx-reimport-trust-workbook';

export type UntrustedMetadataCase = {
  readonly name: string;
  readonly reason: MogWorkbookVersionXlsxMetadataTrustReason;
  readonly xlsx: (seed: TrustedExportSeed) => Promise<Uint8Array>;
};

export type UntrustedNewRootReimportScenario = {
  readonly xlsxBytes: Uint8Array;
  readonly expectedHeadCommitId: WorkbookCommitId;
  readonly reason: MogWorkbookVersionXlsxMetadataTrustReason;
  readonly expectedA1Value?: string;
  readonly unexpectedCommitIds?: readonly WorkbookCommitId[];
};

export async function createCopiedSidecarFromAnotherDocumentScenario(): Promise<UntrustedNewRootReimportScenario> {
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

  return {
    xlsxBytes: copiedSidecar,
    expectedHeadCommitId: targetSeed.rootCommitId,
    reason: 'wrong-document',
    expectedA1Value: 'Copied sidecar payload',
    unexpectedCommitIds: [copiedSource.rootCommitId],
  };
}

export function seedOriginalTrustedExport(): Promise<TrustedExportSeed> {
  return seedTrustedExport({
    documentId: DOCUMENT_ID,
    workspaceId: WORKSPACE_ID,
    a1Value: 'Original',
  });
}

export const UNTRUSTED_METADATA_CASES: UntrustedMetadataCase[] = [
  {
    name: 'copied',
    reason: 'wrong-document',
    xlsx: async (seed) =>
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
    reason: 'snapshot-root-mismatch',
    xlsx: async (seed) =>
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
    reason: 'wrong-workspace',
    xlsx: async (seed) =>
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
    reason: 'wrong-document',
    xlsx: async (seed) =>
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
    reason: 'invalid-schema',
    xlsx: async (seed) =>
      addMogVersionMetadataToXlsx(
        await createSourceXlsx('Malformed ref revision metadata'),
        testVersionMetadata({
          ...seed.metadata,
          head: { ...seed.metadata.head!, refRevision: { kind: 'counter', value: '01' } },
        }),
      ),
  },
];

export async function createForgedLexicalCommitMetadataXlsx(
  seed: TrustedExportSeed,
): Promise<Uint8Array> {
  return addMogVersionMetadataToXlsx(
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
}

export async function createRemoteAuthorityUnavailableMetadataXlsx(
  seed: TrustedExportSeed,
): Promise<Uint8Array> {
  return addMogVersionMetadataToXlsx(
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
}
