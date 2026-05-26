/**
 * Recalculation Events
 *
 * Event types for formula recalculation.
 */

import type { BaseEvent } from '@mog/types-commands/event-base';

export interface RecalcStartedEvent extends BaseEvent {
  type: 'recalc:started';
  sheetId: string;
  cellCount: number;
}

export interface RecalcCompletedEvent extends BaseEvent {
  type: 'recalc:completed';
  sheetId: string;
  cellCount: number;
  durationMs: number;
  errors: number;
}

export type RecalcEvent = RecalcStartedEvent | RecalcCompletedEvent;
