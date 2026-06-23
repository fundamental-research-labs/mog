import type {
  AcceptAgentProposalInput,
  AgentProposal,
  AgentProposalAcceptResult,
  AgentProposalSummary,
  AgentProposalWorkspaceHandle,
  CheckoutVersionResult,
  CommitProposalWorkspaceInput,
  CreateAgentProposalInput,
  DisposeProposalWorkspaceInput,
  FailAgentProposalInput,
  GetAgentProposalInput,
  GetProposalWorkspaceInput,
  Paged,
  VersionBranchName,
  VersionBranchRefReadResult,
  VersionCapability,
  VersionApplyMergeInput,
  VersionApplyMergeOptions,
  VersionApplyMergeResult,
  VersionCheckoutOptions,
  VersionCheckoutTarget,
  VersionCommitish,
  VersionCreateBranchOptions,
  VersionCommitOptions,
  VersionDeleteRefOptions,
  VersionDiffOptions,
  VersionFastForwardBranchOptions,
  VersionGetHeadOptions,
  VersionGetMergeConflictDetailRequest,
  VersionListCommitsOptions,
  VersionListRefsOptions,
  VersionMainRefName,
  VersionMergeInput,
  VersionMergeOptions,
  VersionMergeConflictDetailResult,
  VersionMergeResult,
  VersionPromotePendingRemoteOptions,
  VersionPromotePendingRemoteResult,
  VersionPutMergeResolutionPayloadRequest,
  VersionPutMergeResolutionPayloadResult,
  VersionRevertInput,
  VersionRevertOptions,
  VersionRevertResult,
  VersionRef,
  VersionRefName,
  VersionRefReadResult,
  VersionRefSelector,
  VersionAppendReviewDecisionInput,
  VersionCreateReviewInput,
  VersionGetReviewDiffInput,
  VersionGetReviewInput,
  ListAgentProposalsInput,
  MarkAgentProposalVerifiedInput,
  OpenProposalReviewInput,
  RejectAgentProposalInput,
  StartProposalWorkspaceInput,
  SupersedeAgentProposalInput,
  VersionListReviewsInput,
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
  VersionResult,
  VersionSaveMergeResolutionsRequest,
  VersionSaveMergeResolutionsResult,
  VersionSemanticDiffPage,
  VersionStoreDiagnostic,
  VersionSymbolicRefReadResult,
  VersionUpdateBranchOptions,
  VersionUpdateReviewStatusInput,
  VersionHead,
  WorkbookCommitSummary,
  WorkbookVersion,
  WorkbookVersionCapabilityStatus,
  WorkbookVersionDiagnostic,
  WorkbookVersionRolloutStage,
  WorkbookVersionStatus,
} from '@mog-sdk/contracts/api';
import { VERSION_DIFF_DEFAULT_PAGE_LIMIT } from '@mog-sdk/contracts/versioning';

