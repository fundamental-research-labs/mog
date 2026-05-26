import type { SpreadsheetAppError } from './public-types';

export class SpreadsheetAppPublicError extends Error implements SpreadsheetAppError {
  readonly kind: SpreadsheetAppError['kind'];
  readonly recoverable: boolean;
  readonly runtimeId?: string;
  readonly attachmentId?: string;
  readonly workbookId?: string;
  readonly epoch?: number;
  readonly operation?: string;
  readonly actor?: SpreadsheetAppError['actor'];
  readonly staleHandleImpact?: SpreadsheetAppError['staleHandleImpact'];
  override readonly cause?: unknown;

  constructor(input: SpreadsheetAppError) {
    super(input.message);
    this.name = 'SpreadsheetAppError';
    this.kind = input.kind;
    this.recoverable = input.recoverable;
    this.runtimeId = input.runtimeId;
    this.attachmentId = input.attachmentId;
    this.workbookId = input.workbookId;
    this.epoch = input.epoch;
    this.operation = input.operation;
    this.actor = input.actor;
    this.staleHandleImpact = input.staleHandleImpact;
    this.cause = input.cause;
  }
}

export function toPublicError(
  error: unknown,
  kind: SpreadsheetAppError['kind'] = 'RuntimeError',
  recoverable = false,
  details: Partial<Omit<SpreadsheetAppError, 'kind' | 'message' | 'recoverable' | 'cause'>> = {},
): SpreadsheetAppPublicError {
  if (error instanceof SpreadsheetAppPublicError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new SpreadsheetAppPublicError({
    kind,
    message,
    recoverable,
    cause: error,
    ...details,
  });
}
