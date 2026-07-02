/**
 * Annotation Events
 *
 * Events for Mog-native annotation cache state. These are intentionally
 * separate from comments and notes.
 */

import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';

export interface CellAnnotationChangedEvent extends BaseEvent {
  type: 'cellAnnotation:changed';
  sheetId: string;
  row: number;
  col: number;
  anchorId: string;
  annotationId?: string;
  status?: 'fresh' | 'stale' | 'unchecked';
  action: 'set' | 'removed' | 'acceptedStale';
  source: StructureChangeSource;
}

export interface CellAnnotationsClearedEvent extends BaseEvent {
  type: 'cellAnnotations:cleared';
  sheetId: string;
  range?: {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  };
  source: StructureChangeSource;
}

export type AnnotationEvent = CellAnnotationChangedEvent | CellAnnotationsClearedEvent;