import { observeMutationAdmission } from '../../bridges/compute/mutation-admission';
import type { DocumentContext } from '../../context';
import { VERSION_OBJECT_SCHEMA_VERSION } from '../../document/version-store/object-store';
import { REF_NAME_STORAGE_PREFIX } from '../../document/version-store/ref-name';
import { applyMergeWorkbookVersion } from './version-apply-merge';
import {
  checkoutWorkbookVersion,
  hasAttachedVersionCheckoutService,
  type VersionCheckoutTransactionGuard,
} from './version-checkout';
import { commitWorkbookVersion, hasAttachedVersionWriteService } from './version-commit';
import { diffWorkbookVersion } from './version-diff';
import { listWorkbookVersionCommits } from './version-list-commits';
import { hasAttachedVersionMergeService, mergeWorkbookVersion } from './version-merge';
import {
  getMergeConflictDetailWorkbookVersion,
  putMergeResolutionPayloadWorkbookVersion,
  saveMergeResolutionsWorkbookVersion,
} from './version-merge-review-endpoints';
import {
  hasAttachedPendingRemotePromotionService,
  promotePendingRemoteWorkbookVersion,
} from './version-pending-remote';
import { revertWorkbookVersion } from './version-revert';
import {
  acceptWorkbookVersionProposal,
  commitWorkbookVersionProposalWorkspace,
  createWorkbookVersionProposal,
  disposeWorkbookVersionProposalWorkspace,
  failWorkbookVersionProposal,
  getWorkbookVersionProposal,
  getWorkbookVersionProposalWorkspace,
  listWorkbookVersionProposals,
  markWorkbookVersionProposalVerified,
  openWorkbookVersionProposalReview,
  rejectWorkbookVersionProposal,
  startWorkbookVersionProposalWorkspace,
  supersedeWorkbookVersionProposal,
} from './version-proposal';
import {
  appendWorkbookVersionReviewDecision,
  createWorkbookVersionReview,
  getWorkbookVersionReview,
  getWorkbookVersionReviewDiff,
  listWorkbookVersionReviews,
  updateWorkbookVersionReviewStatus,
} from './version-review';
import {
  versionResultFromApplyMerge,
  versionResultFromCheckout,
  versionResultFromDiffPage,
  versionFailureFromStoreDiagnostics,
  versionResultFromHead,
  versionResultFromMerge,
  versionResultFromRefList,
  versionResultFromRefMutation,
  versionResultFromRefRead,
} from './version-result';
import { getWorkbookVersionSurfaceStatus } from './version-surface-status';
import { projectWorkbookVersionProvenanceStatusDiagnostics } from './version-provenance-truth-service';
import { validateVersionOperationGate } from './version-operation-gate';
import {
  VERSION_HEAD_REF,
  VERSION_MAIN_REF,
  degradedHead,
  degradedRef,
  mapHeadResult,
  mapLegacyHeadResult,
  mapRefResult,
  providerErrorDiagnostic,
  serviceUnavailableDiagnostic,
} from './version-public-read-mappers';
import {
  createWorkbookVersionBranch,
  deleteWorkbookVersionBranch,
  deleteWorkbookVersionRef,
  fastForwardWorkbookVersionBranch,
  getWorkbookVersionRef,
  hasAttachedVersionRefLifecycleService,
  listWorkbookVersionRefs,
  readWorkbookVersionRef,
  updateWorkbookVersionBranch,
} from './version-refs';

const VERSION_LIST_REFS_DEFAULT_PAGE_SIZE = 50;

type MaybePromise<T> = T | Promise<T>;

type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedVersionReadService = {
  readHead?: () => MaybePromise<unknown>;
  getHead?: () => MaybePromise<unknown>;
  readRef?: (name: string) => MaybePromise<unknown>;
};

type AttachedVersionServices = AttachedVersionReadService & {
  readonly objectStore?: unknown;
  readonly refStore?: unknown;
  readonly graphStore?: unknown;
  readonly graphService?: unknown;
  readonly graph?: unknown;
  readonly readService?: unknown;
  readonly headService?: unknown;
  readonly provenanceAdmissionService?: unknown;
  readonly provenanceTruthService?: unknown;
  readonly provenanceStatusService?: unknown;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

function diagnostic(
  code: WorkbookVersionDiagnostic['code'],
  severity: WorkbookVersionDiagnostic['severity'],
  message: string,
  dependency: WorkbookVersionDiagnostic['dependency'],
  data?: WorkbookVersionDiagnostic['data'],
): WorkbookVersionDiagnostic {
  return {
    code,
    severity,
    message,
    dependency,
    ...(data ? { data } : {}),
  };
}

function capability(
  stage: WorkbookVersionCapabilityStatus['stage'],
  available: boolean,
  dependency: WorkbookVersionCapabilityStatus['dependency'],
  diagnostics: readonly WorkbookVersionDiagnostic[],
): WorkbookVersionCapabilityStatus {
  return {
    stage,
    available,
    dependency,
    diagnostics,
  };
}

function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? (services as AttachedVersionServices) : null;
}

