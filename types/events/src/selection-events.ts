/**
 * Selection Events
 *
 * Event types for cell selection changes.
 */

import type { CellRange } from '@mog/types-core';
import type { BaseEvent } from '@mog/types-commands/event-base';

export interface SelectionChangedEvent extends BaseEvent {
  type: 'selection:changed';
  sheetId: string;
  userId?: string;
  oldSelection: CellRange | null;
  newSelection: CellRange | null;
}

export type SelectionEvent = SelectionChangedEvent;
