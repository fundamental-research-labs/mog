import type { DocumentContext } from '../../../../context';
import type { ObjectDigest } from '../../../../bridges/compute/compute-types.gen';
import type { SemanticMutationCaptureWorkingTreeBasis } from '../../../../document/version-store/semantic-mutation-capture';
import type { VersionSemanticStateReaderPort } from '../../../../document/version-store/semantic-state-reader';
import type {
  WorkbookVersionSurfaceDirtyState,
  WorkbookVersionSurfaceSemanticDirtyState,
} from './version-surface-status-service-types';

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export async function readVersionSurfaceSemanticDirtyState(
  ctx: DocumentContext,
  dirtyState: WorkbookVersionSurfaceDirtyState,
): Promise<WorkbookVersionSurfaceSemanticDirtyState | null> {
  if (!dirtyState.hasUncommittedLocalChanges || dirtyState.calculationState !== 'done') {
    return null;
  }

  const services = getAttachedVersionServices(ctx);
  const readWorkingTreeBasis = readWorkingTreeBasisMethod(services);
  const semanticStateReader = readSemanticStateReader(services);
  if (!readWorkingTreeBasis || !semanticStateReader) return null;

  const basis = readWorkingTreeBasis();
  if (!basis.hasPendingNormalMutations || basis.hasUncapturedNormalMutations) return null;
  if (basis.semanticStateCaptureFailure || !basis.beforeSemanticState) return null;

  const currentSemanticState = await semanticStateReader.readCurrentSemanticState();
  const clean = sameDigest(basis.beforeSemanticState.stateDigest, currentSemanticState.stateDigest);
  const beforeDigest = digestRevisionToken(basis.beforeSemanticState.stateDigest);
  const currentDigest = digestRevisionToken(currentSemanticState.stateDigest);

  return {
    hasUncommittedLocalChanges: !clean,
    statusRevision: [
      `basis:${basis.revision}`,
      `captured:${basis.pendingCapturedNormalMutationCount}`,
      `before:${beforeDigest}`,
      `current:${currentDigest}`,
      `dirty:${clean ? 'no' : 'yes'}`,
    ].join(':'),
  };
}

function getAttachedVersionServices(ctx: DocumentContext): unknown {
  const runtime = ctx as MaybeVersionRuntimeContext;
  return runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
}

function readWorkingTreeBasisMethod(
  services: unknown,
): (() => SemanticMutationCaptureWorkingTreeBasis) | null {
  for (const candidate of candidateServices(services)) {
    if (!isRecord(candidate)) continue;
    const method = candidate.readWorkingTreeBasis;
    if (typeof method !== 'function') continue;
    return () => Reflect.apply(method, candidate, []) as SemanticMutationCaptureWorkingTreeBasis;
  }
  return null;
}

function readSemanticStateReader(services: unknown): VersionSemanticStateReaderPort | null {
  for (const candidate of candidateServices(services)) {
    if (!isRecord(candidate)) continue;
    const reader = candidate.semanticStateReader;
    if (isSemanticStateReader(reader)) return reader;
  }
  return null;
}

function candidateServices(services: unknown): readonly unknown[] {
  if (!isRecord(services)) return [];
  return [services.semanticMutationCapture, services.mutationCapture, services];
}

function isSemanticStateReader(value: unknown): value is VersionSemanticStateReaderPort {
  return (
    isRecord(value) &&
    typeof value.readCurrentSemanticState === 'function' &&
    typeof value.diffSemanticStates === 'function'
  );
}

function sameDigest(left: ObjectDigest, right: ObjectDigest): boolean {
  return (
    left.algorithm === 'sha256' &&
    right.algorithm === 'sha256' &&
    left.value.length > 0 &&
    left.value === right.value
  );
}

function digestRevisionToken(digest: ObjectDigest): string {
  if (digest.algorithm !== 'sha256' || digest.value.length === 0) return 'unavailable';
  return digest.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
