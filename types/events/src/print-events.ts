/**
 * Print & Page Setup Events
 *
 * Event types for print settings, page breaks, and PDF export.
 */

import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';

export interface PrintRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface PrintTitles {
  repeatRows?: [number, number];
  repeatCols?: [number, number];
}

export interface PageBreakEntry {
  id: number;
  min: number;
  max: number;
  manual: boolean;
  pt: boolean;
}

export interface PageBreaksChangedEvent extends BaseEvent {
  type: 'print:page-breaks-changed';
  sheetId: string;
  rowBreaks: PageBreakEntry[];
  colBreaks: PageBreakEntry[];
  source: StructureChangeSource;
}

export interface PrintAreaChangedEvent extends BaseEvent {
  type: 'print:area-changed';
  sheetId: string;
  printArea: PrintRange | null;
  source: StructureChangeSource;
}

export interface PrintTitlesChangedEvent extends BaseEvent {
  type: 'print:titles-changed';
  sheetId: string;
  printTitles: PrintTitles;
  source: StructureChangeSource;
}

export interface PageBreakDragStartEvent extends BaseEvent {
  type: 'print:page-break-drag-start';
  sheetId: string;
  breakType: 'horizontal' | 'vertical';
  originalPosition: number;
  isManual: boolean;
}

export interface PageBreakDragEndEvent extends BaseEvent {
  type: 'print:page-break-drag-end';
  sheetId: string;
  breakType: 'horizontal' | 'vertical';
  originalPosition: number;
  newPosition: number;
  isManual: boolean;
  cancelled: boolean;
}

export interface PdfExportProgressEvent extends BaseEvent {
  type: 'print:pdf-export-progress';
  sheetId: string;
  progress: number;
  stage: 'preparing' | 'rendering' | 'generating' | 'complete';
  message?: string;
}

export interface PdfExportCompleteEvent extends BaseEvent {
  type: 'print:pdf-export-complete';
  sheetId: string;
  success: boolean;
  error?: string;
  fileSize?: number;
  pageCount?: number;
}

export type PrintEvent =
  | PageBreaksChangedEvent
  | PrintAreaChangedEvent
  | PrintTitlesChangedEvent
  | PageBreakDragStartEvent
  | PageBreakDragEndEvent
  | PdfExportProgressEvent
  | PdfExportCompleteEvent;
