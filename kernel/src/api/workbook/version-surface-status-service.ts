import type { VersionDiagnostic, VersionSurfaceStatus } from '@mog-sdk/contracts/api';

import type { CheckoutSnapshotApplyInput } from '../../document/version-store/checkout-apply';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

export type WorkbookVersionSurfaceDirtyState = {
  readonly hasUncommittedLocalChanges: boolean;
  readonly calculationState: 'done' | 'calculating' | 'pending';
  readonly checkoutInProgress: boolean;
  readonly revision: number;
  readonly contextGeneration: number;
};

export type VersionSurfaceCheckoutSession = {
  readonly checkedOutCommitId: string;
  readonly branchName?: string;
  readonly refHeadAtMaterialization?: string;
  readonly detached: boolean;
};

export type WorkbookVersionSurfaceStatusService = {
  readDirtyStatus(): VersionSurfaceStatus['dirty'];
  readActiveCheckoutSession(): VersionSurfaceCheckoutSession | null;
  recordCheckoutMaterialization(input: CheckoutSnapshotApplyInput): void;
};

export type AttachedVersionSurfaceStatusService = {
  readDirtyStatus?: () => MaybePromise<unknown>;
  readActiveCheckoutSession?: () => MaybePromise<unknown>;
};

export function createWorkbookVersionSurfaceStatusService(input: {
  readonly readDirtyState: () => WorkbookVersionSurfaceDirtyState;
}): WorkbookVersionSurfaceStatusService {
  let activeCheckoutSession: VersionSurfaceCheckoutSession | null = null;

  return {
    readDirtyStatus: () => dirtyStatusFromState(input.readDirtyState()),
    readActiveCheckoutSession: () =>
      activeCheckoutSession === null ? null : Object.freeze({ ...activeCheckoutSession }),
    recordCheckoutMaterialization: (materialization) => {
      activeCheckoutSession = checkoutSessionFromMaterialization(materialization);
    },
  };
}

export function getAttachedVersionSurfaceStatusService(
  services: unknown,
): AttachedVersionSurfaceStatusService | null {
  if (!isRecord(services)) return null;
  for (const candidate of [
    services.surfaceStatusService,
    services.versionSurfaceStatusService,
    services.statusService,
    services.dirtyStatusService,
    services,
  ]) {
    const service = toSurfaceStatusService(candidate);
    if (service) return service;
  }
  return null;
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

export async function readVersionSurfaceCheckoutSession(
  service: AttachedVersionSurfaceStatusService | null,
  diagnostics: VersionDiagnostic[],
): Promise<VersionSurfaceCheckoutSession | null> {
  if (!service?.readActiveCheckoutSession) return null;
  try {
    const session = projectCheckoutSession(await service.readActiveCheckoutSession());
    if (session !== undefined) return session;
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.checkoutSessionInvalid',
        'warning',
        'The attached VC-05 checkout-session status service returned an invalid payload.',
      ),
    );
  } catch {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.checkoutSessionReadFailed',
        'warning',
        'The attached VC-05 checkout-session status service failed.',
      ),
    );
  }
  return null;
}

