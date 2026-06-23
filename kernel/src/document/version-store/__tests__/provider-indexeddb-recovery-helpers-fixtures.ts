import { namespaceForDocumentScope } from '../provider';
import type { VersionDocumentScope, VersionGraphInitializeInput } from '../provider';
import { rootWrite } from './provider-indexeddb-test-utils';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-w8-04',
  documentId: 'document-w8-04',
  principalScope: 'principal-w8-04',
};

export const SECRET_DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-secret-w8-04',
  documentId: 'document-secret-w8-04',
  principalScope: 'principal-secret-w8-04',
};

export async function initializeInput(
  graphId: string,
  documentScope: VersionDocumentScope = DOCUMENT_SCOPE,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: await rootWrite('root', namespace),
  };
}
