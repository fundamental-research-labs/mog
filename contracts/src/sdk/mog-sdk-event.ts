/**
 * Stable SDK event contract.
 *
 * Public SDK events are mapped from internal SpreadsheetEvent types.
 * Internal event names and payloads can change freely; public SDK events
 * are versioned contract types with a stable envelope.
 */

import type { SheetId } from '../core';

// ---------------------------------------------------------------------------
// Event envelope
// ---------------------------------------------------------------------------

export interface MogSdkEvent<TPayload = unknown> {
  readonly type: MogSdkEventType;
  readonly version: 1;
  readonly documentId: string;
  readonly operationId?: string;
  readonly batchId?: string;
  readonly origin: MogSdkEventOrigin;
  readonly sequence: number;
  readonly timestamp: number;
  readonly scope: MogSdkEventScope;
  readonly payload: TPayload;
  readonly diagnostics?: Record<string, unknown>;
}

export type MogSdkEventOrigin = 'local' | 'remote' | 'system';

export type MogSdkEventScope =
  | { readonly kind: 'document' }
  | { readonly kind: 'sheet'; readonly sheetId: SheetId }
  | { readonly kind: 'range'; readonly sheetId: SheetId; readonly range: string };

// ---------------------------------------------------------------------------
// Stable event type families
// ---------------------------------------------------------------------------

export type MogSdkEventType =
  // Document lifecycle
  | 'document.created'
  | 'document.ready'
  | 'document.saving'
  | 'document.saved'
  | 'document.dirtyChanged'
  | 'document.closing'
  | 'document.closed'
  | 'document.error'

  // Structure
  | 'sheet.added'
  | 'sheet.removed'
  | 'sheet.moved'
  | 'sheet.renamed'
  | 'sheet.visibilityChanged'
  | 'sheet.activated'

  // Data
  | 'cell.changed'
  | 'cells.batchChanged'
  | 'range.changed'

  // Recalculation
  | 'recalc.started'
  | 'recalc.completed'

  // Table
  | 'table.created'
  | 'table.updated'
  | 'table.deleted'
  | 'table.resized'

  // Undo/redo
  | 'history.undone'
  | 'history.redone'
  | 'history.stateChanged'

  // Batch/transaction
  | 'batch.started'
  | 'batch.committed'
  | 'batch.failed'

  // Persistence
  | 'persistence.checkpointed'
  | 'persistence.flushed'
  | 'persistence.conflict'
  | 'persistence.providerError'

  // Collaboration
  | 'collaboration.attached'
  | 'collaboration.detached'
  | 'collaboration.remoteUpdatesApplied'
  | 'collaboration.conflict'
  | 'collaboration.checkpoint'

  // Security
  | 'security.policyChanged'
  | 'security.accessDenied'

  // Named ranges
  | 'name.created'
  | 'name.updated'
  | 'name.deleted'

  // Chart
  | 'chart.created'
  | 'chart.updated'
  | 'chart.deleted'

  // Filter
  | 'filter.applied'
  | 'filter.cleared'

  // Validation
  | 'validation.failed'
  | 'validation.passed'

  // Import/export
  | 'import.progress'
  | 'import.complete'
  | 'export.progress'
  | 'export.complete';

// ---------------------------------------------------------------------------
// Event payload types (keyed by event type)
// ---------------------------------------------------------------------------

export interface MogSdkEventPayloads {
  'document.created': { readonly documentId: string };
  'document.ready': { readonly documentId: string };
  'document.saving': { readonly documentId: string };
  'document.saved': { readonly documentId: string };
  'document.dirtyChanged': { readonly dirty: boolean };
  'document.closing': { readonly documentId: string };
  'document.closed': { readonly documentId: string };
  'document.error': { readonly error: string; readonly code?: string };

  'sheet.added': { readonly sheetId: SheetId; readonly name: string; readonly index: number };
  'sheet.removed': { readonly sheetId: SheetId; readonly name: string };
  'sheet.moved': {
    readonly sheetId: SheetId;
    readonly fromIndex: number;
    readonly toIndex: number;
  };
  'sheet.renamed': {
    readonly sheetId: SheetId;
    readonly oldName: string;
    readonly newName: string;
  };
  'sheet.visibilityChanged': { readonly sheetId: SheetId; readonly visible: boolean };
  'sheet.activated': { readonly sheetId: SheetId };

  'cell.changed': { readonly sheetId: SheetId; readonly row: number; readonly col: number };
  'cells.batchChanged': { readonly sheetId: SheetId; readonly count: number };
  'range.changed': { readonly sheetId: SheetId; readonly range: string };

  'recalc.started': Record<string, never>;
  'recalc.completed': { readonly changedCellCount: number };

  'table.created': { readonly sheetId: SheetId; readonly tableName: string };
  'table.updated': { readonly sheetId: SheetId; readonly tableName: string };
  'table.deleted': { readonly sheetId: SheetId; readonly tableName: string };
  'table.resized': { readonly sheetId: SheetId; readonly tableName: string };

  'history.undone': { readonly description?: string };
  'history.redone': { readonly description?: string };
  'history.stateChanged': { readonly canUndo: boolean; readonly canRedo: boolean };

  'batch.started': { readonly batchId: string; readonly label?: string };
  'batch.committed': { readonly batchId: string };
  'batch.failed': { readonly batchId: string; readonly error: string };

  'persistence.checkpointed': { readonly timestamp: number };
  'persistence.flushed': { readonly timestamp: number };
  'persistence.conflict': { readonly providerId: string };
  'persistence.providerError': { readonly providerId: string; readonly error: string };

  'collaboration.attached': { readonly participantId: string };
  'collaboration.detached': { readonly participantId: string };
  'collaboration.remoteUpdatesApplied': {
    readonly participantId: string;
    readonly updateCount: number;
  };
  'collaboration.conflict': { readonly participantId: string };
  'collaboration.checkpoint': { readonly timestamp: number };

  'security.policyChanged': { readonly policyId: string };
  'security.accessDenied': { readonly operation: string; readonly principal?: string };

  'name.created': { readonly name: string };
  'name.updated': { readonly name: string };
  'name.deleted': { readonly name: string };

  'chart.created': { readonly sheetId: SheetId; readonly chartId: string };
  'chart.updated': { readonly sheetId: SheetId; readonly chartId: string };
  'chart.deleted': { readonly sheetId: SheetId; readonly chartId: string };

  'filter.applied': { readonly sheetId: SheetId };
  'filter.cleared': { readonly sheetId: SheetId };

  'validation.failed': { readonly sheetId: SheetId; readonly address: string };
  'validation.passed': { readonly sheetId: SheetId; readonly address: string };

  'import.progress': { readonly phase: string; readonly percentage: number };
  'import.complete': { readonly sheetCount: number; readonly cellCount: number };
  'export.progress': { readonly phase: string; readonly percentage: number };
  'export.complete': { readonly byteSize: number };
}

// ---------------------------------------------------------------------------
// Typed event helper
// ---------------------------------------------------------------------------

export type TypedMogSdkEvent<K extends MogSdkEventType> = K extends keyof MogSdkEventPayloads
  ? MogSdkEvent<MogSdkEventPayloads[K]>
  : MogSdkEvent<unknown>;
