import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';
import type { WriteGate } from '../../document/write-gate';
import type { MutationResult } from './compute-types.gen';
import {
  classifyWriteOperation,
  type OperationAdmissionClassification,
  type OperationInvocationKind,
} from './operation-classification';
import {
  assertAdmittedSyncApplyContext,
  SyncApplyAdmissionError,
  type AdmittedSyncApplyContext,
} from './sync-apply-admission';
import { recordVersionMutationShadowObservation } from './version-shadow-observation';

export type MutationTuple = [Uint8Array, MutationResult];

export type DirectEditPosition = { sheetId: string; row: number; col: number };
export type DirectEditRange = {
  readonly sheetId: string;
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
};

export type MutationAdmissionDiagnosticCode =
  | 'versioning.admission.missing-context'
  | 'versioning.admission.blocked-write'
  | 'versioning.admission.unclassified-write'
  | 'versioning.shadow-observation.sink-error'
  | 'provenance.missingContext'
  | 'provenance.invalidContext'
  | 'provenance.legacyRawUnknown'
  | 'provenance.duplicateUpdate';

export interface MutationAdmissionDiagnostic {
  readonly code: MutationAdmissionDiagnosticCode;
  readonly severity: 'warning' | 'error';
  readonly command: string;
  readonly message: string;
  readonly classification?: OperationAdmissionClassification;
}

export interface MutationAdmissionOptions {
  readonly operationContext?: VersionOperationContext;
  readonly invocation?: OperationInvocationKind;
  readonly awaitMaterialization?: boolean;
  readonly directEditRanges?: readonly DirectEditRange[];
  readonly syncApplyContext?: AdmittedSyncApplyContext;
}

export interface VersionMutationCaptureRecordInput {
  readonly operation: string;
  readonly result: MutationResult;
  readonly directEdits?: readonly DirectEditPosition[];
  readonly directEditRanges?: readonly DirectEditRange[];
  readonly operationContext?: VersionOperationContext;
}

export interface VersionMutationCapturePreMutationInput {
  readonly operation: string;
  readonly directEdits?: readonly DirectEditPosition[];
  readonly directEditRanges?: readonly DirectEditRange[];
  readonly operationContext?: VersionOperationContext;
}

interface PublicWriteMaterializationContext {
  awaitMaterialized?: (scope?: SheetId | 'allSheets') => Promise<void>;
}

interface MutationAdmissionDiagnosticSink {
  record?(diagnostic: MutationAdmissionDiagnostic): void;
  push?(diagnostic: MutationAdmissionDiagnostic): void;
}

interface MutationAdmissionDiagnosticContext {
  versioningAdmissionDiagnostics?:
    | MutationAdmissionDiagnosticSink
    | ((diagnostic: MutationAdmissionDiagnostic) => void);
}

interface VersionMutationCaptureSink {
  recordPreMutation?(input: VersionMutationCapturePreMutationInput): void | Promise<void>;
  recordMutationResult?(input: VersionMutationCaptureRecordInput): void;
}

interface VersionMutationCaptureContext {
  versioning?: {
    readonly mutationCapture?: VersionMutationCaptureSink;
  };
}

const REQUIRED_VERSION_CONTEXT_PUBLIC_MUTATION_COMMANDS = new Set([
  'compute_batch_set_cells_by_position',
  'compute_create_sheet_with_default_col_width',
  'compute_delete_sheet',
  'compute_rename_compute_sheet',
  'compute_set_date_value',
  'compute_set_time_value',
]);

export function recordMutationAdmissionDiagnostic(
  ctx: IKernelContext,
  diagnostic: MutationAdmissionDiagnostic,
): void {
  const diagnosticContext = ctx as IKernelContext & MutationAdmissionDiagnosticContext;
  const sink = diagnosticContext.versioningAdmissionDiagnostics;
  if (typeof sink === 'function') {
    sink(diagnostic);
  } else {
    sink?.record?.(diagnostic);
    sink?.push?.(diagnostic);
  }
  (ctx.eventBus?.emit as unknown as ((eventName: string, payload: unknown) => void) | undefined)?.(
    'versioning:admission-diagnostic',
    diagnostic,
  );
}

