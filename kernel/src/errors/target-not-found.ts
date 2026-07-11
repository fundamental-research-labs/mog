import type { KernelErrorCode } from './codes';
import { KernelError } from './kernel-error';

export type TargetNotFoundCode = Extract<
  KernelErrorCode,
  | 'TABLE_NOT_FOUND'
  | 'COMMENT_NOT_FOUND'
  | 'CONDITIONAL_FORMAT_NOT_FOUND'
  | 'CONDITIONAL_FORMAT_RULE_NOT_FOUND'
  | 'VALIDATION_NOT_FOUND'
  | 'FILTER_NOT_FOUND'
  | 'PIVOT_NOT_FOUND'
  | 'SLICER_NOT_FOUND'
  | 'FORM_CONTROL_NOT_FOUND'
  | 'SPARKLINE_NOT_FOUND'
  | 'SPARKLINE_GROUP_NOT_FOUND'
  | 'HYPERLINK_NOT_FOUND'
  | 'OBJ_NOT_FOUND'
>;

export interface TargetNotFoundErrorOptions {
  readonly code: TargetNotFoundCode;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly operation?: string;
  readonly sheetId?: string;
  readonly path?: string[];
  readonly message?: string;
  readonly suggestion?: string;
  readonly context?: Record<string, unknown>;
  readonly cause?: unknown;
}

/** Build a typed missing-target error with the shared public resource context shape. */
export function targetNotFoundError(options: TargetNotFoundErrorOptions): KernelError {
  return new KernelError(
    options.code,
    options.message ?? `${options.resourceType} "${options.resourceId}" not found`,
    {
      path: options.path,
      suggestion: options.suggestion,
      context: {
        resourceType: options.resourceType,
        resourceId: options.resourceId,
        ...(options.operation ? { operation: options.operation } : {}),
        ...(options.sheetId ? { sheetId: options.sheetId } : {}),
        ...options.context,
      },
      cause: options.cause,
    },
  );
}
