import type { Workbook } from '@mog-sdk/contracts/api';
import type { TrustedExportSeed } from './version-xlsx-reimport-trust-workbook-types';

import {
  addMogVersionMetadataToXlsx,
  readAndValidateMogVersionMetadataFromXlsx,
} from '../version/xlsx-metadata/xlsx-version-metadata';
import { readLocalExpectedHead } from './version-xlsx-reimport-trust-version-store';
import {
  createSourceXlsx,
  expectVersionHead,
  importXlsxWithVersioning,
  versioning,
} from './version-xlsx-reimport-trust-workbook-io';
import { trustedVersionMetadata } from './version-xlsx-reimport-trust-workbook-metadata';

export async function seedTrustedExport(input: {
  readonly documentId: string;
  readonly workspaceId?: string;
  readonly a1Value: string;
}): Promise<TrustedExportSeed> {
  const imported = await importXlsxWithVersioning({
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    xlsxBytes: await createSourceXlsx(input.a1Value),
  });
  expect(imported.success).toBe(true);
  if (!imported.success || !imported.handle) {
    throw new Error(`expected seed import success: ${imported.error?.message}`);
  }

  let wb: Workbook | undefined;
  try {
    wb = await imported.handle.workbook({ versioning: versioning(input.workspaceId) });
    const head = await expectVersionHead(wb);
    const expectedHead = await readLocalExpectedHead(input.documentId, input.workspaceId);
    const metadata = trustedVersionMetadata(input.documentId, input.workspaceId, expectedHead);
    const exported = addMogVersionMetadataToXlsx(await createSourceXlsx(input.a1Value), metadata);
    const validatedMetadata = readAndValidateMogVersionMetadataFromXlsx(exported, {
      expectedDocumentId: input.documentId,
      ...(input.workspaceId ? { expectedWorkspaceId: input.workspaceId } : {}),
      expectedHead,
    });
    expect(validatedMetadata).toMatchObject({ status: 'trusted' });
    if (validatedMetadata.status !== 'trusted') {
      throw new Error(`expected trusted seed metadata: ${validatedMetadata.status}`);
    }
    return {
      rootCommitId: head.id,
      exported,
      metadata: validatedMetadata.metadata,
    };
  } finally {
    await wb?.close('skipSave').catch(() => {});
    await imported.handle.dispose().catch(() => {});
  }
}