export async function readCheckoutSessionCurrentStatus(input: {
  readonly session: VersionSurfaceCheckoutSession;
  readonly readRef?: (name: string) => MaybePromise<unknown>;
  readonly diagnostics: VersionDiagnostic[];
}): Promise<VersionSurfaceStatus['current']> {
  const base = {
    headCommitId: input.session.checkedOutCommitId,
    checkedOutCommitId: input.session.checkedOutCommitId,
    ...(input.session.branchName ? { branchName: input.session.branchName } : {}),
    ...(input.session.refHeadAtMaterialization
      ? { refHeadAtMaterialization: input.session.refHeadAtMaterialization }
      : {}),
    detached: input.session.detached,
  };

  if (input.session.detached) {
    return {
      ...base,
      stale: false,
    };
  }

  if (!input.session.branchName || !input.session.refHeadAtMaterialization) {
    input.diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.checkoutSessionInvalid',
        'warning',
        'The active checkout session is missing attached-ref materialization metadata.',
      ),
    );
    return { ...base, stale: true, staleReason: 'unknown' };
  }

  if (!input.readRef) {
    input.diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.currentRefHeadUnavailable',
        'warning',
        'No version read service is attached to compare the active checkout session with its current ref head.',
      ),
    );
    return { ...base, stale: true, staleReason: 'unknown' };
  }

  const publicRefName = publicRefNameFromBranchName(input.session.branchName);
  let currentRefHeadId: string | undefined;
  try {
    currentRefHeadId = projectRefCommitId(await input.readRef(publicRefName));
  } catch {
    input.diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.currentReadFailed',
        'warning',
        'The version read service failed while resolving the active checkout ref head.',
      ),
    );
  }

  if (!currentRefHeadId) {
    input.diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.currentReadFailed',
        'warning',
        'The version read service could not provide the active checkout ref head.',
      ),
    );
    return { ...base, stale: true, staleReason: 'unknown' };
  }

  const staleReason =
    currentRefHeadId !== input.session.refHeadAtMaterialization
      ? 'refMoved'
      : input.session.checkedOutCommitId !== input.session.refHeadAtMaterialization
        ? 'activeSessionBehind'
        : undefined;

  return {
    ...base,
    currentRefHeadId,
    stale: staleReason !== undefined,
    ...(staleReason ? { staleReason } : {}),
  };
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
    return Object.freeze({
      checkedOutCommitId: input.commitId,
      detached: true,
    });
  }

  return Object.freeze({
    checkedOutCommitId: input.commitId,
    branchName: target.refName,
    refHeadAtMaterialization: target.commitId,
    detached: false,
  });
}

