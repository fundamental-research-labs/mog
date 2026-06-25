import { parseWorkbookCommitId, type WorkbookCommitId } from '../object-digest';
import type { RefVersion } from '../refs/ref-store';

export function commit(byte: string): WorkbookCommitId {
  return parseWorkbookCommitId(`commit:sha256:${byte.repeat(32)}`);
}

export function refVersion(value: string): RefVersion {
  return { kind: 'counter', value };
}
