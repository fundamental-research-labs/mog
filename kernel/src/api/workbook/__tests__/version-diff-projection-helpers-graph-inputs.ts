import type { WorkbookCommitId } from '../../../document/version-store/object-digest';
import type { VersionGraphNamespace } from '../../../document/version-store/object-store';
import {
  namespaceForDocumentScope,
  type VersionGraphInitializeInput,
} from '../../../document/version-store/provider';
import type { RefVersion } from '../../../document/version-store/refs/ref-store';
import { AUTHOR, CREATED_AT, DOCUMENT_SCOPE } from './version-diff-projection-helpers-constants';
import { graphContentInput } from './version-diff-projection-helpers-records';
import { validSemanticPayload } from './version-diff-projection-fixtures';

export async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      ...(await graphContentInput(namespace, label, validSemanticPayload(label, []))),
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

export async function commitInput(
  namespace: VersionGraphNamespace,
  label: string,
  semanticPayload: unknown,
  expectedHeadCommitId: WorkbookCommitId,
  expectedRefVersion: RefVersion,
  options: {
    readonly targetRef?: string;
    readonly parentCommitIds?: readonly WorkbookCommitId[];
  } = {},
) {
  return {
    ...(await graphContentInput(namespace, label, semanticPayload)),
    ...(options.targetRef
      ? { targetRef: options.targetRef, expectedTargetRefVersion: expectedRefVersion }
      : { expectedMainRefVersion: expectedRefVersion }),
    ...(options.parentCommitIds ? { parentCommitIds: options.parentCommitIds } : {}),
    expectedHeadCommitId,
  };
}
