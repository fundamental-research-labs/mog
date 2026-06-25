import type { VersionMainRefName, VersionRefName, WorkbookCommitRef } from '@mog-sdk/contracts/api';

import {
  mapCommitId,
  mapPublicRevision,
  mapPublicTargetRef,
} from '../../../version-attempt-metadata';
import { VERSION_HEAD_REF } from './version-apply-merge-write-result-constants';
import { isRecord } from './version-apply-merge-write-result-shape';

export function mapWorkbookCommitRef(value: unknown): WorkbookCommitRef | null {
  if (!isRecord(value)) return null;
  const id = mapCommitId(value.id);
  if (!id) return null;

  const refName = value.refName === undefined ? undefined : mapPublicTargetRef(value.refName);
  const resolvedFrom =
    value.resolvedFrom === undefined ? undefined : mapPublicRefSelector(value.resolvedFrom);
  const refRevision =
    value.refRevision === undefined ? undefined : mapPublicRevision(value.refRevision);
  if (
    (value.refName !== undefined && !refName) ||
    (value.resolvedFrom !== undefined && !resolvedFrom) ||
    (value.refRevision !== undefined && !refRevision)
  ) {
    return null;
  }

  return {
    id,
    ...(refName ? { refName } : {}),
    ...(resolvedFrom ? { resolvedFrom } : {}),
    ...(refRevision ? { refRevision } : {}),
  };
}

function mapPublicRefSelector(
  value: unknown,
): typeof VERSION_HEAD_REF | VersionMainRefName | VersionRefName | undefined {
  if (value === VERSION_HEAD_REF) return VERSION_HEAD_REF;
  return mapPublicTargetRef(value);
}
