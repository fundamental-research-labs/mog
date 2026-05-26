/**
 * Store Events
 *
 * Event types for Yjs store lifecycle.
 */

import type { BaseEvent } from '@mog/types-commands/event-base';

export interface StoreReadyEvent extends BaseEvent {
  type: 'store:ready';
  sheetId: string;
  hadExistingData: boolean;
}

export interface StoreSyncErrorEvent extends BaseEvent {
  type: 'store:sync-error';
  error: string;
  recoverable: boolean;
}

export type StoreEvent = StoreReadyEvent | StoreSyncErrorEvent;
