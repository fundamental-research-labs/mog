import type {
  VersionCapability,
  VersionCapabilityDependency,
  VersionCapabilityState,
  VersionDiagnostic,
  VersionMainRefName,
  VersionRefName,
  VersionRefSelector,
  VersionSurfaceStage,
  VersionSurfaceStatus,
  VersionSurfaceStorageBackend,
  WorkbookVersionStatus,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { hasAttachedVersionCheckoutService } from './version-checkout';
import { hasAttachedVersionWriteService } from './version-commit';
import { hasAttachedVersionMergeService } from './version-merge';
import { hasAttachedVersionRefLifecycleService } from './version-refs';
import {
  getAttachedVersionSurfaceStatusService,
  readCheckoutSessionCurrentStatus,
  readVersionSurfaceCheckoutSession,
  readVersionSurfaceDirtyStatus,
} from './version-surface-status-service';
import type { VersionSurfaceCheckoutSession } from './version-surface-status-service';

const VERSION_HEAD_REF = 'HEAD';
const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

const VERSION_CAPABILITY_KEYS = [
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
  'version:revert',
  'version:provenance',
] as const satisfies readonly VersionCapability[];

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedVersionReadService = {
  readHead?: () => MaybePromise<unknown>;
  getHead?: () => MaybePromise<unknown>;
  readRef?: (name: string) => MaybePromise<unknown>;
  listCommits?: (options?: { readonly pageSize?: number }) => MaybePromise<unknown>;
};

type AttachedVersionServices = AttachedVersionReadService & {
  readonly provider?: unknown;
  readonly storageProvider?: unknown;
  readonly objectStore?: unknown;
  readonly refStore?: unknown;
  readonly graphStore?: unknown;
  readonly graphService?: unknown;
  readonly graph?: unknown;
  readonly readService?: unknown;
  readonly headService?: unknown;
  readonly diffService?: unknown;
  readonly versionDiffService?: unknown;
  readonly writeService?: unknown;
  readonly commitService?: unknown;
  readonly captureMergeCommit?: unknown;
  readonly mergeCommitMaterializer?: unknown;
  readonly applyMergeService?: unknown;
  readonly versionApplyMergeService?: unknown;
  readonly checkoutService?: unknown;
  readonly checkoutMaterializationService?: unknown;
  readonly materializationService?: unknown;
  readonly versionCheckoutService?: unknown;
  readonly publicCheckoutService?: unknown;
  readonly refLifecycleService?: unknown;
  readonly branchService?: unknown;
  readonly branchRefService?: unknown;
  readonly versionRefService?: unknown;
  readonly publicRefService?: unknown;
  readonly refService?: unknown;
  readonly mergeService?: unknown;
  readonly versionMergeService?: unknown;
  readonly publicService?: unknown;
  readonly surfaceStatusService?: unknown;
  readonly versionSurfaceStatusService?: unknown;
  readonly statusService?: unknown;
  readonly dirtyStatusService?: unknown;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
  readonly featureGates?: unknown;
  readonly hostFeatureGates?: unknown;
  readonly gates?: unknown;
  readonly policy?: unknown;
  readonly policySnapshot?: unknown;
  readonly versionPolicy?: unknown;
  readonly hostCapabilityPolicy?: unknown;
  readonly hostPolicy?: unknown;
  readonly kernelHostContext?: unknown;
  readonly documentId?: unknown;
  readonly docId?: unknown;
};

type FeatureGateStatus = {
  readonly enabled: boolean;
  readonly discovered: boolean;
  readonly editingEnabled: boolean;
};

type CapabilityAvailability = {
  readonly read: boolean;
  readonly diff: boolean;
  readonly commit: boolean;
  readonly branch: boolean;
  readonly checkout: boolean;
  readonly mergePreview: boolean;
  readonly mergeApply: boolean;
};

type HostCapabilityDecision = 'allowed' | 'denied' | 'approval-required';
type HostCapabilityDecisions = Partial<Record<VersionCapability, HostCapabilityDecision>>;

type ProjectedHead = {
  readonly id: string;
  readonly refName?: VersionMainRefName | VersionRefName;
  readonly resolvedFrom?: VersionRefSelector;
};

type ProjectedRef = {
  readonly name: 'HEAD' | VersionMainRefName | VersionRefName;
  readonly commitId?: string;
};

export async function getWorkbookVersionSurfaceStatus(
  ctx: DocumentContext,
  workbookStatus?: WorkbookVersionStatus,
): Promise<VersionSurfaceStatus> {
  const services = getAttachedVersionServices(ctx);
  const surfaceStatusService = getAttachedVersionSurfaceStatusService(services);
  const featureGate = getFeatureGateStatus(ctx);
  const hostCapabilityDecisions = getHostCapabilityDecisions(ctx);
  const diagnostics: VersionDiagnostic[] = [];

  if (!featureGate.discovered) {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.featureGateDefaultEnabled',
        'info',
        'No document-scoped versionControl feature gate is attached; kernel status defaults it to enabled.',
        'featureGate',
      ),
    );
  } else if (!featureGate.enabled) {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.featureGateDisabled',
        'warning',
        'The versionControl feature gate is disabled for this workbook.',
        'featureGate',
      ),
    );
  }
  if (!featureGate.editingEnabled) {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.editingDisabled',
        'info',
        'Workbook editing is disabled by host feature gates; version read surfaces remain available.',
        'featureGate',
      ),
    );
  }

  const readService = featureGate.enabled ? getAttachedVersionReadService(services) : null;
  const storage = getStorageStatus(services);
  const availability: CapabilityAvailability = {
    read: Boolean(readService),
    diff: hasAttachedVersionDiffService(services),
    commit: Boolean(workbookStatus?.commitApi.available || hasAttachedVersionWriteService(ctx)),
    branch: hasAttachedVersionRefLifecycleService(ctx),
    checkout: Boolean(workbookStatus?.checkout.available || hasAttachedVersionCheckoutService(ctx)),
    mergePreview: Boolean(workbookStatus?.merge.available || hasAttachedVersionMergeService(ctx)),
    mergeApply:
      Boolean(workbookStatus?.merge.available || hasAttachedVersionMergeService(ctx)) &&
      hasAttachedVersionApplyMergeService(services),
  };

  diagnostics.push(...storage.diagnostics);
  const activeCheckoutSession = await readVersionSurfaceCheckoutSession(
    surfaceStatusService,
    diagnostics,
  );
  const current = featureGate.enabled
    ? await readCurrentStatus(readService, diagnostics, activeCheckoutSession)
    : defaultCurrentStatus();
  const dirty = await readVersionSurfaceDirtyStatus(surfaceStatusService, diagnostics);
  diagnostics.push(...dirty.diagnostics);
  const capabilities = buildCapabilityStates(
    featureGate,
    storage.ready,
    availability,
    hostCapabilityDecisions,
    diagnostics,
  );

  return {
    schemaVersion: 1,
    documentId: getDocumentId(ctx, services),
    stage: determineStage(featureGate, capabilities),
    featureGateEnabled: featureGate.enabled,
    storage,
    current,
    dirty,
    capabilities,
    diagnostics,
  };
}

