import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { createInMemoryBranchService } from '../../../document/version-store/branch-service';
import {
  parseWorkbookCommitId,
  type WorkbookCommitId,
} from '../../../document/version-store/object-digest';
import {
  createInMemoryRefStore,
  type RefVersion,
} from '../../../document/version-store/refs/ref-store';
import { WorkbookVersionImpl } from '../version';

export const CREATED_AT = '2026-06-20T00:00:00.000Z';

export const COMMIT_A = commit('aa');
export const COMMIT_B = commit('bb');
export const COMMIT_C = commit('cc');

export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export function commit(byte: string): WorkbookCommitId {
  return parseWorkbookCommitId(`commit:sha256:${byte.repeat(32)}`);
}

export function refVersion(value: string): RefVersion {
  return { kind: 'counter', value };
}

export function createWorkbookVersionWithBranchService(headRefName?: string | null) {
  const refStore = createInMemoryRefStore({
    versionDocumentId: 'version-doc-1',
    now: () => CREATED_AT,
  });
  const main = refStore.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR });
  if (!main.ok) throw new Error(`expected main initialization: ${main.error.code}`);

  const branchService = createInMemoryBranchService({
    refStore,
    ...(headRefName !== undefined ? { headRefName } : {}),
  });
  const version = new WorkbookVersionImpl({
    versioning: { branchService },
  } as any);

  return { branchService, refStore, version };
}
