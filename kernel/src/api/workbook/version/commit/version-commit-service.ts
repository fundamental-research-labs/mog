import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { missingChangeSetDiagnostic } from './version-commit-diagnostics';
import type {
  AttachedVersionWriteService,
  BoundMethod,
  MaybePromise,
  MaybeVersionRuntimeContext,
  NormalCommitCaptureAdmissionState,
  VersionSurfaceDirtyAdmissionState,
} from './version-commit-types';
import { isRecord } from './version-commit-utils';

export function hasAttachedVersionWriteService(ctx: DocumentContext): boolean {
  return Boolean(getAttachedVersionWriteService(ctx)?.commit);
}

export function getAttachedVersionWriteService(
  ctx: DocumentContext,
): AttachedVersionWriteService | null {
  const services = getAttachedVersionServices(ctx);
  if (!isRecord(services)) return null;

  for (const candidate of [
    services.writeService,
    services.commitService,
    services.versionWriteService,
    services.publicService,
    services.graphService,
    services,
  ]) {
    const writeService = toWriteService(candidate);
    if (writeService) return writeService;
  }

  return null;
}

export async function normalCommitCaptureAdmissionDiagnostics(
  ctx: DocumentContext,
): Promise<readonly VersionStoreDiagnostic[]> {
  const captureState = readNormalCommitCaptureAdmissionState(ctx);
  if (!captureState) return [];

  const hasUncapturedNormalMutations = captureState.pendingUncapturedNormalMutationCount > 0;
  const hasCapturedNormalMutations = captureState.pendingCapturedNormalMutationCount > 0;
  const dirtyState = await readSurfaceDirtyAdmissionState(ctx);
  if (hasCapturedNormalMutations) {
    if (!getAttachedVersionWriteService(ctx)?.capturesNormalCommit) {
      return [missingChangeSetDiagnostic(captureState, dirtyState)];
    }
    return [];
  }
  if (!hasUncapturedNormalMutations && dirtyState?.hasUncommittedLocalChanges !== true) return [];

  return [missingChangeSetDiagnostic(captureState, dirtyState)];
}

function getAttachedVersionServices(ctx: DocumentContext): unknown {
  const runtime = ctx as MaybeVersionRuntimeContext;
  return runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
}

function toWriteService(value: unknown): AttachedVersionWriteService | null {
  if (isRawGraphStore(value)) return null;
  const commit = bindMethod(value, 'commit') ?? bindMethod(value, 'commitVersion');
  if (!commit) return null;
  return {
    commit: (options) => commit(options),
    ...(capturesNormalCommit(value) ? { capturesNormalCommit: true } : {}),
  };
}

function capturesNormalCommit(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.capturesNormalCommit === true || value.supportsNormalCommitCapture === true;
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function isRawGraphStore(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.commit === 'function' &&
    typeof value.initializeGraph === 'function' &&
    typeof value.readCommitClosure === 'function'
  );
}

function readNormalCommitCaptureAdmissionState(
  ctx: DocumentContext,
): NormalCommitCaptureAdmissionState | null {
  const services = getAttachedVersionServices(ctx);
  if (!isRecord(services)) return null;

  for (const candidate of [services.semanticMutationCapture, services.mutationCapture, services]) {
    const stateReader = readNormalCaptureStateMethod(candidate);
    if (stateReader) return stateReader();
  }

  return null;
}

function readNormalCaptureStateMethod(
  value: unknown,
): (() => NormalCommitCaptureAdmissionState | null) | null {
  if (!isRecord(value)) return null;
  const method = value.readNormalCommitCaptureState;
  if (typeof method !== 'function') return null;
  return () => {
    try {
      const state = Reflect.apply(method, value, []) as unknown;
      return isNormalCommitCaptureAdmissionState(state) ? state : null;
    } catch {
      return null;
    }
  };
}

function isNormalCommitCaptureAdmissionState(
  value: unknown,
): value is NormalCommitCaptureAdmissionState {
  return (
    isRecord(value) &&
    typeof value.pendingCapturedNormalMutationCount === 'number' &&
    typeof value.pendingUncapturedNormalMutationCount === 'number'
  );
}

async function readSurfaceDirtyAdmissionState(
  ctx: DocumentContext,
): Promise<VersionSurfaceDirtyAdmissionState | null> {
  const services = getAttachedVersionServices(ctx);
  if (!isRecord(services)) return null;

  for (const candidate of [
    services.surfaceStatusService,
    services.versionSurfaceStatusService,
    services.statusService,
    services.dirtyStatusService,
    services,
  ]) {
    const dirtyState = await readDirtyStateFromCandidate(candidate);
    if (dirtyState) return dirtyState;
  }

  return null;
}

async function readDirtyStateFromCandidate(
  value: unknown,
): Promise<VersionSurfaceDirtyAdmissionState | null> {
  if (!isRecord(value)) return null;
  const method = value.readDirtyStatus;
  if (typeof method !== 'function') return null;
  try {
    const dirtyStatus = await Reflect.apply(method, value, []);
    return isVersionSurfaceDirtyAdmissionState(dirtyStatus) ? dirtyStatus : null;
  } catch {
    return null;
  }
}

function isVersionSurfaceDirtyAdmissionState(
  value: unknown,
): value is VersionSurfaceDirtyAdmissionState {
  return isRecord(value) && typeof value.hasUncommittedLocalChanges === 'boolean';
}
