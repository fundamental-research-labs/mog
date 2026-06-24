import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { parseWorkbookCommitId, type WorkbookCommitId } from '../object-digest';
import { parseRefName } from '../refs/ref-name';
import {
  createInMemoryRefStore,
  type RefVersion,
  type TombstoneRefRecord,
} from '../refs/ref-store';

export const COMMIT_A = commit('aa');
export const COMMIT_B = commit('bb');
export const COMMIT_C = commit('cc');

export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

function commit(byte: string): WorkbookCommitId {
  return parseWorkbookCommitId(`commit:sha256:${byte.repeat(32)}`);
}

export function refVersion(value: string): RefVersion {
  return { kind: 'counter', value };
}

export function createStore(
  timestamps: readonly string[] = [],
): ReturnType<typeof createInMemoryRefStore> {
  const queue = [...timestamps];
  return createInMemoryRefStore({
    versionDocumentId: 'version-doc-1',
    now: () => queue.shift() ?? '2026-06-20T00:00:00.000Z',
  });
}

export function tombstoneFixture(name: string, deletedAt: string): TombstoneRefRecord {
  return Object.freeze({
    state: 'tombstone',
    schemaVersion: 1,
    versionDocumentId: 'version-doc-1',
    name: parseRefName(name),
    previousTargetCommitId: COMMIT_A,
    previousProviderRefId: 'provider-ref:version-doc-1:1',
    previousProviderEpoch: Object.freeze({ kind: 'counter', value: '0' }),
    previousRefIncarnationId: 'ref-incarnation:version-doc-1:2',
    deletedAt,
    deletedBy: AUTHOR,
    refVersion: refVersion('1'),
  });
}
