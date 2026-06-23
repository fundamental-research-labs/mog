/**
 * Version-control lifecycle events.
 */

import type { BaseEvent } from '@mog/types-commands/event-base';

export interface WorkbookVersionCheckoutMaterializedEvent extends BaseEvent {
  readonly type: 'workbook:version-checkout-materialized';
  readonly commitId: string;
  readonly targetKind: 'commit' | 'ref' | 'head';
  readonly refName?: string;
}

export interface WorkbookVersionDirtyStatusChangedEvent extends BaseEvent {
  readonly type: 'workbook:version-dirty-status-changed';
  readonly hasUncommittedLocalChanges: boolean;
  readonly previousHasUncommittedLocalChanges: boolean;
  readonly statusRevision: number;
}

export type VersionEvent =
  | WorkbookVersionCheckoutMaterializedEvent
  | WorkbookVersionDirtyStatusChangedEvent;