function getAttachedVersionReadService(ctx: DocumentContext): AttachedVersionReadService | null {
  const services = getAttachedVersionServices(ctx);
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

  if (!readHead && !getHead && !readRef) return null;

  const service: AttachedVersionReadService = {};
  if (readHead) service.readHead = () => readHead();
  if (getHead) service.getHead = () => getHead();
  if (readRef) service.readRef = (name) => readRef(name);
  return service;
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function getRolloutStage(provenanceAdmissionPresent: boolean): WorkbookVersionRolloutStage {
  return provenanceAdmissionPresent ? 'shadow-only' : 'disabled';
}

function hasCompleteVc09ProvenanceTruth(services: AttachedVersionServices | null): boolean {
  if (!services) return false;
  return [
    services.provenanceAdmissionService,
    services.provenanceTruthService,
    services.provenanceStatusService,
    services,
  ].some(hasExplicitCompleteVc09ProvenanceTruth);
}

function hasExplicitCompleteVc09ProvenanceTruth(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.vc09ProvenanceTruthComplete === true ||
    value.completeVc09ProvenanceAdmission === true ||
    hasExplicitCompleteVc09ProvenanceTruth(value.vc09ProvenanceTruth) ||
    hasExplicitCompleteVc09ProvenanceTruth(value.provenanceAdmissionTruth)
  );
}

