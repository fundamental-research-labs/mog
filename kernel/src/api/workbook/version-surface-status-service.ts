import type {
  VersionCapability,
  VersionCapabilityDependency,
  VersionCapabilityState,
  VersionDiagnostic,
  VersionSurfaceStatus,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import type { CheckoutSnapshotApplyInput } from '../../document/version-store/checkout-apply';
import type { HostCapabilityDecision, HostCapabilityDecisions } from './version-merge-capability';
import type { VersionLiveCollaborationDirtyStatus } from './version-live-collaboration-status';
import type { VersionPendingProviderWritesStatus } from './version-pending-provider-writes';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

export type SurfaceOnlyVersionCapability = 'version:refAdmin' | 'version:remotePromote';
export type SurfaceVersionCapability = VersionCapability | SurfaceOnlyVersionCapability;
export type SurfaceCapabilityStates = Record<SurfaceVersionCapability, VersionCapabilityState>;
export type SurfaceHostCapabilityDecisions = Partial<
  Record<SurfaceVersionCapability, HostCapabilityDecision>
>;
export type RemotePromoteSurfaceCapabilityInput = {
  readonly editingEnabled: boolean;
  readonly provenanceAvailable: boolean;
  readonly remotePromoteAvailable: boolean;
  readonly hostCapabilityDecisions: SurfaceHostCapabilityDecisions;
  readonly diagnostics: VersionDiagnostic[];
};

export const SURFACE_VERSION_CAPABILITY_KEYS = [
  'version:read',
  'version:diff',
  'version:commit',
  'version:branch',
  'version:checkout',
  'version:reviewRead',
  'version:reviewWrite',
  'version:proposal',
  'version:mergePreview',
  'version:mergeApply',
  'version:refAdmin',
  'version:revert',
  'version:provenance',
  'version:remotePromote',
] as const satisfies readonly SurfaceVersionCapability[];

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
  readDirtyStatus(): MaybePromise<VersionSurfaceStatus['dirty']>;
  readActiveCheckoutSession(): VersionSurfaceCheckoutSession | null;
  recordCheckoutMaterialization(input: CheckoutSnapshotApplyInput): void;
};

export type AttachedVersionSurfaceStatusService = {
  readDirtyStatus?: () => MaybePromise<unknown>;
  readActiveCheckoutSession?: () => MaybePromise<unknown>;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly policy?: unknown;
  readonly policySnapshot?: unknown;
  readonly versionPolicy?: unknown;
  readonly hostCapabilityPolicy?: unknown;
  readonly hostPolicy?: unknown;
};

export function createWorkbookVersionSurfaceStatusService(input: {
  readonly readDirtyState: () => WorkbookVersionSurfaceDirtyState;
  readonly readPendingProviderWrites?: () => MaybePromise<VersionPendingProviderWritesStatus>;
  readonly readLiveCollaborationStatus?: () => MaybePromise<VersionLiveCollaborationDirtyStatus>;
}): WorkbookVersionSurfaceStatusService {
  let activeCheckoutSession: VersionSurfaceCheckoutSession | null = null;

  return {
    readDirtyStatus: async () =>
      dirtyStatusFromState(
        input.readDirtyState(),
        input.readPendingProviderWrites
          ? await input.readPendingProviderWrites()
          : cleanPendingProviderWrites(),
        input.readLiveCollaborationStatus
          ? await input.readLiveCollaborationStatus()
          : cleanLiveCollaborationStatus(),
      ),
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

export function readVersionSurfaceStorageStatus(input: {
  readonly services: unknown;
  readonly hasVersionAttachment: boolean;
}): VersionSurfaceStatus['storage'] {
  const diagnostics: VersionDiagnostic[] = [];
  if (!isRecord(input.services) || !input.hasVersionAttachment) {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.storageUnavailable',
        'warning',
        'No document-scoped version storage provider or service is attached.',
        'storage',
      ),
    );
    return { ready: false, backend: 'unknown', diagnostics };
  }

  const services = input.services;
  const provider = firstRecord([
    services.provider,
    services.storageProvider,
    services.objectStore,
    services.refStore,
    services.graphStore,
    services.graphService,
    services.graph,
    services.readService,
    services.writeService,
    services.publicService,
    services,
  ]);
  const providerReady = readinessFromProvider(provider);
  const ready = providerReady ?? true;
  const backend = backendFromAttachment(provider);

  diagnostics.push(
    ready
      ? surfaceDiagnostic(
          'version.surfaceStatus.storageReady',
          'info',
          'A document-scoped version storage provider or service is attached.',
          'storage',
          { backend },
        )
      : surfaceDiagnostic(
          'version.surfaceStatus.storageUnavailable',
          'warning',
          'The attached version storage provider reports unavailable read capabilities.',
          'storage',
          { backend },
        ),
  );
  if (backend === 'unknown') {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.storageBackendUnknown',
        'info',
        'The attached version storage provider does not expose a public backend identifier.',
        'storage',
      ),
    );
  }

  return { ready, backend, diagnostics };
}

