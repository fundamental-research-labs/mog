import type {
  VersionCommitExpectedHead,
  VersionMainRefName,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { VERSION_GRAPH_MAIN_REF } from '../../../document/version-store/graph';
import type { ObjectDigest } from '../../../document/version-store/object-digest';
import type { VersionDocumentScope } from '../../../document/version-store/provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  documentId: 'vc08-persisted-merge-recovery',
};
export const CREATED_AT = '2026-06-23T00:00:00.000Z';

export const BASE = commitId('0');
export const OURS = commitId('1');
export const THEIRS = commitId('2');
export const MERGE = commitId('6');
export const ADVANCED = commitId('7');
export const RESULT_DIGEST = digest('3');
export const TARGET_REF = VERSION_GRAPH_MAIN_REF as VersionMainRefName;
export const EXPECTED_TARGET_HEAD: VersionCommitExpectedHead = {
  commitId: OURS,
  revision: { kind: 'counter', value: '1' },
};

export function commitId(seed: string): WorkbookCommitId {
  return `commit:sha256:${seed.repeat(64)}` as WorkbookCommitId;
}

export function digest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}

export function mutateDigest(value: ObjectDigest): ObjectDigest {
  return {
    algorithm: value.algorithm,
    digest: `${value.digest[0] === '0' ? '1' : '0'}${value.digest.slice(1)}`,
  };
}
