/**
 * WorkbookVersion -- first read-only version-control diagnostics slice.
 *
 * This surface intentionally exposes status and current-head inspection only.
 * Commit, checkout, merge, and branch mutation APIs are not part of this slice.
 */

export type WorkbookVersionRolloutStage =
  | 'disabled'
  | 'shadow-only'
  | 'headless-local'
  | 'ui-beta'
  | 'collab-interop-beta'
  | 'default-on';

export type WorkbookVersionCapabilityStage = 'present' | 'pending' | 'unavailable';

export type WorkbookVersionDependency = 'VC-02' | 'VC-04' | 'VC-05' | 'VC-07' | 'version-service';

export type WorkbookVersionDiagnosticSeverity = 'info' | 'warning' | 'error';

export type WorkbookVersionDiagnosticCode =
  | 'version.objectStore.foundationPresent'
  | 'version.objectStore.serviceUnavailable'
  | 'version.refLifecycle.foundationPresent'
  | 'version.refLifecycle.serviceUnavailable'
  | 'version.commitApi.pending'
  | 'version.checkout.pending'
  | 'version.merge.pending'
  | 'version.provenanceAdmission.present'
  | 'version.provenanceAdmission.unavailable'
  | 'version.head.serviceUnavailable';

export interface WorkbookVersionDiagnostic {
  readonly code: WorkbookVersionDiagnosticCode | (string & {});
  readonly severity: WorkbookVersionDiagnosticSeverity;
  readonly message: string;
  readonly dependency?: WorkbookVersionDependency;
  readonly data?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface WorkbookVersionCapabilityStatus {
  readonly stage: WorkbookVersionCapabilityStage;
  readonly available: boolean;
  readonly dependency: WorkbookVersionDependency;
  readonly diagnostics: readonly WorkbookVersionDiagnostic[];
}

export interface WorkbookVersionStatus {
  readonly schemaVersion: 1;
  readonly rolloutStage: WorkbookVersionRolloutStage;
  readonly objectStoreFoundation: WorkbookVersionCapabilityStatus;
  readonly refLifecycleFoundation: WorkbookVersionCapabilityStatus;
  readonly commitApi: WorkbookVersionCapabilityStatus;
  readonly checkout: WorkbookVersionCapabilityStatus;
  readonly merge: WorkbookVersionCapabilityStatus;
  readonly provenanceAdmission: WorkbookVersionCapabilityStatus;
  readonly diagnostics: readonly WorkbookVersionDiagnostic[];
}

export interface WorkbookVersionHead {
  readonly commitId: string;
  readonly branchName?: string;
}

export interface WorkbookVersionHeadStatus {
  readonly schemaVersion: 1;
  readonly rolloutStage: WorkbookVersionRolloutStage;
  readonly head: WorkbookVersionHead | null;
  readonly diagnostics: readonly WorkbookVersionDiagnostic[];
}

export interface WorkbookVersion {
  getStatus(): Promise<WorkbookVersionStatus>;
  getHead(): Promise<WorkbookVersionHeadStatus>;
}
