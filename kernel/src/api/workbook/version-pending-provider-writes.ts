import type { DocumentContext } from '../../context';
import {
  activeProviderWriteActivityStatus,
  failedProviderWriteActivityStatus,
  hasProviderWriteActivity,
  readAttachedProviderWriteActivity,
} from './version-pending-provider-writes-activity';
import { readPersistedPendingRemoteProviderWrites } from './version-pending-provider-writes-persisted';
import { combinePendingProviderWriteStatuses } from './version-pending-provider-writes-status';
import type { VersionPendingProviderWritesStatus } from './version-pending-provider-writes-types';

export type { VersionPendingProviderWritesStatus } from './version-pending-provider-writes-types';

export async function readVersionPendingProviderWrites(
  ctx: DocumentContext,
): Promise<VersionPendingProviderWritesStatus> {
  const activity = readAttachedProviderWriteActivity(ctx);
  const persisted = await readPersistedPendingRemoteProviderWrites(ctx);
  if (activity.status === 'failed') {
    return combinePendingProviderWriteStatuses(
      failedProviderWriteActivityStatus(activity.data),
      persisted,
    );
  }
  if (activity.status === 'absent' || !hasProviderWriteActivity(activity.activity)) {
    return persisted;
  }
  return combinePendingProviderWriteStatuses(
    activeProviderWriteActivityStatus(activity.activity),
    persisted,
  );
}
