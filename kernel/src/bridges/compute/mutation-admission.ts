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

export type MutationTuple = [Uint8Array, MutationResult];

export type DirectEditPosition = { sheetId: string; row: number; col: number };

export type MutationAdmissionDiagnosticCode =
  | 'versioning.admission.missing-context'
  | 'versioning.admission.unclassified-write';

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
    return null;
  }

  if (!options.operationContext) {
    recordMutationAdmissionDiagnostic(ctx, {
      code: 'versioning.admission.missing-context',
      severity: 'warning',
      command: operation,
      classification,
      message: `No VersionOperationContext supplied for '${operation}'.`,
    });
  }

  return classification;
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
