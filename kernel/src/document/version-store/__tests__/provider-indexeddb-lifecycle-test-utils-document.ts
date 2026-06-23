import './provider-indexeddb-lifecycle-test-utils-mocks';

import {
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from '../../../api/workbook/__tests__/version-domain-support-test-utils';

const documentFactoryModule = await import('../../../api/document/document-factory');

export const DocumentFactory = documentFactoryModule.DocumentFactory;

type LifecycleVersioningConfig = Parameters<
  Awaited<ReturnType<typeof DocumentFactory.create>>['workbook']
>[0]['versioning'];

export async function createLifecycleDocumentHandle(documentId: string) {
  return DocumentFactory.create({
    documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
}

export async function openLifecycleWorkbook(
  documentId: string,
  versioning: NonNullable<LifecycleVersioningConfig>,
) {
  const handle = await createLifecycleDocumentHandle(documentId);
  const wb = await handle.workbook({ versioning: withVersionManifest(versioning) });
  installVersionDomainDetectorNoopsOnWorkbook(wb);
  return { handle, wb };
}
