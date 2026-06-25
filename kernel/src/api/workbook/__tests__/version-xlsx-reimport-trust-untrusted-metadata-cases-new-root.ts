import { addMogVersionMetadataToXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';
import {
  COPIED_DOCUMENT_ID,
  DOCUMENT_ID,
  WORKSPACE_ID,
} from './version-xlsx-reimport-trust-constants';
import { createSourceXlsx, seedTrustedExport } from './version-xlsx-reimport-trust-workbook';
import type { UntrustedNewRootReimportScenario } from './version-xlsx-reimport-trust-untrusted-metadata-cases-types';

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