function getStorageStatus(
  services: AttachedVersionServices | null,
): VersionSurfaceStatus['storage'] {
  const diagnostics: VersionDiagnostic[] = [];
  if (!services || !hasAnyVersionAttachment(services)) {
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

async function readCurrentStatus(
  readService: AttachedVersionReadService | null,
  diagnostics: VersionDiagnostic[],
  activeCheckoutSession: VersionSurfaceCheckoutSession | null,
): Promise<VersionSurfaceStatus['current']> {
  if (activeCheckoutSession) {
    return readCheckoutSessionCurrentStatus({
      session: activeCheckoutSession,
      ...(readService?.readRef ? { readRef: readService.readRef } : {}),
      diagnostics,
    });
  }

  if (!readService) {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.readUnavailable',
        'warning',
        'No document-scoped version graph read service is attached.',
        'VC-04',
      ),
    );
    return defaultCurrentStatus();
  }

  let head: ProjectedHead | null = null;
  try {
    const result = readService.readHead
      ? await readService.readHead()
      : readService.getHead
        ? await readService.getHead()
        : null;
    head = projectHeadResult(result);
  } catch {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.currentReadFailed',
        'warning',
        'The version read service failed while resolving the current head.',
        'VC-04',
      ),
    );
  }

  if (!head) {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.currentReadFailed',
        'warning',
        'The version read service could not provide a current head.',
        'VC-04',
      ),
    );
    return defaultCurrentStatus();
  }

  const refName = head.refName ?? head.resolvedFrom;
  let currentRefHeadId = refName === VERSION_HEAD_REF ? undefined : head.id;
  if (readService.readRef && refName && refName !== VERSION_HEAD_REF) {
    try {
      const ref = projectRefResult(await readService.readRef(refName));
      currentRefHeadId = ref?.commitId ?? currentRefHeadId;
    } catch {
      diagnostics.push(
        surfaceDiagnostic(
          'version.surfaceStatus.currentReadFailed',
          'warning',
          'The version read service failed while resolving the current ref head.',
          'VC-04',
          { refName },
        ),
      );
    }
  }

  return {
    headCommitId: head.id,
    ...(head.refName ? { branchName: branchNameFromRefName(head.refName) } : {}),
    ...(currentRefHeadId ? { currentRefHeadId } : {}),
    detached: !head.refName,
    stale: false,
  };
}

