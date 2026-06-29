import type { VersionDiagnostic, VersionSurfaceStatus } from '@mog-sdk/contracts/api';

import type { CheckoutSnapshotApplyInput } from '../../../../document/version-store/checkout-apply';
import type { VersionLiveCollaborationDirtyStatus } from '../live-collaboration/version-live-collaboration-status';
import type { VersionPendingProviderWritesStatus } from '../pending/provider-writes';
import { readVersionSurfacePendingProviderWritesStatus } from './version-surface-status-service-provider-writes';
import { projectDirtyStatus } from './version-surface-status-dirty-projector';
import type {
  AttachedVersionSurfaceStatusService,
  CreateWorkbookVersionSurfaceStatusServiceInput,
  VersionSurfaceActiveCheckoutStateChangeReason,
  VersionSurfaceCheckoutSession,
  WorkbookVersionSurfaceDirtyState,
  WorkbookVersionSurfaceSemanticDirtyState,
  WorkbookVersionSurfaceStatusService,
} from './version-surface-status-service-types';
import {
  dedupeDiagnostics,
  diagnosticArray,
  surfaceDiagnostic,
} from './version-surface-status-utils';

export function createWorkbookVersionSurfaceStatusService(
  input: CreateWorkbookVersionSurfaceStatusServiceInput,
): WorkbookVersionSurfaceStatusService {
  let activeCheckoutSession: VersionSurfaceCheckoutSession | null = null;
  let activeCheckoutStatusRevision = 0;

  const setActiveCheckoutSession = (
    nextSession: VersionSurfaceCheckoutSession,
    reason: VersionSurfaceActiveCheckoutStateChangeReason,
    options: { readonly notifyWhenUnchanged?: boolean } = {},
  ): void => {
    const next = freezeCheckoutSession(nextSession);
    const previous = activeCheckoutSession;
    const changed = !checkoutSessionsEqual(previous, next);
    if (!changed && !options.notifyWhenUnchanged) return;
    if (changed) activeCheckoutSession = next;
    activeCheckoutStatusRevision += 1;
    input.notifyActiveCheckoutStateChanged?.({
      activeCheckoutSession: cloneCheckoutSession(next),
      previousActiveCheckoutSession: cloneCheckoutSession(previous),
      statusRevision: activeCheckoutStatusRevision,
      reason,
    });
  };

  return {
    readDirtyStatus: async () => {
      const dirtyState = input.readDirtyState();
      const semanticDirtyState = await readSemanticDirtyState(input, dirtyState);
      return dirtyStatusFromState(
        dirtyState,
        input.readPendingProviderWrites
          ? await readVersionSurfacePendingProviderWritesStatus(
              input.readPendingProviderWrites,
              diagnosticArray,
            )
          : cleanPendingProviderWrites(),
        input.readLiveCollaborationStatus
          ? await input.readLiveCollaborationStatus()
          : cleanLiveCollaborationStatus(),
        semanticDirtyState,
      );
    },
    readActiveCheckoutSession: () => cloneCheckoutSession(activeCheckoutSession),
    restoreActiveCheckoutMaterialization: (session) => {
      if (activeCheckoutSession) return cloneCheckoutSession(activeCheckoutSession);
      const restored = restorableCheckoutSession(session);
      if (!restored) return null;
      activeCheckoutSession = restored;
      return cloneCheckoutSession(activeCheckoutSession);
    },
    recordCheckoutMaterialization: (materialization) => {
      setActiveCheckoutSession(
        checkoutSessionFromMaterialization(materialization),
        'checkout-materialized',
      );
    },
    recordActiveCheckoutBranchCommit: (materialization) => {
      const branchName = branchNameFromRefName(materialization.refName);
      if (!branchName) return;
      setActiveCheckoutSession(
        {
          checkedOutCommitId: materialization.commitId,
          branchName,
          refHeadAtMaterialization: materialization.commitId,
          detached: false,
        },
        'branch-head-advanced',
      );
    },
    recordActiveCheckoutBranchRefMove: (move) => {
      const branchName = branchNameFromRefName(move.refName);
      if (!branchName) return;
      setActiveCheckoutSession(
        {
          checkedOutCommitId: move.checkedOutCommitId,
          branchName,
          refHeadAtMaterialization: move.refHeadCommitId,
          detached: false,
        },
        'branch-ref-moved',
        { notifyWhenUnchanged: true },
      );
    },
  };
}