export function getSurfaceVersionHostCapabilityDecisions(
  ctx: DocumentContext,
  baseDecisions: HostCapabilityDecisions,
): SurfaceHostCapabilityDecisions {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const decisions: SurfaceHostCapabilityDecisions = { ...baseDecisions };
  for (const candidate of [
    runtime.policy,
    runtime.policySnapshot,
    runtime.versionPolicy,
    runtime.hostCapabilityPolicy,
    runtime.hostPolicy,
  ]) {
    const candidateDecisions = readSurfaceHostCapabilityDecisions(candidate);
    if (candidateDecisions) Object.assign(decisions, candidateDecisions);
  }
  return decisions;
}

export function remotePromoteSurfaceCapabilityState(
  input: RemotePromoteSurfaceCapabilityInput,
): VersionCapabilityState {
  if (!input.editingEnabled) {
    return disabledSurfaceCapability(
      input.diagnostics,
      'featureGate',
      'Workbook editing is disabled by host feature gates.',
      false,
      'version.surfaceStatus.editingDisabled',
    );
  }

  const remoteDecision = input.hostCapabilityDecisions['version:remotePromote'];
  if (remoteDecision === 'denied' || remoteDecision === 'approval-required') {
    return disabledSurfaceCapability(
      input.diagnostics,
      'hostCapability',
      'Host policy denies version:remotePromote.',
      false,
      'version.surfaceStatus.hostCapabilityDenied',
    );
  }
  const provenanceDecision = input.hostCapabilityDecisions['version:provenance'];
  if (provenanceDecision === 'denied' || provenanceDecision === 'approval-required') {
    return disabledSurfaceCapability(
      input.diagnostics,
      'hostCapability',
      'Host policy denies version:provenance.',
      false,
      'version.surfaceStatus.hostCapabilityDenied',
    );
  }
  if (remoteDecision !== 'allowed') {
    return disabledSurfaceCapability(
      input.diagnostics,
      'hostCapability',
      'Host policy must explicitly allow version:remotePromote for pending remote promotion.',
      false,
      'version.surfaceStatus.remotePromoteUnavailable',
    );
  }
  if (provenanceDecision !== 'allowed') {
    return disabledSurfaceCapability(
      input.diagnostics,
      'hostCapability',
      'Host policy must explicitly allow version:provenance for pending remote promotion.',
      false,
      'version.surfaceStatus.remotePromoteUnavailable',
    );
  }
  if (!input.provenanceAvailable) {
    return disabledSurfaceCapability(
      input.diagnostics,
      'VC-09',
      'Complete VC-09 provenance truth is not attached; pending remote promotion is disabled.',
      true,
      'version.surfaceStatus.remotePromoteUnavailable',
    );
  }
  return input.remotePromoteAvailable
    ? { enabled: true }
    : disabledSurfaceCapability(
        input.diagnostics,
        'VC-09',
        'No document-scoped pending remote promotion service is attached.',
        true,
        'version.surfaceStatus.remotePromoteUnavailable',
      );
}

export function hasAttachedVersionDiffService(services: unknown): boolean {
  if (!isRecord(services)) return false;
  return [
    services.diffService,
    services.versionDiffService,
    services.publicService,
    services.readService,
    services.graphService,
    services.graphStore,
    services.graph,
    services,
  ].some((candidate) =>
    Boolean(
      bindMethod(candidate, 'diff') ??
      bindMethod(candidate, 'diffVersions') ??
      bindMethod(candidate, 'diffCommits'),
    ),
  );
}

export function hasAttachedVersionApplyMergeService(services: unknown): boolean {
  if (!isRecord(services)) return false;
  const hasDirectApplyService = [
    services.applyMergeService,
    services.versionApplyMergeService,
    services.publicService,
  ].some((candidate) =>
    Boolean(
      bindMethod(candidate, 'applyMerge') ??
      bindMethod(candidate, 'applyMergeVersion') ??
      bindMethod(candidate, 'applyMergeCommit'),
    ),
  );
  if (hasDirectApplyService) return true;
  const hasMergeCommitWriter = [services.writeService, services.commitService].some((candidate) =>
    Boolean(bindMethod(candidate, 'mergeCommit')),
  );
  return (
    hasMergeCommitWriter && Boolean(services.captureMergeCommit || services.mergeCommitMaterializer)
  );
}

