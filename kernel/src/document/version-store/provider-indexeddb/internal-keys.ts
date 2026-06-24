import type { WorkbookCommitId } from '../object-digest';
import type { VersionObjectRecord } from '../object-store';

export function objectKey(namespaceKey: string, record: VersionObjectRecord<unknown>): string {
  return `${namespaceKey}\u0000${record.digest.algorithm}\u0000${record.digest.digest}`;
}

export function refKey(namespaceKey: string, name: string): string {
  return `${namespaceKey}\u0000${name}`;
}

export function commitIndexKey(namespaceKey: string, commitId: WorkbookCommitId): string {
  return `${namespaceKey}\u0000${commitId}`;
}

export function parentLookupKey(namespaceKey: string, parentCommitId: WorkbookCommitId): string {
  return `${namespaceKey}\u0000${parentCommitId}`;
}

export function parentIndexKey(
  namespaceKey: string,
  parentCommitId: WorkbookCommitId,
  childCommitId: WorkbookCommitId,
): string {
  return `${namespaceKey}\u0000${parentCommitId}\u0000${childCommitId}`;
}
