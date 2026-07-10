import type { SheetId } from '@mog-sdk/contracts/core';
import { parseBridgeError } from '@mog/transport/bridge-error';

import { KernelError } from './kernel-error';

type NativeSlicerError = {
  readonly kind: string;
  readonly message?: string;
  readonly slicerId?: string;
  readonly receiverSheetId?: string;
  readonly requestedSheetId?: string;
};

export function slicerNotFoundError(
  sheetId: SheetId | undefined,
  slicerId: string,
  cause?: unknown,
): KernelError {
  return new KernelError('SLICER_NOT_FOUND', `Slicer "${slicerId}" not found`, {
    path: ['slicerId'],
    suggestion: 'Use worksheet.slicers.list() or getByName() to resolve a slicer ID.',
    context: {
      resourceType: 'slicer',
      resourceId: slicerId,
      ...(sheetId !== undefined ? { sheetId } : {}),
    },
    cause,
  });
}

export function slicerIdExistsError(slicerId: string, cause?: unknown): KernelError {
  return new KernelError('SLICER_ID_EXISTS', `A slicer with ID "${slicerId}" already exists`, {
    path: ['id'],
    suggestion: 'Omit id to generate a unique slicer ID, or provide a different explicit ID.',
    context: {
      resourceType: 'slicer',
      resourceId: slicerId,
    },
    cause,
  });
}

export function slicerSheetMismatchError(
  receiverSheetId: SheetId,
  requestedSheetId: string,
  cause?: unknown,
): KernelError {
  return new KernelError(
    'SLICER_SHEET_MISMATCH',
    `Slicer owner sheet "${requestedSheetId}" does not match receiver worksheet "${receiverSheetId}"`,
    {
      path: ['sheetId'],
      suggestion: 'Omit sheetId or use the receiver worksheet ID.',
      context: {
        receiverSheetId,
        requestedSheetId,
      },
      cause,
    },
  );
}

/** Convert native structured slicer errors into stable kernel-domain errors. */
export function translateNativeSlicerError(
  error: unknown,
  receiverSheetId: SheetId,
  requestedSlicerId?: string,
): unknown {
  const native = parseBridgeError(error) as NativeSlicerError | null;
  switch (native?.kind) {
    case 'SlicerNotFound':
      return slicerNotFoundError(
        receiverSheetId,
        requestedSlicerId ?? native.slicerId ?? '',
        error,
      );
    case 'SlicerIdConflict':
      return slicerIdExistsError(requestedSlicerId ?? native.slicerId ?? '', error);
    case 'SlicerSheetMismatch':
      return slicerSheetMismatchError(receiverSheetId, native.requestedSheetId ?? '', error);
    default:
      return error;
  }
}