function buildCapabilityStates(
  featureGate: FeatureGateStatus,
  storageReady: boolean,
  availability: CapabilityAvailability,
  hostCapabilityDecisions: HostCapabilityDecisions,
  diagnostics: VersionDiagnostic[],
): Record<VersionCapability, VersionCapabilityState> {
  const disabledByGate = (
    capability: VersionCapability,
  ): VersionCapabilityState => disabledCapability(
    diagnostics,
    capability,
    'featureGate',
    'The versionControl feature gate is disabled.',
    false,
    'version.surfaceStatus.featureGateDisabled',
  );

  if (!featureGate.enabled) {
    return Object.fromEntries(
      VERSION_CAPABILITY_KEYS.map((capability) => [capability, disabledByGate(capability)]),
    ) as Record<VersionCapability, VersionCapabilityState>;
  }

  const disabledByEditingGate = (
    capability: VersionCapability,
  ): VersionCapabilityState => disabledCapability(
    diagnostics,
    capability,
    'featureGate',
    'Workbook editing is disabled by host feature gates.',
    false,
    'version.surfaceStatus.editingDisabled',
  );
  const hostDenied = (capability: VersionCapability): boolean => {
    const decision = hostCapabilityDecisions[capability];
    return decision === 'denied' || decision === 'approval-required';
  };
  const disabledByHostCapability = (
    capability: VersionCapability,
  ): VersionCapabilityState => disabledCapability(
    diagnostics,
    capability,
    'hostCapability',
    `Host policy denies ${capability}.`,
    false,
    'version.surfaceStatus.hostCapabilityDenied',
  );
  const availableCapability = (
    capability: VersionCapability,
    available: boolean,
    dependency: VersionCapabilityDependency,
    reason: string,
    retryable: boolean,
    code: VersionDiagnostic['code'],
  ): VersionCapabilityState => {
    if (hostDenied(capability)) return disabledByHostCapability(capability);
    return available
      ? enabledCapability()
      : disabledCapability(diagnostics, capability, dependency, reason, retryable, code);
  };
  const mutableCapability = (
    capability: VersionCapability,
    available: boolean,
    dependency: VersionCapabilityDependency,
    reason: string,
    retryable: boolean,
    code: VersionDiagnostic['code'],
  ): VersionCapabilityState =>
    !featureGate.editingEnabled
      ? disabledByEditingGate(capability)
      : availableCapability(capability, available, dependency, reason, retryable, code);

  const storageDisabled = (
    capability: VersionCapability,
  ): VersionCapabilityState => disabledCapability(
    diagnostics,
    capability,
    'storage',
    'Version storage is not ready for this workbook.',
    true,
    'version.surfaceStatus.storageUnavailable',
  );
  if (!storageReady) {
    return {
      'version:read': storageDisabled('version:read'),
      'version:diff': storageDisabled('version:diff'),
      'version:commit': storageDisabled('version:commit'),
      'version:branch': storageDisabled('version:branch'),
      'version:checkout': storageDisabled('version:checkout'),
      'version:reviewRead': storageDisabled('version:reviewRead'),
      'version:reviewWrite': storageDisabled('version:reviewWrite'),
      'version:proposal': disabledCapability(
        diagnostics,
        'version:proposal',
        'VC-05',
        'Agent proposal workflows require branch-scoped materialization plumbing from a later slice.',
        false,
        'version.surfaceStatus.proposalUnavailable',
      ),
      'version:mergePreview': storageDisabled('version:mergePreview'),
      'version:mergeApply': storageDisabled('version:mergeApply'),
      'version:revert': disabledCapability(
        diagnostics,
        'version:revert',
        'upstreamRevertContract',
        'Authored revert is reserved until an upstream revert contract exists.',
        false,
        'version.surfaceStatus.revertUnavailable',
      ),
      'version:provenance': disabledCapability(
        diagnostics,
        'version:provenance',
        'VC-09',
        'Remote provenance enrichment from VC-09 is not attached.',
        false,
        'version.surfaceStatus.provenanceUnavailable',
      ),
    };
  }

  return {
    'version:read': availableCapability(
      'version:read',
      availability.read,
      'VC-04',
      'Version graph read services are not attached.',
      true,
      'version.surfaceStatus.readUnavailable',
    ),
    'version:diff': availableCapability(
      'version:diff',
      availability.diff,
      'VC-04',
      'Semantic diff services are not attached.',
      true,
      'version.surfaceStatus.diffUnavailable',
    ),
    'version:commit': mutableCapability(
      'version:commit',
      availability.commit,
      'VC-04',
      'Version commit write services are not attached.',
      true,
      'version.surfaceStatus.commitUnavailable',
    ),
    'version:branch': mutableCapability(
      'version:branch',
      availability.branch,
      'VC-05',
      'Version branch/ref lifecycle services are not attached.',
      true,
      'version.surfaceStatus.branchUnavailable',
    ),
    'version:checkout': mutableCapability(
      'version:checkout',
      availability.checkout,
      'VC-05',
      'Version checkout materialization services are not attached.',
      true,
      'version.surfaceStatus.checkoutUnavailable',
    ),
    'version:reviewRead': availableCapability(
      'version:reviewRead',
      false,
      'storage',
      'Review metadata storage is not attached in this surface slice.',
      false,
      'version.surfaceStatus.reviewUnavailable',
    ),
    'version:reviewWrite': mutableCapability(
      'version:reviewWrite',
      false,
      'storage',
      'Review metadata write storage is not attached in this surface slice.',
      false,
      'version.surfaceStatus.reviewUnavailable',
    ),
    'version:proposal': mutableCapability(
      'version:proposal',
      false,
      'VC-05',
      'Agent proposal workflows require branch-scoped materialization plumbing from a later slice.',
      false,
      'version.surfaceStatus.proposalUnavailable',
    ),
    'version:mergePreview': availableCapability(
      'version:mergePreview',
      availability.mergePreview,
      'VC-07',
      'Version merge preview services are not attached.',
      true,
      'version.surfaceStatus.mergePreviewUnavailable',
    ),
    'version:mergeApply': mutableCapability(
      'version:mergeApply',
      availability.mergeApply,
      'VC-07',
      'Version merge apply requires merge preview and merge-commit write services.',
      true,
      'version.surfaceStatus.mergeApplyUnavailable',
    ),
    'version:revert': mutableCapability(
      'version:revert',
      false,
      'upstreamRevertContract',
      'Authored revert is reserved until an upstream revert contract exists.',
      false,
      'version.surfaceStatus.revertUnavailable',
    ),
    'version:provenance': availableCapability(
      'version:provenance',
      false,
      'VC-09',
      'Remote provenance enrichment from VC-09 is not attached.',
      false,
      'version.surfaceStatus.provenanceUnavailable',
    ),
  };
}