export class WorkbookVersionImpl implements WorkbookVersion {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly options: {
      readonly checkoutTransactionGuard?: VersionCheckoutTransactionGuard;
    } = {},
  ) {}

  async getStatus(): Promise<WorkbookVersionStatus> {
    const services = getAttachedVersionServices(this.ctx);
    const writeServiceAttached = hasAttachedVersionWriteService(this.ctx);
    const refLifecycleServiceAttached = hasAttachedVersionRefLifecycleService(this.ctx);
    const checkoutServiceAttached = hasAttachedVersionCheckoutService(this.ctx);
    const mergeServiceAttached = hasAttachedVersionMergeService(this.ctx);
    const mutationAdmissionFoundationPresent = typeof observeMutationAdmission === 'function';
    const pendingRemotePromotionServiceAttached = hasAttachedPendingRemotePromotionService(
      this.ctx,
    );
    const provenanceTruthComplete = hasCompleteVc09ProvenanceTruth(services);
    const rolloutStage = getRolloutStage(provenanceTruthComplete);

    const objectStoreFoundation = diagnostic(
      'version.objectStore.foundationPresent',
      'info',
      'Version object store foundation is present.',
      'VC-04',
      { schemaVersion: VERSION_OBJECT_SCHEMA_VERSION },
    );
    const objectStoreServiceUnavailable = diagnostic(
      'version.objectStore.serviceUnavailable',
      'warning',
      'No document-scoped version object store service is attached yet.',
      'version-service',
    );
    const refLifecycleFoundation = diagnostic(
      'version.refLifecycle.foundationPresent',
      'info',
      'Version ref lifecycle foundation is present.',
      'VC-05',
      { storagePrefix: REF_NAME_STORAGE_PREFIX },
    );
    const refLifecycleServiceUnavailable = diagnostic(
      'version.refLifecycle.serviceUnavailable',
      'warning',
      'No document-scoped ref lifecycle service is attached yet.',
      'version-service',
    );
    const commitApiPending = diagnostic(
      'version.commitApi.pending',
      'warning',
      'Public commit API is exposed but no document-scoped version write service is attached yet.',
      'VC-04',
    );
    const commitApiServiceAttached = diagnostic(
      'version.commitApi.serviceAttached',
      'info',
      'Document-scoped public version commit service is attached.',
      'version-service',
    );
    const checkoutPending = diagnostic(
      'version.checkout.pending',
      'warning',
      'Public checkout facade is exposed, but no production materializer lifecycle attachment is reported yet.',
      'VC-05',
    );
    const checkoutServiceAttachedDiagnostic = diagnostic(
      'version.checkout.serviceAttached',
      'info',
      'Document-scoped public checkout materialization service is attached.',
      'version-service',
    );
    const mergePending = diagnostic(
      'version.merge.pending',
      'warning',
      'Public merge preview API is exposed, but no document-scoped merge service is attached yet.',
      'VC-07',
    );
    const mergeServiceAttachedDiagnostic = diagnostic(
      'version.merge.serviceAttached',
      'info',
      'Document-scoped public merge preview service is attached.',
      'version-service',
    );
    const provenanceAdmission = provenanceTruthComplete
      ? diagnostic(
          'version.provenanceAdmission.present',
          'info',
          'Complete VC-09 provenance admission truth is attached.',
          'version-service',
          { requiredSlice: 'VC-09' },
        )
      : diagnostic(
          'version.provenanceAdmission.vc09TruthUnavailable',
          'warning',
          'Complete VC-09 provenance admission truth is not attached; broad mutation admission and pending remote promotion plumbing are insufficient.',
          'version-service',
          {
            requiredSlice: 'VC-09',
            mutationAdmissionFoundationPresent,
            pendingRemotePromotionServiceAttached,
          },
        );
    const mutationAdmissionFoundation = diagnostic(
      mutationAdmissionFoundationPresent
        ? 'version.provenanceAdmission.mutationAdmissionFoundationPresent'
        : 'version.provenanceAdmission.mutationAdmissionFoundationUnavailable',
      mutationAdmissionFoundationPresent ? 'info' : 'warning',
      mutationAdmissionFoundationPresent
        ? 'VC-02 mutation admission plumbing is present but does not prove complete VC-09 provenance truth.'
        : 'VC-02 mutation admission plumbing is unavailable.',
      'VC-02',
      { sufficientForVc09Truth: false },
    );
    const provenancePromotionServiceAttached = diagnostic(
      'version.provenancePromotion.serviceAttached',
      'info',
      'Document-scoped pending remote provenance promotion service is attached but does not prove complete VC-09 provenance truth.',
      'version-service',
      { sufficientForVc09Truth: false },
    );
    const provenanceStatusProjectionDiagnostics = provenanceTruthComplete
      ? projectWorkbookVersionProvenanceStatusDiagnostics([
          services?.provenanceStatusService,
          services?.provenanceTruthService,
          services?.provenanceAdmissionService,
          services,
        ])
      : [];

    const objectStoreDiagnostics = services?.objectStore
      ? [objectStoreFoundation]
      : [objectStoreFoundation, objectStoreServiceUnavailable];
    const refLifecycleDiagnostics =
      refLifecycleServiceAttached || services?.refStore
        ? [refLifecycleFoundation]
        : [refLifecycleFoundation, refLifecycleServiceUnavailable];
    const commitApiDiagnostics = writeServiceAttached
      ? [commitApiServiceAttached]
      : [commitApiPending];
    const checkoutDiagnostics = checkoutServiceAttached
      ? [checkoutServiceAttachedDiagnostic]
      : [checkoutPending];
    const provenanceDiagnostics = [
      provenanceAdmission,
      ...provenanceStatusProjectionDiagnostics,
      mutationAdmissionFoundation,
      ...(pendingRemotePromotionServiceAttached ? [provenancePromotionServiceAttached] : []),
    ];
    const checkoutStage = checkoutServiceAttached ? 'present' : 'pending';
    const checkoutDependency = checkoutServiceAttached ? 'version-service' : 'VC-05';
    const diagnostics = [
      ...objectStoreDiagnostics,
      ...refLifecycleDiagnostics,
      ...commitApiDiagnostics,
      ...checkoutDiagnostics,
      mergeServiceAttached ? mergeServiceAttachedDiagnostic : mergePending,
      ...provenanceDiagnostics,
    ];
    return {
      schemaVersion: 1,
      rolloutStage,
      objectStoreFoundation: capability('present', true, 'VC-04', objectStoreDiagnostics),
      refLifecycleFoundation: capability('present', true, 'VC-05', refLifecycleDiagnostics),
      commitApi: capability(
        writeServiceAttached ? 'present' : 'pending',
        writeServiceAttached,
        'VC-04',
        commitApiDiagnostics,
      ),
      checkout: capability(
        checkoutStage,
        checkoutServiceAttached,
        checkoutDependency,
        checkoutDiagnostics,
      ),
      merge: capability(
        mergeServiceAttached ? 'present' : 'pending',
        mergeServiceAttached,
        mergeServiceAttached ? 'version-service' : 'VC-07',
        [mergeServiceAttached ? mergeServiceAttachedDiagnostic : mergePending],
      ),
      provenanceAdmission: capability(
        provenanceTruthComplete ? 'present' : 'unavailable',
        provenanceTruthComplete,
        'version-service',
        provenanceDiagnostics,
      ),
      diagnostics,
    };
  }
  async getSurfaceStatus() {
    return getWorkbookVersionSurfaceStatus(this.ctx, await this.getStatus());
  }
  async getHead(): Promise<VersionResult<VersionHead>>;
  async getHead(options: VersionGetHeadOptions): Promise<VersionResult<VersionHead>>;
  async getHead(_options: VersionGetHeadOptions = {}): Promise<VersionResult<VersionHead>> {
    const gateDiagnostics = this.readGate('getHead', 'version:read');
    if (gateDiagnostics) return versionFailureFromStoreDiagnostics('getHead', gateDiagnostics);

    const failHead = (diagnostics: readonly VersionStoreDiagnostic[]) =>
      versionResultFromHead(degradedHead(diagnostics));
    const readService = getAttachedVersionReadService(this.ctx);
    if (!readService) return failHead([serviceUnavailableDiagnostic('getHead')]);

    try {
      if (readService.readHead) {
        return versionResultFromHead(mapHeadResult(await readService.readHead()));
      }
      if (readService.getHead) {
        return versionResultFromHead(mapLegacyHeadResult(await readService.getHead()));
      }
    } catch {
      return failHead([providerErrorDiagnostic('getHead')]);
    }
    return failHead([serviceUnavailableDiagnostic('getHead')]);
  }

  async listCommits(
    options: VersionListCommitsOptions = {},
  ): Promise<VersionResult<Paged<WorkbookCommitSummary>>> {
    const gateDiagnostics = this.readGate('listCommits', 'version:read');
    if (gateDiagnostics) return versionFailureFromStoreDiagnostics('listCommits', gateDiagnostics);
    return listWorkbookVersionCommits(this.ctx, options);
  }
  async commit(options: VersionCommitOptions = {}): Promise<VersionResult<WorkbookCommitSummary>> {
    return commitWorkbookVersion(this.ctx, options);
  }
  async checkout(
    target: VersionCheckoutTarget,
    options: VersionCheckoutOptions = {},
  ): Promise<VersionResult<CheckoutVersionResult>> {
    return versionResultFromCheckout(
      await checkoutWorkbookVersion(
        this.ctx,
        target,
        options,
        this.options.checkoutTransactionGuard,
      ),
    );
  }
  async merge(
    input: VersionMergeInput,
    options: VersionMergeOptions = {},
  ): Promise<VersionResult<VersionMergeResult>> {
    return versionResultFromMerge(await mergeWorkbookVersion(this.ctx, input, options));
  }
  async applyMerge(
    input: VersionApplyMergeInput,
    options: VersionApplyMergeOptions = {},
  ): Promise<VersionResult<VersionApplyMergeResult>> {
    return versionResultFromApplyMerge(await applyMergeWorkbookVersion(this.ctx, input, options));
  }
  async revert(
    input: VersionRevertInput,
    options: VersionRevertOptions = {},
  ): Promise<VersionResult<VersionRevertResult>> {
    return revertWorkbookVersion(this.ctx, input, options);
  }
  async promotePendingRemote(
    options: VersionPromotePendingRemoteOptions = {},
  ): Promise<VersionResult<VersionPromotePendingRemoteResult>> {
    return promotePendingRemoteWorkbookVersion(this.ctx, options);
  }
  async saveMergeResolutions(
    input: VersionSaveMergeResolutionsRequest,
  ): Promise<VersionResult<VersionSaveMergeResolutionsResult>> {
    return saveMergeResolutionsWorkbookVersion(this.ctx, input);
  }
  async getMergeConflictDetail(
    input: VersionGetMergeConflictDetailRequest,
  ): Promise<VersionResult<VersionMergeConflictDetailResult>> {
    return getMergeConflictDetailWorkbookVersion(this.ctx, input);
  }
  async putMergeResolutionPayload(
    input: VersionPutMergeResolutionPayloadRequest,
  ): Promise<VersionResult<VersionPutMergeResolutionPayloadResult>> {
    return putMergeResolutionPayloadWorkbookVersion(this.ctx, input);
  }
  async listReviews(
    input: VersionListReviewsInput = {},
  ): Promise<VersionResult<Paged<WorkbookVersionReviewRecordSummary>>> {
    const gateDiagnostics = this.readGate('listReviews', 'version:reviewRead');
    if (gateDiagnostics) return versionFailureFromStoreDiagnostics('listReviews', gateDiagnostics);
    return listWorkbookVersionReviews(this.ctx, input);
  }
  async getReview(
    input: VersionGetReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    const gateDiagnostics = this.readGate('getReview', 'version:reviewRead');
    if (gateDiagnostics) return versionFailureFromStoreDiagnostics('getReview', gateDiagnostics);
    return getWorkbookVersionReview(this.ctx, input);
  }
  async createReview(
    input: VersionCreateReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return createWorkbookVersionReview(this.ctx, input);
  }
  async appendReviewDecision(
    input: VersionAppendReviewDecisionInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return appendWorkbookVersionReviewDecision(this.ctx, input);
  }
  async updateReviewStatus(
    input: VersionUpdateReviewStatusInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return updateWorkbookVersionReviewStatus(this.ctx, input);
  }
  async getReviewDiff(
    input: VersionGetReviewDiffInput,
  ): Promise<VersionResult<WorkbookVersionReviewDiffPage>> {
    const gateDiagnostics = this.readGate('getReviewDiff', 'version:reviewRead');
    if (gateDiagnostics)
      return versionFailureFromStoreDiagnostics('getReviewDiff', gateDiagnostics);
    return getWorkbookVersionReviewDiff(this.ctx, input);
  }
  async createProposal(input: CreateAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    return createWorkbookVersionProposal(this.ctx, input);
  }
  async startProposalWorkspace(
    input: StartProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposalWorkspaceHandle>> {
    return startWorkbookVersionProposalWorkspace(this.ctx, input);
  }
  async getProposalWorkspace(
    input: GetProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposalWorkspaceHandle>> {
    return getWorkbookVersionProposalWorkspace(this.ctx, input);
  }
  async disposeProposalWorkspace(
    input: DisposeProposalWorkspaceInput,
  ): Promise<VersionResult<{ readonly disposed: true }>> {
    return disposeWorkbookVersionProposalWorkspace(this.ctx, input);
  }
  async commitProposalWorkspace(
    input: CommitProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposal>> {
    return commitWorkbookVersionProposalWorkspace(this.ctx, input);
  }
  async failProposal(input: FailAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    return failWorkbookVersionProposal(this.ctx, input);
  }
  async getProposal(input: GetAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    return getWorkbookVersionProposal(this.ctx, input);
  }
  async listProposals(
    input: ListAgentProposalsInput = {},
  ): Promise<VersionResult<Paged<AgentProposalSummary>>> {
    return listWorkbookVersionProposals(this.ctx, input);
  }
  async markProposalVerified(
    input: MarkAgentProposalVerifiedInput,
  ): Promise<VersionResult<AgentProposal>> {
    return markWorkbookVersionProposalVerified(this.ctx, input);
  }
  async openProposalReview(
    input: OpenProposalReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return openWorkbookVersionProposalReview(this.ctx, input);
  }
  async acceptProposal(
    input: AcceptAgentProposalInput,
  ): Promise<VersionResult<AgentProposalAcceptResult>> {
    return acceptWorkbookVersionProposal(this.ctx, input);
  }
  async rejectProposal(input: RejectAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    return rejectWorkbookVersionProposal(this.ctx, input);
  }
  async supersedeProposal(
    input: SupersedeAgentProposalInput,
  ): Promise<VersionResult<AgentProposal>> {
    return supersedeWorkbookVersionProposal(this.ctx, input);
  }
  async diff(
    base: VersionCommitish,
    target: VersionCommitish,
    options: VersionDiffOptions = {},
  ): Promise<VersionResult<VersionSemanticDiffPage>> {
    const gateDiagnostics = this.readGate('diff', 'version:diff');
    if (gateDiagnostics) return versionFailureFromStoreDiagnostics('diff', gateDiagnostics);
    return versionResultFromDiffPage(
      await diffWorkbookVersion(this.ctx, base, target, options),
      options.pageSize ?? VERSION_DIFF_DEFAULT_PAGE_LIMIT,
    );
  }
  async readRef(name: 'HEAD'): Promise<VersionResult<VersionSymbolicRefReadResult>>;
  async readRef(
    name: VersionMainRefName | VersionRefName | VersionBranchName,
  ): Promise<VersionResult<VersionBranchRefReadResult>>;
  async readRef(
    name: VersionRefSelector | VersionBranchName,
  ): Promise<VersionResult<VersionRefReadResult>>;
  async readRef(
    name: VersionRefSelector | VersionBranchName,
  ): Promise<VersionResult<VersionRefReadResult>> {
    const gateDiagnostics = this.readGate('readRef', 'version:read');
    if (gateDiagnostics) return versionFailureFromStoreDiagnostics('readRef', gateDiagnostics);

    if (name !== VERSION_HEAD_REF && name !== VERSION_MAIN_REF) {
      return versionResultFromRefRead('readRef', await readWorkbookVersionRef(this.ctx, name));
    }

    const publicReadName = name as VersionRefSelector;
    const readService = getAttachedVersionReadService(this.ctx);
    if (!readService?.readRef) {
      return versionResultFromRefRead(
        'readRef',
        degradedRef(null, [serviceUnavailableDiagnostic('readRef', { refName: publicReadName })]),
      );
    }

    try {
      return versionResultFromRefRead(
        'readRef',
        mapRefResult(await readService.readRef(publicReadName), publicReadName),
      );
    } catch {
      return versionResultFromRefRead(
        'readRef',
        degradedRef(null, [providerErrorDiagnostic('readRef', { refName: publicReadName })]),
      );
    }
  }

  async getRef(name: 'HEAD'): Promise<VersionResult<VersionSymbolicRefReadResult>>;
  async getRef(
    name: VersionMainRefName | VersionRefName | VersionBranchName,
  ): Promise<VersionResult<VersionBranchRefReadResult>>;
  async getRef(
    name: VersionRefSelector | VersionBranchName,
  ): Promise<VersionResult<VersionRefReadResult>>;
  async getRef(
    name: VersionRefSelector | VersionBranchName,
  ): Promise<VersionResult<VersionRefReadResult>> {
    const gateDiagnostics = this.readGate('getRef', 'version:read');
    if (gateDiagnostics) return versionFailureFromStoreDiagnostics('getRef', gateDiagnostics);
    return versionResultFromRefRead('getRef', await getWorkbookVersionRef(this.ctx, name));
  }

  async listRefs(options: VersionListRefsOptions = {}): Promise<VersionResult<Paged<VersionRef>>> {
    const gateDiagnostics = this.readGate('listRefs', 'version:read');
    if (gateDiagnostics) return versionFailureFromStoreDiagnostics('listRefs', gateDiagnostics);
    return versionResultFromRefList(
      await listWorkbookVersionRefs(this.ctx, options),
      VERSION_LIST_REFS_DEFAULT_PAGE_SIZE,
    );
  }

  async createBranch(options: VersionCreateBranchOptions): Promise<VersionResult<VersionRef>> {
    return versionResultFromRefMutation(
      'createBranch',
      await createWorkbookVersionBranch(this.ctx, options),
    );
  }

  async fastForwardBranch(
    options: VersionFastForwardBranchOptions,
  ): Promise<VersionResult<VersionRef>> {
    return versionResultFromRefMutation(
      'fastForwardBranch',
      await fastForwardWorkbookVersionBranch(this.ctx, options),
    );
  }

  async updateBranch(options: VersionUpdateBranchOptions): Promise<VersionResult<VersionRef>> {
    return versionResultFromRefMutation(
      'updateBranch',
      await updateWorkbookVersionBranch(this.ctx, options),
    );
  }

  async deleteBranch(options: VersionDeleteRefOptions): Promise<VersionResult<VersionRef>> {
    return versionResultFromRefMutation(
      'deleteBranch',
      await deleteWorkbookVersionBranch(this.ctx, options),
    );
  }

  async deleteRef(options: VersionDeleteRefOptions): Promise<VersionResult<VersionRef>> {
    return versionResultFromRefMutation(
      'deleteRef',
      await deleteWorkbookVersionRef(this.ctx, options),
    );
  }

  private readGate(
    operation: string,
    capability: VersionCapability,
  ): readonly VersionStoreDiagnostic[] | null {
    const diagnostics = validateVersionOperationGate(this.ctx, operation, capability, {
      mutates: false,
    });
    return diagnostics.length > 0 ? diagnostics : null;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
