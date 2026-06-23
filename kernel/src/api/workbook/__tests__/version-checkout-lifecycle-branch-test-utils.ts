import type { Workbook, WorkbookCommitSummary } from '@mog-sdk/contracts/api';

import type { VersionGraphInitializeResult } from '../../../document/version-store/provider';
import { DocumentFactory } from '../../document/document-factory';
import { DOCUMENT_SCOPE } from './version-checkout-lifecycle-test-utils';

type InitializedVersionGraph = Extract<VersionGraphInitializeResult, { status: 'success' }>;

export async function createBranchLifecycleDocumentHandle(): Promise<
  Awaited<ReturnType<typeof DocumentFactory.create>>
> {
  return DocumentFactory.create({
    documentId: DOCUMENT_SCOPE.documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
}

export async function commitActiveSheetBaseCell(input: {
  readonly wb: Workbook;
  readonly initialized: InitializedVersionGraph;
  readonly value: string;
  readonly errorLabel: string;
}): Promise<WorkbookCommitSummary> {
  const { wb, initialized, value, errorLabel } = input;
  await wb.activeSheet.setCell('A1', value);
  const baseCommitResult = await wb.version.commit({
    expectedHead: {
      commitId: initialized.rootCommit.id,
      revision: initialized.initialHead.revision,
      symbolicHeadRevision: initialized.symbolicHead.revision,
    },
  });
  if (!baseCommitResult.ok) {
    throw new Error(`expected ${errorLabel} commit success: ${baseCommitResult.error.code}`);
  }
  wb.markClean();
  return baseCommitResult.value;
}