export function hasAttachedVersionRefAdminService(services: unknown): boolean {
  if (!isRecord(services)) return false;
  return [
    services.refLifecycleService,
    services.branchService,
    services.branchRefService,
    services.versionRefService,
    services.publicRefService,
    services.refService,
    services,
  ].some((candidate) =>
    Boolean(
      bindMethod(candidate, 'fastForwardBranch') ??
      bindMethod(candidate, 'updateBranch') ??
      bindMethod(candidate, 'deleteBranch') ??
      bindMethod(candidate, 'deleteRef'),
    ),
  );
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
  providerWrites: VersionPendingProviderWritesStatus,
  liveCollaboration: VersionLiveCollaborationDirtyStatus,
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
    ...providerWrites.unsafeReasons,
    ...liveCollaboration.unsafeReasons,
  ];
  const statusRevision = [
    'workbook',
    `generation:${state.contextGeneration}`,
    `revision:${state.revision}`,
    `dirty:${state.hasUncommittedLocalChanges ? 'yes' : 'no'}`,
    `calc:${state.calculationState}`,
    `checkout:${state.checkoutInProgress ? 'busy' : 'idle'}`,
    `providerWrites:${providerWrites.statusRevision}`,
    `liveCollaboration:${liveCollaboration.statusRevision}`,
  ].join('|');

  return {
    statusRevision,
    checkoutPreflightToken: `VC-05-checkout-preflight:${statusRevision}`,
    hasUncommittedLocalChanges: state.hasUncommittedLocalChanges,
    commitEligibleChanges: state.hasUncommittedLocalChanges,
    unsupportedDirtyDomains,
    pendingProviderWrites: providerWrites.pendingProviderWrites,
    pendingRecalc,
    liveCollaboration: liveCollaboration.liveCollaboration,
    checkoutSafe: unsafeReasons.length === 0,
    unsafeReasons,
    source: 'VC-05',
    diagnostics: dedupeDiagnostics([
      ...unsafeReasons,
      ...providerWrites.diagnostics,
      ...liveCollaboration.diagnostics,
    ]),
  };
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

function dedupeDiagnostics(
  diagnostics: readonly VersionDiagnostic[],
): readonly VersionDiagnostic[] {
  const seen = new Set<string>();
  const deduped: VersionDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}:${diagnostic.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(diagnostic);
  }
  return deduped;
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
  const readDirtyStatus =
    bindMethod(value, 'readDirtyStatus') ?? bindMethod(value, 'getDirtyStatus');
  const readActiveCheckoutSession =
    bindMethod(value, 'readActiveCheckoutSession') ?? bindMethod(value, 'getActiveCheckoutSession');
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
  const liveCollaboration = projectLiveCollaboration(value.liveCollaboration);
  if (value.liveCollaboration !== undefined && !liveCollaboration) return null;

  return {
    statusRevision: value.statusRevision,
    checkoutPreflightToken: value.checkoutPreflightToken,
    hasUncommittedLocalChanges: value.hasUncommittedLocalChanges,
    commitEligibleChanges: value.commitEligibleChanges,
    unsupportedDirtyDomains,
    pendingProviderWrites: value.pendingProviderWrites,
    pendingRecalc: value.pendingRecalc,
    ...(liveCollaboration ? { liveCollaboration } : {}),
    checkoutSafe: value.checkoutSafe,
    unsafeReasons,
    source: 'VC-05',
    diagnostics,
  };
}

