import { WorkbookVersionImpl } from '../version';
import { versionDomainSupportManifestRuntime } from './version-domain-support-test-utils';

export const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}`;
export const OURS_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
export const THEIRS_COMMIT_ID = `commit:sha256:${'3'.repeat(64)}`;

export const EXPECTED_TARGET_HEAD = {
  commitId: OURS_COMMIT_ID,
  revision: { kind: 'counter' as const, value: '1' },
};

export function workbookVersionWithMergeService(
  merge: unknown,
  manifestRuntime = versionDomainSupportManifestRuntime(),
) {
  return new WorkbookVersionImpl({
    versioning: {
      mergeService: { merge },
      ...manifestRuntime,
    },
  } as any);
}
