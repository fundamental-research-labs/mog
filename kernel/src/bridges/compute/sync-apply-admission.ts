import type {
  CapturePolicy,
  VersionActorKind,
  VersionOperationContext,
  VersionSyncCommitGrouping,
} from '@mog-sdk/contracts/versioning';
import type {
  SyncUpdateProvenance,
  SyncUpdateValidationDiagnostic,
} from '@mog-sdk/types-document/storage';
import type {
  SyncApplyOperationContextWire,
  VersionOperationContextWire,
  VersionSyncOperationContextWire,
} from './compute-types.gen';

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
  readonly operationContext: VersionOperationContext;
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
  const validationDiagnostics = input.validationDiagnostics ?? [];
  const operationContext = createSyncOperationContext(input, validationDiagnostics);
  const context = Object.freeze({
    ...input,
    validationDiagnostics,
    operationContext,
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

export function toSyncApplyOperationContextWire(
  context: AdmittedSyncApplyContext,
): SyncApplyOperationContextWire {
  return {
    operationContext: toVersionOperationContextWire(context.operationContext),
  };
}

function createSyncOperationContext(
  input: SyncApplyAdmissionContextInput,
  validationDiagnostics: readonly SyncUpdateValidationDiagnostic[],
): VersionOperationContext {
  const provenance = input.provenance;
  const identity = provenance.updateIdentity;
  const author = versionAuthorForProvenance(provenance);
  const capturePolicy = versionCapturePolicyForProvenance(provenance);
  const writeAdmissionMode =
    capturePolicy === 'commitEligible'
      ? 'capture'
      : capturePolicy === 'derivedOnly'
        ? 'shadowOnly'
        : 'captureDisabledNoHistory';
  const operationId = [
    'sync',
    provenance.sourceKind,
    identity.updateId ?? input.updateId ?? identity.payloadHash,
  ].join(':');

  return {
    operationId,
    kind: 'sync-import',
    author,
    createdAt: new Date().toISOString(),
    workbookId: input.docId,
    domainIds: ['runtime-diagnostics'],
    capturePolicy,
    writeAdmissionMode,
    collaboration: {
      sourceKind: provenance.sourceKind,
      originKind: identity.originKind,
      ...(identity.stableOriginId ? { stableOriginId: identity.stableOriginId } : {}),
      ...(identity.providerId ? { providerId: identity.providerId } : {}),
      ...(identity.providerKind ? { providerKind: identity.providerKind } : {}),
      ...(identity.authorityRef ? { authorityRef: identity.authorityRef } : {}),
      ...(identity.roomId ? { roomId: identity.roomId } : {}),
      ...(identity.epoch ? { epoch: identity.epoch } : {}),
      ...(identity.updateId ? { updateId: identity.updateId } : {}),
      ...(identity.sequence !== undefined ? { sequence: identity.sequence.toString() } : {}),
      payloadHash: identity.payloadHash,
      ...(identity.provenancePayloadHash
        ? { provenancePayloadHash: identity.provenancePayloadHash }
        : {}),
      trustStatus: provenance.trust.status,
      authorState: provenance.author.kind,
      ...(provenance.remoteSessionId ? { remoteSessionId: provenance.remoteSessionId } : {}),
      ...(provenance.correlationId ? { correlationId: provenance.correlationId } : {}),
      ...(provenance.causationIds?.length ? { causationIds: [...provenance.causationIds] } : {}),
      replay: provenance.replay,
      system: provenance.system,
      commitGrouping: commitGroupingForProvenance(provenance, validationDiagnostics),
      validationDiagnosticCount: validationDiagnostics.length,
      ...(provenance.exclusionDiagnostic?.reason
        ? { exclusionReason: provenance.exclusionDiagnostic.reason }
        : {}),
      ...(provenance.exclusionDiagnostic?.subreason
        ? { exclusionSubreason: provenance.exclusionDiagnostic.subreason }
        : {}),
    },
  };
}

function versionCapturePolicyForProvenance(provenance: SyncUpdateProvenance): CapturePolicy {
  switch (provenance.capturePolicy) {
    case 'commitEligible':
      return 'commitEligible';
    case 'derivedOnly':
      return 'derivedOnly';
    case 'excluded':
      return 'excluded';
  }
}

function versionAuthorForProvenance(provenance: SyncUpdateProvenance): {
  readonly authorId: string;
  readonly actorKind: VersionActorKind;
  readonly sessionId?: string;
} {
  switch (provenance.author.kind) {
    case 'singleRemote':
      return {
        authorId: provenance.author.remoteAuthorRef.value,
        actorKind: 'user',
        ...(provenance.remoteSessionId ? { sessionId: provenance.remoteSessionId } : {}),
      };
    case 'agent':
      return {
        authorId: provenance.author.agentRef.value,
        actorKind: 'automation',
        ...(provenance.remoteSessionId ? { sessionId: provenance.remoteSessionId } : {}),
      };
    case 'system':
      return {
        authorId: `sync:${provenance.author.systemRef}`,
        actorKind: 'system',
      };
    case 'mixedRemote':
      return {
        authorId: 'sync:mixed-remote',
        actorKind: 'system',
        ...(provenance.remoteSessionId ? { sessionId: provenance.remoteSessionId } : {}),
      };
    case 'unknown':
      return {
        authorId: `sync:unknown:${provenance.author.reason}`,
        actorKind: 'system',
        ...(provenance.remoteSessionId ? { sessionId: provenance.remoteSessionId } : {}),
      };
  }
}

function commitGroupingForProvenance(
  provenance: SyncUpdateProvenance,
  validationDiagnostics: readonly SyncUpdateValidationDiagnostic[],
): VersionSyncCommitGrouping {
  if (provenance.capturePolicy !== 'commitEligible') {
    return 'excludedLifecycle';
  }
  if (validationDiagnostics.some((diagnostic) => diagnostic.reason === 'missingRedactionKey')) {
    return 'blockedMissingRedactionKey';
  }
  if (provenance.trust.status !== 'verified') {
    return 'blockedUnverified';
  }
  if (provenance.author.kind === 'mixedRemote') {
    return 'blockedMixedRemote';
  }
  if (provenance.author.kind !== 'singleRemote') {
    return 'blockedUnknownRemote';
  }
  return 'pendingRemote';
}

function toVersionOperationContextWire(
  context: VersionOperationContext,
): VersionOperationContextWire {
  return {
    operationId: context.operationId,
    kind: context.kind,
    author: { ...context.author },
    createdAt: context.createdAt,
    ...(context.workbookId !== undefined ? { workbookId: context.workbookId } : {}),
    ...(context.sheetIds ? { sheetIds: [...context.sheetIds] } : {}),
    domainIds: [...context.domainIds],
    ...(context.groupId !== undefined ? { groupId: context.groupId } : {}),
    capturePolicy: context.capturePolicy,
    writeAdmissionMode: context.writeAdmissionMode,
    ...(context.clientRequestId !== undefined ? { clientRequestId: context.clientRequestId } : {}),
    ...(context.collaboration
      ? { collaboration: toVersionSyncOperationContextWire(context.collaboration) }
      : {}),
  };
}

function toVersionSyncOperationContextWire(
  context: NonNullable<VersionOperationContext['collaboration']>,
): VersionSyncOperationContextWire {
  return {
    sourceKind: context.sourceKind,
    originKind: context.originKind,
    ...(context.stableOriginId !== undefined ? { stableOriginId: context.stableOriginId } : {}),
    ...(context.providerId !== undefined ? { providerId: context.providerId } : {}),
    ...(context.providerKind !== undefined ? { providerKind: context.providerKind } : {}),
    ...(context.authorityRef !== undefined ? { authorityRef: context.authorityRef } : {}),
    ...(context.roomId !== undefined ? { roomId: context.roomId } : {}),
    ...(context.epoch !== undefined ? { epoch: context.epoch } : {}),
    ...(context.updateId !== undefined ? { updateId: context.updateId } : {}),
    ...(context.sequence !== undefined ? { sequence: context.sequence } : {}),
    payloadHash: context.payloadHash,
    ...(context.provenancePayloadHash !== undefined
      ? { provenancePayloadHash: context.provenancePayloadHash }
      : {}),
    trustStatus: context.trustStatus,
    authorState: context.authorState,
    ...(context.remoteSessionId !== undefined ? { remoteSessionId: context.remoteSessionId } : {}),
    ...(context.correlationId !== undefined ? { correlationId: context.correlationId } : {}),
    ...(context.causationIds ? { causationIds: [...context.causationIds] } : {}),
    replay: context.replay,
    system: context.system,
    commitGrouping: context.commitGrouping,
    validationDiagnosticCount: context.validationDiagnosticCount,
    ...(context.exclusionReason !== undefined ? { exclusionReason: context.exclusionReason } : {}),
    ...(context.exclusionSubreason !== undefined
      ? { exclusionSubreason: context.exclusionSubreason }
      : {}),
  };
}
