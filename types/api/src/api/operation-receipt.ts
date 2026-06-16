/**
 * Shared operation receipt grammar for public API methods whose side effects
 * must be inspectable by callers and automation.
 */

export type OperationStatus =
  | 'completed'
  | 'applied'
  | 'noOp'
  | 'partial'
  | 'failed'
  | 'unsupported'
  | 'cancelled'
  | 'timedOut';

export type OperationEffectType =
  | 'computedGrid'
  | 'worksheetUnchanged'
  | 'storedMetadata'
  | 'materializedCells'
  | 'wroteStaticValues'
  | 'updatedConfig'
  | 'createdObject'
  | 'updatedObject'
  | 'removedObject'
  | 'renamedObject'
  | 'changedRange'
  | 'changedRows'
  | 'changedColumns'
  | 'changedVisibility'
  | 'changedFilterProjection'
  | 'changedValidation'
  | 'changedConditionalFormat'
  | 'changedSelectionTarget'
  | 'refreshedViewport'
  | 'invalidatedCache'
  | 'createdUndoEntry';

export interface OperationDiagnosticTarget {
  readonly sheetId?: string;
  readonly cellId?: string;
  readonly address?: string;
  readonly range?: string;
  readonly row?: number;
  readonly col?: number;
  readonly objectId?: string;
  readonly regionId?: string;
  readonly pivotId?: string;
  readonly placementId?: string;
  readonly calculatedFieldId?: string;
  readonly stage?: string;
}

export interface OperationDiagnostic {
  readonly severity: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly message: string;
  readonly target?: OperationDiagnosticTarget;
  readonly recoverable?: boolean;
  readonly nextAction?: string;
  readonly details?: Record<string, unknown>;
}

export interface OperationEffect {
  readonly type: OperationEffectType | (string & {});
  readonly sheetId?: string;
  readonly range?: string;
  readonly objectId?: string;
  readonly count?: number;
  readonly details?: Record<string, unknown>;
}

export interface OperationReceiptBase {
  readonly kind: string;
  readonly status: OperationStatus;
  readonly effects: readonly OperationEffect[];
  readonly diagnostics: readonly OperationDiagnostic[];
  readonly operationId?: string;
}

export interface OperationEffectMapping {
  readonly domainEffectType: string;
  readonly operationEffectType: OperationEffectType | (string & {});
  readonly description: string;
}