function dirtyStatusFromState(
  state: WorkbookVersionSurfaceDirtyState,
): VersionSurfaceStatus['dirty'] {
  const pendingRecalc = state.calculationState !== 'done';
  const unsupportedDirtyDomains: readonly string[] = [];
  const unsafeReasons = [
    ...(state.hasUncommittedLocalChanges
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
  ];
  const statusRevision = [
    'workbook',
    `generation:${state.contextGeneration}`,
    `revision:${state.revision}`,
    `dirty:${state.hasUncommittedLocalChanges ? 'yes' : 'no'}`,
    `calc:${state.calculationState}`,
    `checkout:${state.checkoutInProgress ? 'busy' : 'idle'}`,
  ].join('|');

  return {
    statusRevision,
    checkoutPreflightToken: `VC-05-checkout-preflight:${statusRevision}`,
    hasUncommittedLocalChanges: state.hasUncommittedLocalChanges,
    commitEligibleChanges: state.hasUncommittedLocalChanges,
    unsupportedDirtyDomains,
    pendingProviderWrites: false,
    pendingRecalc,
    checkoutSafe: unsafeReasons.length === 0,
    unsafeReasons,
    source: 'VC-05',
    diagnostics: unsafeReasons,
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

function toSurfaceStatusService(value: unknown): AttachedVersionSurfaceStatusService | null {
  const readDirtyStatus = bindMethod(value, 'readDirtyStatus') ?? bindMethod(value, 'getDirtyStatus');
  const readActiveCheckoutSession =
    bindMethod(value, 'readActiveCheckoutSession') ??
    bindMethod(value, 'getActiveCheckoutSession');
  if (!readDirtyStatus && !readActiveCheckoutSession) return null;
  return {
    ...(readDirtyStatus ? { readDirtyStatus: () => readDirtyStatus() } : {}),
    ...(readActiveCheckoutSession
      ? { readActiveCheckoutSession: () => readActiveCheckoutSession() }
      : {}),
  };
}

function projectDirtyStatus(value: unknown): VersionSurfaceStatus['dirty'] | null {
  if (!isRecord(value)) return null;
  if (value.source !== 'VC-05') return null;
  if (typeof value.statusRevision !== 'string' || value.statusRevision.length === 0) return null;
  if (
    typeof value.checkoutPreflightToken !== 'string' ||
    value.checkoutPreflightToken.length === 0
  ) {
    return null;
  }
  if (
    typeof value.hasUncommittedLocalChanges !== 'boolean' ||
    typeof value.commitEligibleChanges !== 'boolean' ||
    typeof value.pendingProviderWrites !== 'boolean' ||
    typeof value.pendingRecalc !== 'boolean' ||
    typeof value.checkoutSafe !== 'boolean'
  ) {
    return null;
  }
  const unsupportedDirtyDomains = stringArray(value.unsupportedDirtyDomains);
  const unsafeReasons = diagnosticArray(value.unsafeReasons);
  const diagnostics = diagnosticArray(value.diagnostics);
  if (!unsupportedDirtyDomains || !unsafeReasons || !diagnostics) return null;

  return {
    statusRevision: value.statusRevision,
    checkoutPreflightToken: value.checkoutPreflightToken,
    hasUncommittedLocalChanges: value.hasUncommittedLocalChanges,
    commitEligibleChanges: value.commitEligibleChanges,
    unsupportedDirtyDomains,
    pendingProviderWrites: value.pendingProviderWrites,
    pendingRecalc: value.pendingRecalc,
    checkoutSafe: value.checkoutSafe,
    unsafeReasons,
    source: 'VC-05',
    diagnostics,
  };
}

function projectCheckoutSession(value: unknown): VersionSurfaceCheckoutSession | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return undefined;
  const checkedOutCommitId = toCommitId(value.checkedOutCommitId);
  if (!checkedOutCommitId || typeof value.detached !== 'boolean') return undefined;
  if (value.detached) {
    return Object.freeze({ checkedOutCommitId, detached: true });
  }

  const branchName = normalizeBranchName(value.branchName ?? value.refName);
  const refHeadAtMaterialization = toCommitId(value.refHeadAtMaterialization);
  if (!branchName || !refHeadAtMaterialization) return undefined;
  return Object.freeze({
    checkedOutCommitId,
    branchName,
    refHeadAtMaterialization,
    detached: false,
  });
}

function projectRefCommitId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (value.status === 'success' && isRecord(value.ref)) return projectRefCommitId(value.ref);
  if ('ref' in value && value.ref !== null) return projectRefCommitId(value.ref);
  return toCommitId(value.commitId) ?? toCommitId(value.targetCommitId) ?? undefined;
}

function publicRefNameFromBranchName(branchName: string): string {
  return branchName.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? branchName
    : `${VERSION_BRANCH_REF_PREFIX}${branchName}`;
}

function normalizeBranchName(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? value.slice(VERSION_BRANCH_REF_PREFIX.length)
    : value;
}

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? Object.freeze([...value])
    : null;
}

function diagnosticArray(value: unknown): readonly VersionDiagnostic[] | null {
  if (!Array.isArray(value)) return null;
  const diagnostics: VersionDiagnostic[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    if (
      typeof entry.code !== 'string' ||
      typeof entry.severity !== 'string' ||
      typeof entry.message !== 'string'
    ) {
      return null;
    }
    diagnostics.push({
      code: entry.code,
      severity: entry.severity as VersionDiagnostic['severity'],
      message: entry.message,
      ...(typeof entry.dependency === 'string'
        ? { dependency: entry.dependency as VersionDiagnostic['dependency'] }
        : {}),
      ...(isRecord(entry.data) ? { data: entry.data as VersionDiagnostic['data'] } : {}),
    });
  }
  return Object.freeze(diagnostics);
}

function surfaceDiagnostic(
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

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function toCommitId(value: unknown): string | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value) ? value : null;
}
