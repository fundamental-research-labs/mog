import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory, type DocumentHandle } from '../../document/document-factory';
import { DOCUMENT_SCOPE } from './version-checkout-provider-lifecycle-test-utils';

export type ProviderIdentityLifecycleHandles = {
  readonly sourceHandle: DocumentHandle;
  readonly checkoutHandle: DocumentHandle;
};

export type ProviderIdentityLifecycleWorkbooks = {
  sourceWb?: Workbook;
  checkoutWb?: Workbook;
  reopenedWb?: Workbook;
};

export async function createProviderIdentityLifecycleHandles(): Promise<ProviderIdentityLifecycleHandles> {
  const sourceHandle = await DocumentFactory.create({
    documentId: DOCUMENT_SCOPE.documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
  const checkoutHandle = await DocumentFactory.create({
    documentId: DOCUMENT_SCOPE.documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
  return { sourceHandle, checkoutHandle };
}

export async function closeProviderIdentityLifecycleWorkbooks(
  workbooks: ProviderIdentityLifecycleWorkbooks,
): Promise<void> {
  if (workbooks.reopenedWb) await workbooks.reopenedWb.close('skipSave');
  if (workbooks.checkoutWb) await workbooks.checkoutWb.close('skipSave');
  if (workbooks.sourceWb) await workbooks.sourceWb.close('skipSave');
}
