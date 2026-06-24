import type {
  VersionApplyMergeInput,
  VersionApplyMergeOptions,
  VersionApplyMergeResult,
  VersionCommitOptions,
  VersionMainRefName,
  VersionRecordRevision,
  VersionRefName,
  VersionRefSelector,
  VersionRevertInput,
  VersionRevertOptions,
  VersionRevertResult,
  VersionResult,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { WorkbookVersionImpl } from './version';
import type { VersionCheckoutTransactionGuard } from './version-checkout';

export interface WorkbookVersionDirtyTrackingState {
  readonly isDirty: boolean;
  readonly revision: number;
}

interface NormalCommitCaptureDirtyState {
  readonly pendingCapturedNormalMutationCount: number;
  readonly pendingUncapturedNormalMutationCount: number;
}

interface VersionSaveHeadToken {
  readonly commitId: string;
  readonly refName?: VersionMainRefName | VersionRefName;
  readonly resolvedFrom?: VersionRefSelector;
  readonly refRevision?: VersionRecordRevision;
  readonly source: 'runtime-head' | 'checkout-session';
}

type RuntimeSaveHeadTokenState = VersionSaveHeadToken | 'stale' | null;

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type WorkbookVersionContextSource = DocumentContext | (() => DocumentContext);

export class WorkbookVersionWithDirtyTracking extends WorkbookVersionImpl {
  private readonly readVersionContext: () => DocumentContext;

  constructor(
    ctx: WorkbookVersionContextSource,
    private readonly dirtyTracking: {
      readonly checkoutTransactionGuard?: VersionCheckoutTransactionGuard;
      readonly readState: () => WorkbookVersionDirtyTrackingState;
      readonly markCleanIfRevisionUnchanged: (revision: number) => boolean;
    },
  ) {
    super(ctx, {
      ...(dirtyTracking.checkoutTransactionGuard
        ? { checkoutTransactionGuard: dirtyTracking.checkoutTransactionGuard }
        : {}),
    });
    this.readVersionContext = typeof ctx === 'function' ? ctx : () => ctx;
  }

  override async commit(
    options: VersionCommitOptions = {},
  ): Promise<VersionResult<WorkbookCommitSummary>> {
    const beforeCommit = this.dirtyTracking.readState();
    const beforeSaveHead = await this.readCurrentRuntimeSaveHeadToken();
    const result = await super.commit(options);
    if (result.ok) {
      this.recordCheckoutBranchCommit(beforeSaveHead, options, result.value);
    }
    if (result.ok && (await this.canMarkCleanAfterCommit(beforeCommit, result.value))) {
      this.dirtyTracking.markCleanIfRevisionUnchanged(beforeCommit.revision);
    }
    return result;
  }

  override async applyMerge(
    input: VersionApplyMergeInput,
    options: VersionApplyMergeOptions = {},
  ): Promise<VersionResult<VersionApplyMergeResult>> {
    const beforeSaveHead = await this.readCurrentRuntimeSaveHeadToken();
    const result = await super.applyMerge(input, options);
    if (result.ok) {
      this.recordCheckoutBranchApplyMerge(beforeSaveHead, options, result.value);
    }
    return result;
  }

  override async revert(
    input: VersionRevertInput,
    options: VersionRevertOptions = {},
  ): Promise<VersionResult<VersionRevertResult>> {
    const beforeSaveHead = await this.readCurrentRuntimeSaveHeadToken();
    const result = await super.revert(input, options);
    if (result.ok) {
      this.recordCheckoutBranchRevert(beforeSaveHead, input, result.value);
    }
    return result;
  }

  private recordCheckoutBranchCommit(
    currentToken: RuntimeSaveHeadTokenState,
    options: VersionCommitOptions,
    commitSummary: WorkbookCommitSummary,
  ): void {
    if (currentToken === 'stale' || currentToken?.source !== 'checkout-session') return;
    if (!currentToken.refName) return;
    if (normalizeRefName(options.targetRef) !== currentToken.refName) return;

    const service = readSurfaceStatusService(this.readVersionContext());
    service?.recordActiveCheckoutBranchCommit?.({
      commitId: commitSummary.id,
      refName: currentToken.refName,
    });
  }

  private recordCheckoutBranchApplyMerge(
    currentToken: RuntimeSaveHeadTokenState,
    options: VersionApplyMergeOptions,
    result: VersionApplyMergeResult,
  ): void {
    if (options.materializeActiveCheckout) return;
    if (currentToken === 'stale' || currentToken?.source !== 'checkout-session') return;
    if (!currentToken.refName) return;
    const targetRef = normalizeRefName(result.targetRef ?? options.targetRef);
    if (targetRef !== currentToken.refName) return;
    if (!('commitRef' in result)) return;

    const service = readSurfaceStatusService(this.readVersionContext());
    service?.recordActiveCheckoutBranchRefMove?.({
      checkedOutCommitId: result.ours,
      refHeadCommitId: result.commitRef.id,
      refName: currentToken.refName,
    });
  }

  private recordCheckoutBranchRevert(
    currentToken: RuntimeSaveHeadTokenState,
    input: VersionRevertInput,
    result: VersionRevertResult,
  ): void {
    if (currentToken === 'stale' || currentToken?.source !== 'checkout-session') return;
    if (!currentToken.refName) return;
    if (result.status !== 'applied' || !result.commitRef) return;
    const targetRef = normalizeRefName(result.commitRef.refName ?? input.targetRef);
    if (targetRef !== currentToken.refName) return;

    const service = readSurfaceStatusService(this.readVersionContext());
    service?.recordActiveCheckoutBranchCommit?.({
      commitId: result.commitRef.id,
      refName: currentToken.refName,
    });
  }

  private async canMarkCleanAfterCommit(
    beforeCommit: WorkbookVersionDirtyTrackingState,
    commitSummary: WorkbookCommitSummary,
  ): Promise<boolean> {
    const afterCommit = this.dirtyTracking.readState();
    if (!afterCommit.isDirty) {
      return false;
    }
    if (afterCommit.revision !== beforeCommit.revision) {
      return false;
    }

    const captureState = readNormalCommitCaptureDirtyState(this.readVersionContext());
    if (captureState && !isNormalCommitCaptureDrained(captureState)) {
      return false;
    }

    return this.commitSaveHeadStillCurrent(commitSummary);
  }

  private async commitSaveHeadStillCurrent(commitSummary: WorkbookCommitSummary): Promise<boolean> {
    const currentToken = await this.readCurrentRuntimeSaveHeadToken();
    if (currentToken === 'stale') return false;
    if (currentToken === null) return true;
    return currentToken.commitId === commitSummary.id;
  }

  private async readCurrentRuntimeSaveHeadToken(): Promise<RuntimeSaveHeadTokenState> {
    try {
      const surface = await this.getSurfaceStatus();
      const current = surface.current;
      if (current.stale) return 'stale';
      if (!current.headCommitId) return null;

      const surfaceToken: VersionSaveHeadToken = {
        commitId: current.headCommitId,
        ...(current.branchName ? { refName: refNameFromBranchName(current.branchName) } : {}),
        source: current.checkedOutCommitId ? 'checkout-session' : 'runtime-head',
      };
      if (current.checkedOutCommitId) return surfaceToken;

      const head = await this.getHead();
      if (!head.ok) return surfaceToken;

      return {
        commitId: head.value.id,
        ...(head.value.refName ? { refName: head.value.refName } : {}),
        ...(head.value.resolvedFrom ? { resolvedFrom: head.value.resolvedFrom } : {}),
        ...(head.value.refRevision ? { refRevision: head.value.refRevision } : {}),
        source: 'runtime-head',
      };
    } catch {
      return null;
    }
  }
}

function refNameFromBranchName(branchName: string): VersionMainRefName | VersionRefName {
  return branchName === 'main' ? 'refs/heads/main' : (`refs/heads/${branchName}` as VersionRefName);
}

function normalizeRefName(value: unknown): VersionMainRefName | VersionRefName | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.startsWith('refs/heads/')
    ? (value as VersionMainRefName | VersionRefName)
    : (`refs/heads/${value}` as VersionMainRefName | VersionRefName);
}

