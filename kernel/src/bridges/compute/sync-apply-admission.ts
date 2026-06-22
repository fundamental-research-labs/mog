import type {
  SyncUpdateProvenance,
  SyncUpdateValidationDiagnostic,
} from '@mog-sdk/types-document/storage';

const ADMITTED_SYNC_APPLY_CONTEXT: unique symbol = Symbol('AdmittedSyncApplyContext');
const admittedSyncApplyContexts = new WeakSet<object>();

export type SyncApplyAdmissionErrorCode =
  | 'provenance.missingContext'
  | 'provenance.invalidContext';

export interface SyncApplyAdmissionContextInput {
  readonly source: string;
  readonly docId: string;
  readonly envelopeVersion: string;
  readonly providerRefId?: string;
  readonly providerEpoch?: string;
  readonly updateId?: string;
  readonly payloadHash: string;
  readonly provenance: SyncUpdateProvenance;
  readonly validationDiagnostics?: readonly SyncUpdateValidationDiagnostic[];
}

export interface AdmittedSyncApplyContext extends SyncApplyAdmissionContextInput {
  readonly validationDiagnostics: readonly SyncUpdateValidationDiagnostic[];
  readonly [ADMITTED_SYNC_APPLY_CONTEXT]: true;
}

export class SyncApplyAdmissionError extends Error {
  readonly code: SyncApplyAdmissionErrorCode;
  readonly command: string;

  constructor(command: string, code: SyncApplyAdmissionErrorCode) {
    super(`${command}: ${code}`);
    this.name = 'SyncApplyAdmissionError';
    this.command = command;
    this.code = code;
  }
}

export function createAdmittedSyncApplyContext(
  input: SyncApplyAdmissionContextInput,
): AdmittedSyncApplyContext {
  const context = Object.freeze({
    ...input,
    validationDiagnostics: input.validationDiagnostics ?? [],
    [ADMITTED_SYNC_APPLY_CONTEXT]: true,
  }) as AdmittedSyncApplyContext;
  admittedSyncApplyContexts.add(context);
  return context;
}

export function assertAdmittedSyncApplyContext(
  context: AdmittedSyncApplyContext | undefined,
  command = 'compute_apply_sync_update',
): asserts context is AdmittedSyncApplyContext {
  if (context === undefined) {
    throw new SyncApplyAdmissionError(command, 'provenance.missingContext');
  }
  if (typeof context !== 'object' || !admittedSyncApplyContexts.has(context)) {
    throw new SyncApplyAdmissionError(command, 'provenance.invalidContext');
  }
}

