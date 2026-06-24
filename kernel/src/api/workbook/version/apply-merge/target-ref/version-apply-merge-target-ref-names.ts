import type { VersionMainRefName, VersionRefName } from '@mog-sdk/contracts/api';

import { validateRefName } from '../../../../../document/version-store/refs/ref-name';

export const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
export const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';

export function mapPublicApplyTargetRef(
  value: unknown,
): VersionMainRefName | VersionRefName | undefined {
  if (typeof value !== 'string') return undefined;
  const branchName = value.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? value.slice(VERSION_BRANCH_REF_PREFIX.length)
    : value;
  const parsed = validateRefName(branchName, 'targetRef');
  if (!parsed.ok) return undefined;
  const targetRef =
    parsed.name === 'main'
      ? VERSION_MAIN_REF
      : (`${VERSION_BRANCH_REF_PREFIX}${parsed.name}` as VersionRefName);
  return targetRef;
}

export function isApplyTargetRefName(value: VersionMainRefName | VersionRefName): boolean {
  return value === VERSION_MAIN_REF || value.startsWith(VERSION_BRANCH_REF_PREFIX);
}