function readSurfaceStatusService(ctx: DocumentContext): {
  readonly recordActiveCheckoutBranchCommit?: (input: {
    readonly commitId: string;
    readonly refName: string;
  }) => void;
  readonly recordActiveCheckoutBranchRefMove?: (input: {
    readonly checkedOutCommitId: string;
    readonly refHeadCommitId: string;
    readonly refName: string;
  }) => void;
} | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;
  for (const candidate of [
    services.surfaceStatusService,
    services.versionSurfaceStatusService,
    services.statusService,
    services.dirtyStatusService,
    services,
  ]) {
    if (!isRecord(candidate)) continue;
    const recordCommit = candidate.recordActiveCheckoutBranchCommit;
    const recordRefMove = candidate.recordActiveCheckoutBranchRefMove;
    if (typeof recordCommit !== 'function' && typeof recordRefMove !== 'function') continue;
    return {
      ...(typeof recordCommit === 'function'
        ? {
            recordActiveCheckoutBranchCommit: (input) => {
              Reflect.apply(recordCommit, candidate, [input]);
            },
          }
        : {}),
      ...(typeof recordRefMove === 'function'
        ? {
            recordActiveCheckoutBranchRefMove: (input) => {
              Reflect.apply(recordRefMove, candidate, [input]);
            },
          }
        : {}),
    };
  }
  return null;
}

function isNormalCommitCaptureDrained(captureState: NormalCommitCaptureDirtyState): boolean {
  return (
    captureState.pendingCapturedNormalMutationCount === 0 &&
    captureState.pendingUncapturedNormalMutationCount === 0
  );
}

function readNormalCommitCaptureDirtyState(
  ctx: DocumentContext,
): NormalCommitCaptureDirtyState | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;

  for (const candidate of [services.semanticMutationCapture, services.mutationCapture, services]) {
    const stateReader = readNormalCaptureStateMethod(candidate);
    if (stateReader) return stateReader();
  }

  return null;
}

function readNormalCaptureStateMethod(
  value: unknown,
): (() => NormalCommitCaptureDirtyState | null) | null {
  if (!isRecord(value)) return null;
  const method = value.readNormalCommitCaptureState;
  if (typeof method !== 'function') return null;
  return () => {
    const state = Reflect.apply(method, value, []) as unknown;
    return isNormalCommitCaptureDirtyState(state) ? state : null;
  };
}

function isNormalCommitCaptureDirtyState(value: unknown): value is NormalCommitCaptureDirtyState {
  return (
    isRecord(value) &&
    typeof value.pendingCapturedNormalMutationCount === 'number' &&
    typeof value.pendingUncapturedNormalMutationCount === 'number'
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