function projectLiveCollaboration(
  value: unknown,
): VersionSurfaceStatus['dirty']['liveCollaboration'] | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return null;
  if (
    value.state !== 'absent' &&
    value.state !== 'disabled' &&
    value.state !== 'idle' &&
    value.state !== 'active' &&
    value.state !== 'unknown'
  ) {
    return null;
  }
  if (typeof value.statusRevision !== 'string' || value.statusRevision.length === 0) return null;
  return {
    state: value.state,
    statusRevision: value.statusRevision,
    ...(typeof value.roomId === 'string' && value.roomId.length > 0
      ? { roomId: value.roomId }
      : {}),
    ...(typeof value.sidecarStatus === 'string' && value.sidecarStatus.length > 0
      ? { sidecarStatus: value.sidecarStatus }
      : {}),
    ...(typeof value.activeParticipantCount === 'number'
      ? { activeParticipantCount: value.activeParticipantCount }
      : {}),
    ...(typeof value.remoteProviderAttached === 'boolean'
      ? { remoteProviderAttached: value.remoteProviderAttached }
      : {}),
    ...(typeof value.inFlightRemoteUpdateCount === 'number'
      ? { inFlightRemoteUpdateCount: value.inFlightRemoteUpdateCount }
      : {}),
    ...(typeof value.syncApplyRemoteQueueDepth === 'number'
      ? { syncApplyRemoteQueueDepth: value.syncApplyRemoteQueueDepth }
      : {}),
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
  dependency: VersionDiagnostic['dependency'] = 'VC-05',
  data?: VersionDiagnostic['data'],
): VersionDiagnostic {
  return {
    code,
    severity,
    message,
    dependency,
    ...(data ? { data } : {}),
  };
}

function readinessFromProvider(provider: Readonly<Record<string, unknown>> | null): boolean | null {
  if (!provider) return null;
  const lifecycleState = provider.lifecycleState;
  if (
    lifecycleState === 'closed' ||
    lifecycleState === 'closing' ||
    lifecycleState === 'disposed' ||
    lifecycleState === 'disposing'
  ) {
    return false;
  }

  const capabilities = isRecord(provider.capabilities) ? provider.capabilities : null;
  const reads = isRecord(capabilities?.reads) ? capabilities.reads : null;
  if (!reads) return null;
  return Boolean(reads.graphRegistry || reads.objects || reads.refs || reads.commits);
}

function backendFromAttachment(
  attachment: Readonly<Record<string, unknown>> | null,
): VersionSurfaceStatus['storage']['backend'] {
  if (!attachment) return 'unknown';
  for (const key of ['backend', 'backendKind', 'storageBackend', 'providerKind', 'kind', 'type']) {
    const backend = normalizeBackend(attachment[key]);
    if (backend !== 'unknown') return backend;
  }

  const constructorName = isRecord(attachment.constructor)
    ? attachment.constructor.name
    : undefined;
  return normalizeBackend(constructorName);
}

function normalizeBackend(value: unknown): VersionSurfaceStatus['storage']['backend'] {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.toLowerCase();
  if (normalized.includes('indexeddb') || normalized.includes('indexed-db')) return 'indexeddb';
  if (normalized.includes('memory') || normalized.includes('inmemory')) return 'memory';
  if (
    normalized.includes('remote') ||
    normalized.includes('cloud') ||
    normalized.includes('database') ||
    normalized.includes('object-store') ||
    normalized.includes('objectstore')
  ) {
    return 'remote';
  }
  return 'unknown';
}

function firstRecord(values: readonly unknown[]): Readonly<Record<string, unknown>> | null {
  return values.find(isRecord) ?? null;
}

function disabledSurfaceCapability(
  diagnostics: VersionDiagnostic[],
  dependency: VersionCapabilityDependency,
  reason: string,
  retryable: boolean,
  code: VersionDiagnostic['code'],
): VersionCapabilityState {
  diagnostics.push({
    code,
    severity: retryable ? 'warning' : 'info',
    message: reason,
    dependency,
    data: { capability: 'version:remotePromote' },
  });
  return { enabled: false, dependency, reason, retryable };
}

function readSurfaceHostCapabilityDecisions(value: unknown): SurfaceHostCapabilityDecisions | null {
  const source = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.decisions)
      ? value.decisions
      : null;
  if (!source) return null;

  const decisions: SurfaceHostCapabilityDecisions = {};
  for (const entry of source) {
    if (!isRecord(entry)) continue;
    const capability = toSurfaceVersionCapability(entry.capability);
    const decision = toHostCapabilityDecision(entry.decision);
    if (capability && decision) decisions[capability] = decision;
  }
  return Object.keys(decisions).length > 0 ? decisions : null;
}

function toSurfaceVersionCapability(value: unknown): SurfaceVersionCapability | null {
  return typeof value === 'string' &&
    (SURFACE_VERSION_CAPABILITY_KEYS as readonly string[]).includes(value)
    ? (value as SurfaceVersionCapability)
    : null;
}

function toHostCapabilityDecision(value: unknown): HostCapabilityDecision | null {
  return value === 'allowed' || value === 'denied' || value === 'approval-required' ? value : null;
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