export async function readVersionSurfaceDirtyStatus(
  service: AttachedVersionSurfaceStatusService | null,
  diagnostics: VersionDiagnostic[],
): Promise<VersionSurfaceStatus['dirty']> {
  if (!service?.readDirtyStatus) return conservativeDirtyStatus();
  try {
    const status = projectDirtyStatus(await service.readDirtyStatus());
    if (status) return status;
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.dirtyStatusInvalid',
        'warning',
        'The attached VC-05 dirty status service returned an invalid payload.',
      ),
    );
  } catch {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.dirtyStatusFailed',
        'warning',
        'The attached VC-05 dirty status service failed.',
      ),
    );
  }
  return conservativeDirtyStatus();
}

export function conservativeDirtyStatus(): VersionSurfaceStatus['dirty'] {
  const diagnostic = surfaceDiagnostic(
    'version.surfaceStatus.dirtyTokenUnavailable',
    'warning',
    'VC-05 dirty checkout preflight tokens are not attached; checkout is disabled conservatively.',
  );
  return {
    statusRevision: 'VC-05-dirty-status-unavailable',
    checkoutPreflightToken: 'VC-05-checkout-preflight-unavailable',
    hasUncommittedLocalChanges: false,
    commitEligibleChanges: false,
    unsupportedDirtyDomains: ['unknown'],
    pendingProviderWrites: false,
    pendingRecalc: false,
    checkoutSafe: false,
    unsafeReasons: [diagnostic],
    source: 'VC-05',
    diagnostics: [diagnostic],
  };
}

function checkoutSessionFromMaterialization(
  input: CheckoutSnapshotApplyInput,
): VersionSurfaceCheckoutSession {
  const target = input.resolvedTarget;
  if (target.kind === 'commit') {
    return {
      checkedOutCommitId: input.commitId,
      detached: true,
    };
  }

  return {
    checkedOutCommitId: input.commitId,
    branchName: target.refName,
    refHeadAtMaterialization: target.commitId,
    detached: false,
  };
}

function cloneCheckoutSession(
  session: VersionSurfaceCheckoutSession | null,
): VersionSurfaceCheckoutSession | null {
  return session === null ? null : freezeCheckoutSession(session);
}

function freezeCheckoutSession(
  session: VersionSurfaceCheckoutSession,
): VersionSurfaceCheckoutSession {
  return Object.freeze({ ...session });
}

function restorableCheckoutSession(
  session: VersionSurfaceCheckoutSession,
): VersionSurfaceCheckoutSession | null {
  if (session.detached) {
    return session.checkedOutCommitId ? freezeCheckoutSession(session) : null;
  }
  if (!session.branchName || !session.refHeadAtMaterialization) return null;
  return freezeCheckoutSession(session);
}

function checkoutSessionsEqual(
  left: VersionSurfaceCheckoutSession | null,
  right: VersionSurfaceCheckoutSession | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  return (
    left.checkedOutCommitId === right.checkedOutCommitId &&
    left.branchName === right.branchName &&
    left.refHeadAtMaterialization === right.refHeadAtMaterialization &&
    left.detached === right.detached
  );
}

function branchNameFromRefName(refName: string): string | null {
  const prefix = 'refs/heads/';
  if (refName === 'main') return 'main';
  if (refName.startsWith(prefix)) return refName.slice(prefix.length);
  return refName.length > 0 ? refName : null;
}

