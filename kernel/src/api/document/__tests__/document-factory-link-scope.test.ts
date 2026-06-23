import { DocumentFactory, type DocumentHandleInternal } from '../document-factory';

function requestingDocumentId(handle: DocumentHandleInternal): string {
  return handle.context.workbookLinkScope().requestingDocumentId;
}

describe('DocumentFactory workbook link scope', () => {
  it('uses the generated document id for blank public document creation', async () => {
    const handle = await DocumentFactory.create({
      environment: 'headless',
      userTimezone: 'UTC',
    });

    try {
      const internalHandle = handle as DocumentHandleInternal;
      expect(requestingDocumentId(internalHandle)).toBe(handle.documentId);
      expect(requestingDocumentId(internalHandle)).not.toBe('unknown-document');
    } finally {
      await handle.disposeAsync();
    }
  });

  it('uses the requested document id for zero-arg workbook creation', async () => {
    const documentId = 'public-document-factory-link-scope';
    const handle = await DocumentFactory.create({
      documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });

    try {
      const internalHandle = handle as DocumentHandleInternal;
      const workbook = await handle.workbook();
      expect(requestingDocumentId(internalHandle)).toBe(documentId);
      await workbook.close('skipSave');
    } finally {
      if (!handle.isDisposed) {
        await handle.disposeAsync();
      }
    }
  });
});
