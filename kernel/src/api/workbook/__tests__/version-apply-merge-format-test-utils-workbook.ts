import { DocumentFactory } from '../../document/document-factory';
import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import { DOCUMENT_ID, DOCUMENT_SCOPE } from './version-apply-merge-format-test-utils-constants';

export function createFormatDocumentHandle() {
  return DocumentFactory.create({
    documentId: DOCUMENT_ID,
    environment: 'headless',
    userTimezone: 'UTC',
  });
}

export function createFormatVersionStoreProvider() {
  return createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
}