function determineStage(
  featureGate: FeatureGateStatus,
  capabilities: Record<VersionCapability, VersionCapabilityState>,
): VersionSurfaceStage {
  if (!featureGate.enabled) return 'off';
  if (capabilities['version:provenance'].enabled) return 'provenance';
  if (capabilities['version:proposal'].enabled) return 'proposal';
  if (capabilities['version:mergePreview'].enabled && capabilities['version:mergeApply'].enabled) {
    return 'merge';
  }
  if (
    capabilities['version:commit'].enabled ||
    capabilities['version:branch'].enabled ||
    capabilities['version:checkout'].enabled
  ) {
    return 'authoring';
  }
  if (
    capabilities['version:read'].enabled ||
    capabilities['version:diff'].enabled ||
    capabilities['version:reviewRead'].enabled
  ) {
    return 'readOnly';
  }
  return 'off';
}

function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? (services as AttachedVersionServices) : null;
}

function getAttachedVersionReadService(
  services: AttachedVersionServices | null,
): AttachedVersionReadService | null {
  if (!services) return null;

  for (const candidate of [
    services.graphStore,
    services.graphService,
    services.graph,
    services.readService,
    services.headService,
    services,
  ]) {
    const readService = toReadService(candidate);
    if (readService) return readService;
  }

  return null;
}

