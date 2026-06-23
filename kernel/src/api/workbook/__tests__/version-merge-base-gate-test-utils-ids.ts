import type { VersionMergeInput } from '@mog-sdk/contracts/api';

export function commitId(hexDigit: string): VersionMergeInput['base'] {
  return `commit:sha256:${hexDigit.repeat(64)}` as VersionMergeInput['base'];
}