export function recordVersionMutationCapture(
  ctx: IKernelContext,
  input: VersionMutationCaptureRecordInput,
): void {
  const normalizedInput = normalizeVersionMutationCaptureInput(input);
  try {
    const observation = recordVersionMutationShadowObservation(ctx, normalizedInput);
    if (isPromiseLike(observation)) {
      observation.catch(() => recordShadowObservationSinkDiagnostic(ctx, input.operation));
    }
  } catch {
    recordShadowObservationSinkDiagnostic(ctx, input.operation);
  }

  const capture = (ctx as IKernelContext & VersionMutationCaptureContext).versioning
    ?.mutationCapture;
  if (!capture?.recordMutationResult) return;
  if (shouldSkipContextlessSemanticCapture(normalizedInput)) return;
  try {
    capture.recordMutationResult(normalizedInput);
  } catch {
    (
      ctx.eventBus?.emit as unknown as ((eventName: string, payload: unknown) => void) | undefined
    )?.('versioning:mutation-capture-error', { operation: input.operation });
  }
}

function shouldSkipContextlessSemanticCapture(input: VersionMutationCaptureRecordInput): boolean {
  if (input.operationContext) return false;
  const classification = classifyWriteOperation(input.operation);
  if (!classification) return false;
  return (
    classification.capturePolicy !== 'commitEligible' ||
    classification.writeAdmissionMode !== 'capture'
  );
}

export async function prepareVersionMutationCapture(
  ctx: IKernelContext,
  inputOrOperation: VersionMutationCapturePreMutationInput | string,
  directEdits?: readonly DirectEditPosition[],
  options?: MutationAdmissionOptions,
): Promise<void> {
  const input =
    typeof inputOrOperation === 'string'
      ? versionMutationCapturePreMutationInput(inputOrOperation, directEdits, options)
      : inputOrOperation;
  const capture = (ctx as IKernelContext & VersionMutationCaptureContext).versioning
    ?.mutationCapture;
  if (!capture?.recordPreMutation) return;
  try {
    await capture.recordPreMutation(input);
  } catch {
    (
      ctx.eventBus?.emit as unknown as ((eventName: string, payload: unknown) => void) | undefined
    )?.('versioning:mutation-capture-error', { operation: input.operation, phase: 'pre-mutation' });
  }
}

function versionMutationCapturePreMutationInput(
  operation: string,
  directEdits?: readonly DirectEditPosition[],
  options?: MutationAdmissionOptions,
): VersionMutationCapturePreMutationInput {
  return {
    operation,
    ...(directEdits ? { directEdits } : {}),
    ...(options?.directEditRanges ? { directEditRanges: options.directEditRanges } : {}),
    ...(options?.operationContext ? { operationContext: options.operationContext } : {}),
  };
}

export function observeMutationAdmission(
  ctx: IKernelContext,
  operation: string,
  options: MutationAdmissionOptions = {},
): OperationAdmissionClassification | null {
  const classification = classifyWriteOperation(operation, options.invocation);
  if (!classification) {
    recordMutationAdmissionDiagnostic(ctx, {
      code: 'versioning.admission.unclassified-write',
      severity: 'error',
      command: operation,
      message: `No VC-02 operation classification registered for '${operation}'.`,
    });
    throw new Error(`No VC-02 operation classification registered for '${operation}'.`);
  }

  if (classification.writeAdmissionMode === 'block') {
    recordMutationAdmissionDiagnostic(ctx, {
      code: 'versioning.admission.blocked-write',
      severity: 'error',
      command: operation,
      classification,
      message: `VC-02 admission blocked '${operation}' before transport execution.`,
    });
    throw new Error(`VC-02 admission blocked '${operation}' before transport execution.`);
  }

  if (!options.operationContext) {
    const requiredContext = requiresCaptureVersionOperationContext(classification);
    recordMutationAdmissionDiagnostic(ctx, {
      code: 'versioning.admission.missing-context',
      severity: requiredContext ? 'error' : 'warning',
      command: operation,
      classification,
      message: requiredContext
        ? `No VersionOperationContext supplied for capture-required public mutation '${operation}'.`
        : `No VersionOperationContext supplied for '${operation}'.`,
    });
    if (requiredContext) {
      throw new Error(
        `VersionOperationContext is required for capture-required public mutation '${operation}'.`,
      );
    }
  }

  if (operation === 'compute_apply_sync_update') {
    try {
      assertAdmittedSyncApplyContext(options.syncApplyContext, operation);
    } catch (error) {
      const code =
        error instanceof SyncApplyAdmissionError
          ? error.code
          : ('provenance.invalidContext' as const);
      recordMutationAdmissionDiagnostic(ctx, {
        code,
        severity: 'error',
        command: operation,
        classification,
        message:
          code === 'provenance.missingContext'
            ? `No admitted sync provenance context supplied for '${operation}'.`
            : `Invalid admitted sync provenance context supplied for '${operation}'.`,
      });
      throw error;
    }
  }

  return classification;
}