function toReadService(value: unknown): AttachedVersionReadService | null {
  const readHead = bindMethod(value, 'readHead');
  const getHead = bindMethod(value, 'getHead');
  const readRef = bindMethod(value, 'readRef');
  const listCommits = bindMethod(value, 'listCommits');
  if (!readHead && !getHead && !readRef && !listCommits) return null;
  return {
    ...(readHead ? { readHead: () => readHead() } : {}),
    ...(getHead ? { getHead: () => getHead() } : {}),
    ...(readRef ? { readRef: (name: string) => readRef(name) } : {}),
    ...(listCommits ? { listCommits: (options?: { readonly pageSize?: number }) => listCommits(options) } : {}),
  };
}

function hasAttachedVersionDiffService(services: AttachedVersionServices | null): boolean {
  if (!services) return false;
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

function hasAttachedVersionApplyMergeService(services: AttachedVersionServices | null): boolean {
  if (!services) return false;
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
  return hasMergeCommitWriter && Boolean(services.captureMergeCommit || services.mergeCommitMaterializer);
}

function hasAnyVersionAttachment(services: AttachedVersionServices): boolean {
  return Boolean(
    services.provider ||
      services.storageProvider ||
      services.objectStore ||
      services.refStore ||
      getAttachedVersionReadService(services) ||
      hasAttachedVersionDiffService(services) ||
      hasAttachedVersionApplyMergeService(services) ||
      bindMethod(services.writeService, 'commit') ||
      bindMethod(services.commitService, 'commit') ||
      bindMethod(services.checkoutService, 'checkout') ||
      bindMethod(services.checkoutService, 'planCheckout') ||
      bindMethod(services.refLifecycleService, 'createBranch') ||
      bindMethod(services.branchService, 'createBranch') ||
      bindMethod(services.mergeService, 'merge') ||
      bindMethod(services.versionMergeService, 'merge') ||
      bindMethod(services.publicService, 'merge') ||
      bindMethod(services, 'commit') ||
      bindMethod(services, 'checkout') ||
      bindMethod(services, 'planCheckout') ||
      bindMethod(services, 'createBranch') ||
      bindMethod(services, 'merge'),
  );
}

function getFeatureGateStatus(ctx: DocumentContext): FeatureGateStatus {
  const runtime = ctx as MaybeVersionRuntimeContext;
  let versionControl: boolean | undefined;
  let editing: boolean | undefined;
  for (const candidate of [runtime.featureGates, runtime.hostFeatureGates, runtime.gates]) {
    versionControl ??= readVersionControlGate(candidate);
    editing ??= readEditingGate(candidate);
  }
  return {
    enabled: versionControl ?? true,
    discovered: versionControl !== undefined,
    editingEnabled: editing ?? true,
  };
}

function readVersionControlGate(value: unknown): boolean | undefined {
  if (!isRecord(value)) return undefined;
  const capabilities = isRecord(value.capabilities) ? value.capabilities : null;
  if (typeof capabilities?.versionControl === 'boolean') return capabilities.versionControl;
  if (typeof value.versionControl === 'boolean') return value.versionControl;
  return undefined;
}

function readEditingGate(value: unknown): boolean | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.editing === 'boolean' ? value.editing : undefined;
}

