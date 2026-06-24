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

export interface WorkbookVersionActiveCheckoutSessionSnapshot {
  readonly checkedOutCommitId: string;
  readonly branchName?: string;
  readonly refHeadAtMaterialization?: string;
  readonly detached: boolean;
}

export type WorkbookVersionActiveCheckoutStateChangeReason =
  | 'checkout-materialized'
  | 'branch-head-advanced'
  | 'branch-ref-moved';

export interface WorkbookVersionActiveCheckoutStateChangedEvent extends BaseEvent {
  readonly type: 'workbook:version-active-checkout-state-changed';
  readonly activeCheckoutSession: WorkbookVersionActiveCheckoutSessionSnapshot | null;
  readonly previousActiveCheckoutSession: WorkbookVersionActiveCheckoutSessionSnapshot | null;
  readonly statusRevision: number;
  readonly reason: WorkbookVersionActiveCheckoutStateChangeReason;
}

export type VersionEvent =
  | WorkbookVersionCheckoutMaterializedEvent
  | WorkbookVersionDirtyStatusChangedEvent
  | WorkbookVersionActiveCheckoutStateChangedEvent;
