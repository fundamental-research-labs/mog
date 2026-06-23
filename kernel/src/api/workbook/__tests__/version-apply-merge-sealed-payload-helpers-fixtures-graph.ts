import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
} from '../../../document/version-store/provider';
import { objectRecord } from './version-apply-merge-sealed-payload-helpers-records';

const DOCUMENT_ID = 'vc07-apply-merge-sealed-payload';
const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CREATED_AT = '2026-06-21T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export async function initializeInput(
  graphId: string,
  label: string,
  documentScope: VersionDocumentScope,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

export function documentScopeForGraph(graphId: string): VersionDocumentScope {
  return {
    workspaceId: `workspace-${graphId}`,
    documentId: `${DOCUMENT_ID}-${DOCUMENT_RUN_ID}-${graphId}`,
    principalScope: 'principal-user-1',
  };
}
