import type { Workbook, WorkbookCommitId } from '@mog-sdk/contracts/api';

import type { MogWorkbookVersionXlsxMetadataTrustReason } from '../version/xlsx-metadata/xlsx-version-metadata';
import { DOCUMENT_ID, WORKSPACE_ID } from './version-xlsx-reimport-trust-constants';
import { expectMetadataWarning } from './version-xlsx-reimport-trust-metadata';
import { expectImportBranchCounts } from './version-xlsx-reimport-trust-version-store';
import { importXlsxWithVersioning, versioning } from './version-xlsx-reimport-trust-workbook';

export async function expectUntrustedNewRootReimport(input: {
  readonly xlsxBytes: Uint8Array;
  readonly expectedHeadCommitId: WorkbookCommitId;
  readonly reason: MogWorkbookVersionXlsxMetadataTrustReason;
  readonly expectedA1Value?: string;
  readonly unexpectedCommitIds?: readonly WorkbookCommitId[];
}) {
  const imported = await importXlsxWithVersioning({
    documentId: DOCUMENT_ID,
    workspaceId: WORKSPACE_ID,
    xlsxBytes: input.xlsxBytes,
  });
  expect(imported.success).toBe(true);
  if (!imported.success || !imported.handle) {
    throw new Error(`expected untrusted reimport success: ${imported.error?.message}`);
  }
  expectMetadataWarning(imported.warnings, input.reason);
  const warningsJson = JSON.stringify(imported.warnings);
  expect(warningsJson).not.toContain('commit:sha256:');
  expect(warningsJson).not.toContain(DOCUMENT_ID);
  expect(warningsJson).not.toContain(WORKSPACE_ID);

  let wb: Workbook | undefined;
  try {
    wb = await imported.handle.workbook({ versioning: versioning(WORKSPACE_ID) });
    if (input.expectedA1Value) {
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: input.expectedA1Value,
      });
    }
    await expect(wb.version.getHead()).resolves.toMatchObject({
      ok: true,
      value: { id: input.expectedHeadCommitId },
    });
    await expect(wb.version.listCommits()).resolves.toMatchObject({
      ok: true,
      value: { items: [expect.objectContaining({ id: input.expectedHeadCommitId })] },
    });

    await expectImportBranchCounts(DOCUMENT_ID, WORKSPACE_ID, {
      externalChange: 0,
      newRoot: 0,
    });
    const commits = await wb.version.listCommits();
    expect(commits).toMatchObject({ ok: true });
    if (commits.ok) {
      for (const commitId of input.unexpectedCommitIds ?? []) {
        expect(commits.value.items).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ id: commitId })]),
        );
      }
    }
  } finally {
    await wb?.close('skipSave').catch(() => {});
    await imported.handle.dispose().catch(() => {});
  }
}