function requiresCaptureVersionOperationContext(
  classification: OperationAdmissionClassification,
): boolean {
  return (
    REQUIRED_VERSION_CONTEXT_PUBLIC_MUTATION_COMMANDS.has(classification.command) &&
    classification.invocation === 'public-mutation' &&
    classification.capturePolicy === 'commitEligible' &&
    classification.writeAdmissionMode === 'capture'
  );
}

export async function admitPublicMutation(
  ctx: IKernelContext,
  writeGate: WriteGate | null,
  ensureInitialized: () => void,
  operation: string,
  options: MutationAdmissionOptions = {},
): Promise<void> {
  observeMutationAdmission(ctx, operation, {
    invocation: 'public-mutation',
    ...options,
  });
  ensureInitialized();
  writeGate?.assertWritable(operation);
  if (options.awaitMaterialization !== false) {
    await (ctx as IKernelContext & PublicWriteMaterializationContext).awaitMaterialized?.(
      'allSheets',
    );
  }
  writeGate?.assertWritable(operation);
}

export function runSystemMutation<T>(
  ctx: IKernelContext,
  writeGate: WriteGate | null,
  operation: string,
  run: () => Promise<T>,
  options: MutationAdmissionOptions = {},
): Promise<T> {
  observeMutationAdmission(ctx, operation, {
    invocation: 'system-mutation',
    ...options,
  });
  return writeGate ? writeGate.withBypass(run) : run();
}

export function withDirectEditRange(
  options: MutationAdmissionOptions | undefined,
  sheetId: string,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): MutationAdmissionOptions {
  const range: DirectEditRange = {
    sheetId,
    startRow: Math.min(startRow, endRow),
    startCol: Math.min(startCol, endCol),
    endRow: Math.max(startRow, endRow),
    endCol: Math.max(startCol, endCol),
  };
  return {
    ...options,
    directEditRanges: [...(options?.directEditRanges ?? []), range],
  };
}

function recordShadowObservationSinkDiagnostic(ctx: IKernelContext, operation: string): void {
  recordMutationAdmissionDiagnostic(ctx, {
    code: 'versioning.shadow-observation.sink-error',
    severity: 'warning',
    command: operation,
    message: `Version shadow observation sink failed for '${operation}'.`,
  });
}

function isPromiseLike(value: unknown): value is Promise<void> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { readonly catch?: unknown }).catch === 'function'
  );
}

function normalizeVersionMutationCaptureInput(
  input: VersionMutationCaptureRecordInput,
): VersionMutationCaptureRecordInput {
  if (
    input.operation !== 'compute_replace_all_in_range' ||
    input.directEdits !== undefined ||
    !input.directEditRanges?.length
  ) {
    return input;
  }

  const directEdits = (input.result.recalc?.changedCells ?? [])
    .filter((cell) => cell.position)
    .filter((cell) => isCellInDirectEditRanges(cell, input.directEditRanges ?? []))
    .filter((cell) => !isUnchangedFormulaRecalc(cell))
    .map((cell) => ({
      sheetId: cell.sheetId,
      row: cell.position!.row,
      col: cell.position!.col,
    }));

  return directEdits.length === 0 ? input : { ...input, directEdits };
}

type MutationCellChange = NonNullable<MutationResult['recalc']>['changedCells'][number];

function isCellInDirectEditRanges(
  cell: MutationCellChange,
  ranges: readonly DirectEditRange[],
): boolean {
  if (!cell.position) return false;
  return ranges.some(
    (range) =>
      range.sheetId === cell.sheetId &&
      cell.position !== undefined &&
      cell.position.row >= range.startRow &&
      cell.position.row <= range.endRow &&
      cell.position.col >= range.startCol &&
      cell.position.col <= range.endCol,
  );
}

function isUnchangedFormulaRecalc(cell: MutationCellChange): boolean {
  return (
    cell.oldFormula !== undefined &&
    cell.newFormula !== undefined &&
    cell.oldFormula === cell.newFormula
  );
}
