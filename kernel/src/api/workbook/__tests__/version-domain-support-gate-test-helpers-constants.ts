import type { VersionMergeInput } from '@mog-sdk/contracts/api';

export const BASE = `commit:sha256:${'1'.repeat(64)}` as VersionMergeInput['base'];
export const OURS = `commit:sha256:${'2'.repeat(64)}` as VersionMergeInput['ours'];
export const THEIRS = `commit:sha256:${'3'.repeat(64)}` as VersionMergeInput['theirs'];
export const TARGET_REF = 'refs/heads/main';
export const EXPECTED_TARGET_HEAD = {
  commitId: OURS,
  revision: { kind: 'counter' as const, value: '1' },
};
