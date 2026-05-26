/**
 * File I/O Events
 *
 * Event types for import/export progress.
 */

import type { BaseEvent } from '@mog/types-commands/event-base';

export type ExportPhase = 'cells' | 'formulas' | 'features' | 'packaging';

export interface ExportProgressEvent extends BaseEvent {
  type: 'export:progress';
  phase: ExportPhase;
  progress: number;
  currentSheet?: string;
}

export interface ExportCompleteEvent extends BaseEvent {
  type: 'export:complete';
  success: boolean;
  sheetCount: number;
  cellCount: number;
  fileSizeBytes: number;
  durationMs: number;
  error?: string;
}

export type ImportPhase = 'parsing' | 'cells' | 'formulas' | 'features' | 'finalizing';

export interface ImportProgressEvent extends BaseEvent {
  type: 'import:progress';
  phase: ImportPhase;
  progress: number;
  currentSheet?: string;
}

export interface ImportCompleteEvent extends BaseEvent {
  type: 'import:complete';
  success: boolean;
  sheetCount: number;
  cellCount: number;
  durationMs: number;
  error?: string;
}

export type FileIOEvent =
  | ExportProgressEvent
  | ExportCompleteEvent
  | ImportProgressEvent
  | ImportCompleteEvent;
