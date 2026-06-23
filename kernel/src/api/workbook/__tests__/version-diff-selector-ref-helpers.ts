import type { VersionSemanticDiffPage } from '@mog-sdk/contracts/api';

import { READ_REVISION } from './version-diff-selector-test-utils';

const SEMANTIC_CHANGE_ORDER = 'semantic-change-order' as const;

export function emptySemanticDiffSuccess() {
  return {
    status: 'success' as const,
    items: [],
    readRevision: READ_REVISION,
    order: SEMANTIC_CHANGE_ORDER,
    diagnostics: [],
  };
}

export function emptySemanticDiffPage(limit: number): VersionSemanticDiffPage {
  return {
    items: [],
    limit,
    readRevision: READ_REVISION,
    order: SEMANTIC_CHANGE_ORDER,
  };
}