function getHostCapabilityDecisions(ctx: DocumentContext): HostCapabilityDecisions {
  const runtime = ctx as MaybeVersionRuntimeContext;
  for (const candidate of [runtime.policy, runtime.policySnapshot, runtime.versionPolicy, runtime.hostCapabilityPolicy, runtime.hostPolicy]) {
    const decisions = readHostCapabilityDecisions(candidate);
    if (decisions) return decisions;
  }
  return {};
}

function readHostCapabilityDecisions(value: unknown): HostCapabilityDecisions | null {
  const source = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.decisions) ? value.decisions : null;
  if (!source) return null;

  const decisions: HostCapabilityDecisions = {};
  for (const entry of source) {
    if (!isRecord(entry)) continue;
    const capability = toVersionCapability(entry.capability);
    const decision = toHostCapabilityDecision(entry.decision);
    if (capability && decision) decisions[capability] = decision;
  }
  return Object.keys(decisions).length > 0 ? decisions : null;
}

function getDocumentId(ctx: DocumentContext, services: AttachedVersionServices | null): string {
  const providerDocumentId = readNestedString(services?.provider, ['documentScope', 'documentId']);
  if (providerDocumentId) return providerDocumentId;

  const runtime = ctx as MaybeVersionRuntimeContext;
  if (typeof runtime.documentId === 'string' && runtime.documentId.length > 0) {
    return runtime.documentId;
  }
  if (typeof runtime.docId === 'string' && runtime.docId.length > 0) return runtime.docId;

  try {
    const scope = typeof ctx.workbookLinkScope === 'function' ? ctx.workbookLinkScope() : null;
    if (isRecord(scope) && typeof scope.requestingDocumentId === 'string') {
      return scope.requestingDocumentId;
    }
  } catch {
    // Preflight status must not fail because optional identity plumbing failed.
  }

  return (
    readNestedString(runtime.kernelHostContext, ['storage', 'resourceContext', 'documentId']) ??
    'unknown-document'
  );
}

function projectHeadResult(value: unknown): ProjectedHead | null {
  if (!isRecord(value)) return null;
  if (value.status === 'success' && isRecord(value.head)) return projectHead(value.head);
  if ('head' in value && value.head !== null) return projectHead(value.head);
  return projectHead(value);
}

function projectHead(value: unknown): ProjectedHead | null {
  if (!isRecord(value)) return null;
  const id = toCommitId(value.id) ?? toCommitId(value.commitId);
  if (!id) return null;
  const refName = toRefName(value.refName) ?? legacyBranchNameToRefName(value.branchName);
  const resolvedFrom = toRefSelector(value.resolvedFrom);
  return {
    id,
    ...(refName ? { refName } : {}),
    ...(resolvedFrom ? { resolvedFrom } : {}),
  };
}

