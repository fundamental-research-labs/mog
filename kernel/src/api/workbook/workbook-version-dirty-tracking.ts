import type {
  VersionCommitOptions,
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

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export class WorkbookVersionWithDirtyTracking extends WorkbookVersionImpl {
  private readonly versionContext: DocumentContext;

  constructor(
    ctx: DocumentContext,
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
    this.versionContext = ctx;
  }

  override async commit(
    options: VersionCommitOptions = {},
  ): Promise<VersionResult<WorkbookCommitSummary>> {
    const beforeCommit = this.dirtyTracking.readState();
    const result = await super.commit(options);
    if (result.ok && this.canMarkCleanAfterCommit(beforeCommit)) {
      this.dirtyTracking.markCleanIfRevisionUnchanged(beforeCommit.revision);
    }
    return result;
  }

  private canMarkCleanAfterCommit(beforeCommit: WorkbookVersionDirtyTrackingState): boolean {
    const afterCommit = this.dirtyTracking.readState();
    if (!afterCommit.isDirty) return false;
    if (afterCommit.revision !== beforeCommit.revision) return false;

    const captureState = readNormalCommitCaptureDirtyState(this.versionContext);
    if (!captureState) return true;
    return (
      captureState.pendingCapturedNormalMutationCount === 0 &&
      captureState.pendingUncapturedNormalMutationCount === 0
    );
  }
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