function dirtyStatusFromState(
  state: WorkbookVersionSurfaceDirtyState,
  providerWrites: VersionPendingProviderWritesStatus,
  liveCollaboration: VersionLiveCollaborationDirtyStatus,
  semanticDirtyState: WorkbookVersionSurfaceSemanticDirtyState | null,
): VersionSurfaceStatus['dirty'] {
  const pendingRecalc = state.calculationState !== 'done';
  const hasUncommittedLocalChanges =
    semanticDirtyState?.hasUncommittedLocalChanges ?? state.hasUncommittedLocalChanges;
  const unsupportedDirtyDomains: readonly string[] = [];
  const unsafeReasons = [
    ...(hasUncommittedLocalChanges
      ? [
          diagnostic(
            'version.surfaceStatus.dirtyWorkingState',
            'warning',
            'Workbook has uncommitted local changes; checkout would discard them.',
          ),
        ]
      : []),
    ...(pendingRecalc
      ? [
          diagnostic(
            'version.surfaceStatus.pendingRecalc',
            'warning',
            'Workbook recalculation is not settled; checkout preflight is unsafe.',
          ),
        ]
      : []),
    ...(state.checkoutInProgress
      ? [
          diagnostic(
            'version.surfaceStatus.checkoutInProgress',
            'warning',
            'A checkout transaction is already in progress for this workbook.',
          ),
        ]
      : []),
    ...(state.commitInProgress
      ? [
          diagnostic(
            'version.surfaceStatus.commitInProgress',
            'warning',
            'A version commit is still settling; checkout and live working-tree diff are temporarily unsafe.',
          ),
        ]
      : []),
    ...providerWrites.unsafeReasons,
    ...liveCollaboration.unsafeReasons,
  ];
  const statusRevision = [
    'workbook',
    `generation:${state.contextGeneration}`,
    `rawRevision:${state.revision}`,
    `rawDirty:${state.hasUncommittedLocalChanges ? 'yes' : 'no'}`,
    `semantic:${semanticDirtyState?.statusRevision ?? 'not-evaluated'}`,
    `dirty:${hasUncommittedLocalChanges ? 'yes' : 'no'}`,
    `calc:${state.calculationState}`,
    `checkout:${state.checkoutInProgress ? 'busy' : 'idle'}`,
    `commit:${state.commitInProgress ? 'busy' : 'idle'}`,
    `providerWrites:${providerWrites.statusRevision}`,
    `liveCollaboration:${liveCollaboration.statusRevision}`,
  ].join('|');

  return {
    statusRevision,
    checkoutPreflightToken: `VC-05-checkout-preflight:${statusRevision}`,
    hasUncommittedLocalChanges,
    commitEligibleChanges: hasUncommittedLocalChanges,
    unsupportedDirtyDomains,
    pendingProviderWrites: providerWrites.pendingProviderWrites,
    pendingRecalc,
    liveCollaboration: liveCollaboration.liveCollaboration,
    checkoutSafe: unsafeReasons.length === 0,
    unsafeReasons,
    source: 'VC-05',
    diagnostics: dedupeDiagnostics([
      ...unsafeReasons,
      ...(semanticDirtyState?.diagnostics ?? []),
      ...providerWrites.diagnostics,
      ...liveCollaboration.diagnostics,
    ]),
  };
}

async function readSemanticDirtyState(
  input: CreateWorkbookVersionSurfaceStatusServiceInput,
  dirtyState: WorkbookVersionSurfaceDirtyState,
): Promise<WorkbookVersionSurfaceSemanticDirtyState | null> {
  if (!dirtyState.hasUncommittedLocalChanges || !input.readSemanticDirtyState) return null;
  try {
    return await input.readSemanticDirtyState(dirtyState);
  } catch {
    return {
      hasUncommittedLocalChanges: dirtyState.hasUncommittedLocalChanges,
      statusRevision: 'semantic:failed',
      diagnostics: [
        surfaceDiagnostic(
          'version.surfaceStatus.semanticDirtyStateFailed',
          'warning',
          'Semantic dirty-state reconciliation failed; using conservative workbook dirty state.',
        ),
      ],
    };
  }
}

function cleanPendingProviderWrites(): VersionPendingProviderWritesStatus {
  return {
    pendingProviderWrites: false,
    statusRevision: 'provider:none',
    unsafeReasons: [],
    diagnostics: [],
  };
}

function cleanLiveCollaborationStatus(): VersionLiveCollaborationDirtyStatus {
  return {
    liveCollaboration: {
      state: 'absent',
      statusRevision: 'liveCollaboration:absent',
    },
    statusRevision: 'liveCollaboration:absent',
    unsafeReasons: [],
    diagnostics: [],
  };
}

function diagnostic(
  code: VersionDiagnostic['code'],
  severity: VersionDiagnostic['severity'],
  message: string,
): VersionDiagnostic {
  return {
    code,
    severity,
    message,
    dependency: 'VC-05',
  };
}
