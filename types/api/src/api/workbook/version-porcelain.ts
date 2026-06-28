import type {
  VersionBranchName,
  VersionBranchNameInput,
  VersionCheckoutOptions,
  VersionDiffOptions,
  VersionDiagnostic,
  VersionMainRefName,
  VersionRecordRevision,
  VersionRefName,
  VersionRefNameInput,
  VersionStoreDiagnostic,
  VersionSurfaceStatus,
  VersionListRefsOptions,
  VersionCommitOptions,
  WorkbookCommitId,
  WorkbookCommitIdInput,
} from './version';

export interface VersionCurrentCheckoutSafeActions {
  readonly canCommit: boolean;
  readonly canCreateBranch: boolean;
  readonly canCheckout: boolean;
  readonly canDiff: boolean;
  readonly canMerge: boolean;
  readonly blockedReasons: readonly VersionDiagnostic[];
}

export interface VersionCurrentCheckout {
  readonly schemaVersion: 1;
  readonly status: 'absent' | 'attached' | 'detached' | 'stale';
  readonly branchName?: string;
  readonly refName?: VersionMainRefName | VersionRefName;
  readonly commitId?: WorkbookCommitId;
  readonly checkedOutCommitId?: WorkbookCommitId;
  readonly refHeadAtMaterialization?: WorkbookCommitId;
  readonly currentRefHeadId?: WorkbookCommitId;
  readonly detached: boolean;
  readonly stale: boolean;
  readonly staleReason?: VersionSurfaceStatus['current']['staleReason'];
  readonly dirty: VersionSurfaceStatus['dirty'];
  readonly capabilities: VersionSurfaceStatus['capabilities'];
  readonly safeActions: VersionCurrentCheckoutSafeActions;
  readonly diagnostics: readonly VersionDiagnostic[];
}

export type VersionDiffPorcelainTarget =
  | 'current'
  | 'main'
  | VersionBranchNameInput
  | WorkbookCommitIdInput
  | {
      readonly kind: 'branch';
      readonly name: VersionBranchNameInput;
    }
  | {
      readonly kind: 'ref';
      readonly name: VersionRefNameInput;
    }
  | {
      readonly kind: 'commit';
      readonly id: WorkbookCommitIdInput;
    };

export interface VersionDiffBranchOptions extends VersionDiffOptions {
  readonly against?: VersionDiffPorcelainTarget;
}

export type VersionCommitCurrentOptions = Omit<
  VersionCommitOptions,
  'targetRef' | 'expectedHead'
>;

export interface VersionCreateBranchFromCurrentOptions {
  readonly baseCommitId?: WorkbookCommitIdInput;
  readonly expectedAbsent?: true;
}

export type VersionCheckoutBranchOptions = VersionCheckoutOptions;
export type VersionCheckoutCommitOptions = VersionCheckoutOptions;

export interface VersionListBranchesOptions extends VersionListRefsOptions {}

export interface VersionBranchSummary {
  readonly name: VersionBranchName;
  readonly refName: VersionMainRefName | VersionRefName;
  readonly commitId: WorkbookCommitId;
  readonly revision: VersionRecordRevision;
  readonly updatedAt?: string;
}

export type VersionPorcelainBlockedResultStatus =
  | 'blocked'
  | 'staleTargetHead'
  | 'conflicted';

export interface VersionPorcelainStatusResult {
  readonly status?: string;
  readonly diagnostics?: readonly VersionStoreDiagnostic[];
}
