import type { DocumentContext } from '../../../../context';
import {
  activeProviderWriteActivityStatus,
  failedProviderWriteActivityStatus,
  hasProviderWriteActivity,
  readAttachedProviderWriteActivity,
} from './provider-writes-activity';
import { readPersistedPendingRemoteProviderWrites } from './provider-writes-persisted';
import { combinePendingProviderWriteStatuses } from './provider-writes-status';
import type { VersionPendingProviderWritesStatus } from './provider-writes-types';

export type { VersionPendingProviderWritesStatus } from './provider-writes-types';

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