function projectRefResult(value: unknown): ProjectedRef | null {
  if (!isRecord(value)) return null;
  if (value.status === 'success' && isRecord(value.ref)) return projectRef(value.ref);
  if ('ref' in value && value.ref !== null) return projectRef(value.ref);
  return projectRef(value);
}

function projectRef(value: unknown): ProjectedRef | null {
  if (!isRecord(value)) return null;
  if (value.name === VERSION_HEAD_REF) {
    return { name: VERSION_HEAD_REF };
  }

  const name = toRefName(value.name);
  const commitId = toCommitId(value.commitId);
  return name && commitId ? { name, commitId } : null;
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
): VersionSurfaceStorageBackend {
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

function normalizeBackend(value: unknown): VersionSurfaceStorageBackend {
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

function enabledCapability(): VersionCapabilityState {
  return { enabled: true };
}

function disabledCapability(
  diagnostics: VersionDiagnostic[],
  capability: VersionCapability,
  dependency: VersionCapabilityDependency,
  reason: string,
  retryable: boolean,
  code: VersionDiagnostic['code'],
): VersionCapabilityState {
  diagnostics.push(
    surfaceDiagnostic(code, retryable ? 'warning' : 'info', reason, dependency, { capability }),
  );
  return { enabled: false, dependency, reason, retryable };
}

function surfaceDiagnostic(
  code: VersionDiagnostic['code'],
  severity: VersionDiagnostic['severity'],
  message: string,
  dependency?: VersionCapabilityDependency,
  data?: VersionDiagnostic['data'],
): VersionDiagnostic {
  return {
    code,
    severity,
    message,
    ...(dependency ? { dependency } : {}),
    ...(data ? { data } : {}),
  };
}

function defaultCurrentStatus(): VersionSurfaceStatus['current'] {
  return {
    detached: false,
    stale: false,
  };
}

function branchNameFromRefName(refName: VersionMainRefName | VersionRefName): string {
  return refName === VERSION_MAIN_REF ? 'main' : refName.slice(VERSION_BRANCH_REF_PREFIX.length);
}

function toCommitId(value: unknown): string | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value) ? value : null;
}

function toRefSelector(value: unknown): VersionRefSelector | undefined {
  if (value === VERSION_HEAD_REF) return VERSION_HEAD_REF;
  return toRefName(value);
}

function toRefName(value: unknown): VersionMainRefName | VersionRefName | undefined {
  if (value === VERSION_MAIN_REF) return VERSION_MAIN_REF;
  if (typeof value === 'string' && value.startsWith(VERSION_BRANCH_REF_PREFIX)) {
    return value as VersionRefName;
  }
  return undefined;
}

function toVersionCapability(value: unknown): VersionCapability | null {
  return typeof value === 'string' && (VERSION_CAPABILITY_KEYS as readonly string[]).includes(value) ? (value as VersionCapability) : null;
}

function toHostCapabilityDecision(value: unknown): HostCapabilityDecision | null {
  return value === 'allowed' || value === 'denied' || value === 'approval-required' ? value : null;
}

function legacyBranchNameToRefName(
  value: unknown,
): VersionMainRefName | VersionRefName | undefined {
  if (value === undefined) return undefined;
  if (value === 'main') return VERSION_MAIN_REF;
  if (typeof value === 'string' && value.startsWith(VERSION_BRANCH_REF_PREFIX)) {
    return value as VersionRefName;
  }
  if (typeof value === 'string' && value.length > 0) {
    return `${VERSION_BRANCH_REF_PREFIX}${value}` as VersionRefName;
  }
  return undefined;
}

function firstRecord(values: readonly unknown[]): Readonly<Record<string, unknown>> | null {
  return values.find(isRecord) ?? null;
}

function readNestedString(value: unknown, path: readonly string[]): string | null {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === 'string' && current.length > 0 ? current : null;
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
