import type {
  CheckoutVersionResult,
  Paged,
  RedactedVersionAuthor, VersionBranchName, VersionBranchRefReadResult,
  VersionApplyMergeInput, VersionApplyMergeOptions, VersionApplyMergeResult,
  VersionCheckoutOptions, VersionCheckoutTarget, VersionCommitish,
  VersionCreateBranchOptions, VersionCommitOptions, VersionCommitPage, VersionDegradedHeadResult,
  VersionDeleteRefOptions, VersionDiffOptions, VersionDiagnosticPublicPayload,
  VersionFastForwardBranchOptions, VersionGetHeadOptions, VersionGetMergeConflictDetailRequest,
  VersionListCommitsOptions, VersionListRefsOptions, VersionMainRefName, VersionMergeInput, VersionMergeOptions,
  VersionMergeConflictDetailResult, VersionMergeResult, VersionPutMergeResolutionPayloadRequest,
  VersionPutMergeResolutionPayloadResult, VersionRecordRevision, VersionRef, VersionRefListResult,
  VersionRefMutationResult, VersionRefName, VersionRefReadResult, VersionRefSelector,
  VersionResult, VersionSaveMergeResolutionsRequest, VersionSaveMergeResolutionsResult,
  VersionSemanticDiffPage, VersionStoreDiagnostic, VersionSymbolicRef, VersionSymbolicRefReadResult,
  VersionUpdateBranchOptions, VersionHead, WorkbookCommitId, WorkbookCommitRef, WorkbookCommitSummary,
  WorkbookDiffPage, WorkbookVersion, WorkbookVersionCapabilityStatus, WorkbookVersionDiagnostic,
  WorkbookVersionRolloutStage, WorkbookVersionStatus,
} from '@mog-sdk/contracts/api';

import { observeMutationAdmission } from '../../bridges/compute/mutation-admission';
import type { DocumentContext } from '../../context';
import { VERSION_OBJECT_SCHEMA_VERSION } from '../../document/version-store/object-store';
import { REF_NAME_STORAGE_PREFIX } from '../../document/version-store/ref-name';
import { applyMergeWorkbookVersion } from './version-apply-merge';
import { checkoutWorkbookVersion, hasAttachedVersionCheckoutService, type VersionCheckoutTransactionGuard } from './version-checkout';
import { commitWorkbookVersion, hasAttachedVersionWriteService } from './version-commit';
import { diffWorkbookVersion } from './version-diff';
import { hasAttachedVersionMergeService, mergeWorkbookVersion } from './version-merge';
import { getMergeConflictDetailWorkbookVersion, putMergeResolutionPayloadWorkbookVersion, saveMergeResolutionsWorkbookVersion } from './version-merge-review-endpoints';
import { versionResultFromApplyMerge, versionResultFromCheckout, versionResultFromCommitPage, versionResultFromDiffPage, versionResultFromHead, versionResultFromMerge, versionResultFromRefList, versionResultFromRefMutation, versionResultFromRefRead } from './version-result';
import { getWorkbookVersionSurfaceStatus } from './version-surface-status';
import { createWorkbookVersionBranch, deleteWorkbookVersionBranch, deleteWorkbookVersionRef, fastForwardWorkbookVersionBranch, getWorkbookVersionRef, hasAttachedVersionRefLifecycleService, listWorkbookVersionRefs, readWorkbookVersionRef, updateWorkbookVersionBranch } from './version-refs';

const VERSION_HEAD_REF = 'HEAD';
const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const VERSION_LIST_COMMITS_DEFAULT_PAGE_SIZE = 50;
const VERSION_LIST_COMMITS_MAX_PAGE_SIZE = 500;
const VERSION_LIST_REFS_DEFAULT_PAGE_SIZE = 50;

type MaybePromise<T> = T | Promise<T>;

type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;
type VersionPublicOperation = 'getHead' | 'listCommits' | 'readRef';
type AttachedListCommitsOptions = {
  readonly ref?: VersionRefSelector;
  readonly from?: WorkbookCommitId;
  readonly pageSize?: number;
};

type AttachedVersionReadService = {
  readHead?: () => MaybePromise<unknown>;
  getHead?: () => MaybePromise<unknown>;
  readRef?: (name: string) => MaybePromise<unknown>;
  listCommits?: (options?: AttachedListCommitsOptions) => MaybePromise<unknown>;
};

type AttachedVersionServices = AttachedVersionReadService & {
  readonly objectStore?: unknown;
  readonly refStore?: unknown;
  readonly graphStore?: unknown;
  readonly graphService?: unknown;
  readonly graph?: unknown;
  readonly readService?: unknown;
  readonly headService?: unknown;
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
  const listCommits = bindMethod(value, 'listCommits');

  if (!readHead && !getHead && !readRef && !listCommits) return null;

  const service: AttachedVersionReadService = {};
  if (readHead) service.readHead = () => readHead();
  if (getHead) service.getHead = () => getHead();
  if (readRef) service.readRef = (name) => readRef(name);
  if (listCommits) {
    service.listCommits = (options) => listCommits(options);
  }
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

export class WorkbookVersionImpl implements WorkbookVersion {
  constructor(private readonly ctx: DocumentContext, private readonly options: { readonly checkoutTransactionGuard?: VersionCheckoutTransactionGuard } = {}) {}

  async getStatus(): Promise<WorkbookVersionStatus> {
    const services = getAttachedVersionServices(this.ctx);
    const writeServiceAttached = hasAttachedVersionWriteService(this.ctx);
    const refLifecycleServiceAttached = hasAttachedVersionRefLifecycleService(this.ctx);
    const checkoutServiceAttached = hasAttachedVersionCheckoutService(this.ctx);
    const mergeServiceAttached = hasAttachedVersionMergeService(this.ctx);
    const provenanceAdmissionPresent = typeof observeMutationAdmission === 'function';
    const rolloutStage = getRolloutStage(provenanceAdmissionPresent);

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
    const provenanceAdmission = diagnostic(
      provenanceAdmissionPresent
        ? 'version.provenanceAdmission.present'
        : 'version.provenanceAdmission.unavailable',
      provenanceAdmissionPresent ? 'info' : 'warning',
      provenanceAdmissionPresent
        ? 'Mutation provenance admission foundation is present.'
        : 'Mutation provenance admission foundation is unavailable.',
      'VC-02',
    );

    const objectStoreDiagnostics = services?.objectStore
      ? [objectStoreFoundation]
      : [objectStoreFoundation, objectStoreServiceUnavailable];
    const refLifecycleDiagnostics = refLifecycleServiceAttached || services?.refStore
      ? [refLifecycleFoundation]
      : [refLifecycleFoundation, refLifecycleServiceUnavailable];
    const commitApiDiagnostics = writeServiceAttached
      ? [commitApiServiceAttached]
      : [commitApiPending];
    const checkoutDiagnostics = checkoutServiceAttached
      ? [checkoutServiceAttachedDiagnostic]
      : [checkoutPending];
    const checkoutStage = checkoutServiceAttached ? 'present' : 'pending';
    const checkoutDependency = checkoutServiceAttached ? 'version-service' : 'VC-05';
    const diagnostics = [
      ...objectStoreDiagnostics,
      ...refLifecycleDiagnostics,
      ...commitApiDiagnostics,
      ...checkoutDiagnostics,
      mergeServiceAttached ? mergeServiceAttachedDiagnostic : mergePending,
      provenanceAdmission,
    ];
    return {
      schemaVersion: 1,
      rolloutStage,
      objectStoreFoundation: capability('present', true, 'VC-04', objectStoreDiagnostics),
      refLifecycleFoundation: capability('present', true, 'VC-05', refLifecycleDiagnostics),
      commitApi: capability(writeServiceAttached ? 'present' : 'pending', writeServiceAttached, 'VC-04', commitApiDiagnostics),
      checkout: capability(checkoutStage, checkoutServiceAttached, checkoutDependency, checkoutDiagnostics),
      merge: capability(
        mergeServiceAttached ? 'present' : 'pending',
        mergeServiceAttached,
        mergeServiceAttached ? 'version-service' : 'VC-07',
        [mergeServiceAttached ? mergeServiceAttachedDiagnostic : mergePending],
      ),
      provenanceAdmission: capability(
        provenanceAdmissionPresent ? 'present' : 'unavailable',
        provenanceAdmissionPresent,
        'VC-02',
        [provenanceAdmission],
      ),
      diagnostics,
    };
  }
  async getSurfaceStatus() { return getWorkbookVersionSurfaceStatus(this.ctx, await this.getStatus()); }
  async getHead(): Promise<VersionResult<VersionHead>>;
  async getHead(options: VersionGetHeadOptions): Promise<VersionResult<VersionHead>>;
  async getHead(_options: VersionGetHeadOptions = {}): Promise<VersionResult<VersionHead>> {
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
    } catch { return failHead([providerErrorDiagnostic('getHead')]); }
    return failHead([serviceUnavailableDiagnostic('getHead')]);
  }

  async listCommits(options: VersionListCommitsOptions = {}): Promise<VersionResult<Paged<WorkbookCommitSummary>>> {
    const limit = options.pageSize ?? VERSION_LIST_COMMITS_DEFAULT_PAGE_SIZE;
    const optionDiagnostics = validateListCommitsOptions(options);
    if (optionDiagnostics.length > 0) {
      return versionResultFromCommitPage(degradedCommitPage(optionDiagnostics), limit);
    }

    const readService = getAttachedVersionReadService(this.ctx);
    if (!readService?.listCommits) {
      return versionResultFromCommitPage(degradedCommitPage([serviceUnavailableDiagnostic('listCommits')]), limit);
    }

    try {
      const result = await readService.listCommits({
        ...(options.ref === undefined ? {} : { ref: options.ref }),
        ...(options.from === undefined ? {} : { from: options.from }),
        ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
      });
      return versionResultFromCommitPage(mapCommitPageResult(result), limit);
    } catch {
      return versionResultFromCommitPage(degradedCommitPage([providerErrorDiagnostic('listCommits')]), limit);
    }
  }
  async commit(options: VersionCommitOptions = {}): Promise<VersionResult<WorkbookCommitSummary>> { return commitWorkbookVersion(this.ctx, options); }
  async checkout(target: VersionCheckoutTarget, options: VersionCheckoutOptions = {}): Promise<VersionResult<CheckoutVersionResult>> {
    return versionResultFromCheckout(await checkoutWorkbookVersion(this.ctx, target, options, this.options.checkoutTransactionGuard));
  }
  async merge(input: VersionMergeInput, options: VersionMergeOptions = {}): Promise<VersionResult<VersionMergeResult>> {
    return versionResultFromMerge(await mergeWorkbookVersion(this.ctx, input, options));
  }
  async applyMerge(input: VersionApplyMergeInput, options: VersionApplyMergeOptions = {}): Promise<VersionResult<VersionApplyMergeResult>> {
    return versionResultFromApplyMerge(await applyMergeWorkbookVersion(this.ctx, input, options));
  }
  async saveMergeResolutions(input: VersionSaveMergeResolutionsRequest): Promise<VersionResult<VersionSaveMergeResolutionsResult>> { return saveMergeResolutionsWorkbookVersion(this.ctx, input); }
  async getMergeConflictDetail(input: VersionGetMergeConflictDetailRequest): Promise<VersionResult<VersionMergeConflictDetailResult>> { return getMergeConflictDetailWorkbookVersion(this.ctx, input); }
  async putMergeResolutionPayload(input: VersionPutMergeResolutionPayloadRequest): Promise<VersionResult<VersionPutMergeResolutionPayloadResult>> { return putMergeResolutionPayloadWorkbookVersion(this.ctx, input); }
  async diff(base: VersionCommitish, target: VersionCommitish, options: VersionDiffOptions = {}): Promise<VersionResult<VersionSemanticDiffPage>> {
    return versionResultFromDiffPage(await diffWorkbookVersion(this.ctx, base, target, options), options.pageSize ?? 50);
  }
  async readRef(name: 'HEAD'): Promise<VersionResult<VersionSymbolicRefReadResult>>;
  async readRef(name: VersionMainRefName | VersionRefName | VersionBranchName): Promise<VersionResult<VersionBranchRefReadResult>>;
  async readRef(name: VersionRefSelector | VersionBranchName): Promise<VersionResult<VersionRefReadResult>>;
  async readRef(name: VersionRefSelector | VersionBranchName): Promise<VersionResult<VersionRefReadResult>> {
    if (name !== VERSION_HEAD_REF && name !== VERSION_MAIN_REF) {
      return versionResultFromRefRead('readRef', await readWorkbookVersionRef(this.ctx, name));
    }

    const publicReadName = name as VersionRefSelector;
    const readService = getAttachedVersionReadService(this.ctx);
    if (!readService?.readRef) {
      return versionResultFromRefRead('readRef', degradedRef(null, [serviceUnavailableDiagnostic('readRef', { refName: publicReadName })]));
    }

    try {
      return versionResultFromRefRead('readRef', mapRefResult(await readService.readRef(publicReadName), publicReadName));
    } catch {
      return versionResultFromRefRead('readRef', degradedRef(null, [providerErrorDiagnostic('readRef', { refName: publicReadName })]));
    }
  }

  async getRef(name: 'HEAD'): Promise<VersionResult<VersionSymbolicRefReadResult>>;
  async getRef(name: VersionMainRefName | VersionRefName | VersionBranchName): Promise<VersionResult<VersionBranchRefReadResult>>;
  async getRef(name: VersionRefSelector | VersionBranchName): Promise<VersionResult<VersionRefReadResult>>;
  async getRef(name: VersionRefSelector | VersionBranchName): Promise<VersionResult<VersionRefReadResult>> {
    return versionResultFromRefRead('getRef', await getWorkbookVersionRef(this.ctx, name));
  }

  async listRefs(options: VersionListRefsOptions = {}): Promise<VersionResult<Paged<VersionRef>>> {
    return versionResultFromRefList(await listWorkbookVersionRefs(this.ctx, options), VERSION_LIST_REFS_DEFAULT_PAGE_SIZE);
  }

  async createBranch(options: VersionCreateBranchOptions): Promise<VersionResult<VersionRef>> { return versionResultFromRefMutation('createBranch', await createWorkbookVersionBranch(this.ctx, options)); }

  async fastForwardBranch(options: VersionFastForwardBranchOptions): Promise<VersionResult<VersionRef>> {
    return versionResultFromRefMutation('fastForwardBranch', await fastForwardWorkbookVersionBranch(this.ctx, options));
  }

  async updateBranch(options: VersionUpdateBranchOptions): Promise<VersionResult<VersionRef>> {
    return versionResultFromRefMutation('updateBranch', await updateWorkbookVersionBranch(this.ctx, options));
  }

  async deleteBranch(options: VersionDeleteRefOptions): Promise<VersionResult<VersionRef>> {
    return versionResultFromRefMutation('deleteBranch', await deleteWorkbookVersionBranch(this.ctx, options));
  }

  async deleteRef(options: VersionDeleteRefOptions): Promise<VersionResult<VersionRef>> {
    return versionResultFromRefMutation('deleteRef', await deleteWorkbookVersionRef(this.ctx, options));
  }
}

function validateListCommitsOptions(options: VersionListCommitsOptions): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  const pageSize = options.pageSize ?? VERSION_LIST_COMMITS_DEFAULT_PAGE_SIZE;

  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > VERSION_LIST_COMMITS_MAX_PAGE_SIZE
  ) {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_OPTIONS',
        'listCommits',
        'listCommits pageSize must be an integer from 1 through 500.',
        {
          severity: 'error',
          recoverability: 'none',
          payload: {
            option: 'pageSize',
            min: 1,
            max: VERSION_LIST_COMMITS_MAX_PAGE_SIZE,
            receivedPageSize: formatPrimitiveForPayload(pageSize),
          },
        },
      ),
    );
  }

  if (options.pageToken !== undefined) {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_STALE_PAGE_CURSOR',
        'listCommits',
        'listCommits page tokens are not supported by this version graph read slice.',
        {
          severity: 'error',
          recoverability: 'unsupported',
          payload: { option: 'pageToken', pageTokenUnsupported: true },
        },
      ),
    );
  }

  if (options.ref !== undefined && options.from !== undefined) {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_OPTIONS',
        'listCommits',
        'listCommits accepts either ref or from, not both.',
        { severity: 'error', recoverability: 'none', payload: { option: 'ref' } },
      ),
    );
  }

  if (options.ref !== undefined && !toRefSelector(options.ref)) {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_OPTIONS',
        'listCommits',
        'listCommits ref must be HEAD or refs/heads/<public branch>.',
        { severity: 'error', recoverability: 'none', payload: { option: 'ref' } },
      ),
    );
  }

  if (options.from !== undefined && !toCommitId(options.from)) {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_ID',
        'listCommits',
        'listCommits from must be commit:sha256:<64 lowercase hex>.',
        { severity: 'error', recoverability: 'none', payload: { option: 'from' } },
      ),
    );
  }

  if (options.includeOrphans === true) {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_PERMISSION_DENIED',
        'listCommits',
        'Orphan commit listing requires diagnostics support that is not exposed by this slice.',
        {
          severity: 'error',
          recoverability: 'unsupported',
          payload: { option: 'includeOrphans' },
        },
      ),
    );
  }

  return diagnostics;
}

function mapHeadResult(value: unknown): WorkbookCommitRef | VersionDegradedHeadResult {
  if (!isRecord(value)) {
    return degradedHead([providerErrorDiagnostic('getHead')]);
  }

  if (value.status === 'success') {
    const head = mapCommitRef(value.head);
    if (head) return head;
    return degradedHead([
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'getHead',
        'The version graph head result did not contain a valid public commit ref.',
        { severity: 'error', recoverability: 'repair' },
      ),
    ]);
  }

  if (value.status === 'degraded' || value.status === 'failed') {
    const ref = mapRef(value.ref) ?? mapRef(value.main);
    return degradedHead(mapGraphDiagnostics(value.diagnostics, 'getHead'), ref ?? undefined);
  }

  return mapLegacyHeadResult(value);
}

function mapLegacyHeadResult(value: unknown): WorkbookCommitRef | VersionDegradedHeadResult {
  if (value === null) {
    return degradedHead([graphUninitializedDiagnostic('getHead')]);
  }

  if (!isRecord(value)) {
    return degradedHead([providerErrorDiagnostic('getHead')]);
  }

  if ('head' in value) {
    const head = mapLegacyHead(value.head);
    if (head) return head;
    return degradedHead(mapGraphDiagnostics(value.diagnostics, 'getHead'));
  }

  const head = mapLegacyHead(value);
  if (head) return head;
  return degradedHead([providerErrorDiagnostic('getHead')]);
}

function mapLegacyHead(value: unknown): WorkbookCommitRef | null {
  if (!isRecord(value)) return null;
  const id = toCommitId(value.commitId);
  if (!id) return null;
  const refName = legacyBranchNameToRefName(value.branchName);
  return {
    id,
    ...(refName ? { refName } : {}),
    ...(refName ? { resolvedFrom: VERSION_HEAD_REF } : {}),
  };
}

function mapCommitPageResult(value: unknown): VersionCommitPage {
  if (!isRecord(value)) {
    return degradedCommitPage([providerErrorDiagnostic('listCommits')]);
  }

  if (value.status === 'failed' || value.status === 'degraded') {
    return degradedCommitPage(mapGraphDiagnostics(value.diagnostics, 'listCommits'));
  }

  if (value.status !== 'success') {
    return degradedCommitPage([providerErrorDiagnostic('listCommits')]);
  }

  const readRevision = toRevision(value.readRevision);
  const sourceItems = Array.isArray(value.commits)
    ? value.commits
    : Array.isArray(value.items)
      ? value.items
      : null;

  if (!readRevision || !sourceItems) {
    return degradedCommitPage([
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'listCommits',
        'The version graph commit page did not contain a valid public page shape.',
        { severity: 'error', recoverability: 'repair' },
      ),
    ]);
  }

  const { items, diagnostics } = mapCommitSummaries(sourceItems);
  if (diagnostics.length > 0) {
    return {
      status: 'degraded',
      items,
      readRevision,
      order: 'topological-newest',
      diagnostics,
    };
  }

  return {
    status: 'success',
    items,
    readRevision,
    order: 'topological-newest',
    diagnostics: [],
  };
}

function mapRefResult(value: unknown, requestedName: VersionRefSelector): VersionRefReadResult {
  if (!isRecord(value)) {
    return degradedRef(null, [providerErrorDiagnostic('readRef', { refName: requestedName })]);
  }

  if (value.status === 'success') {
    const ref = mapRef(value.ref);
    if (ref) {
      return { status: 'success', ref, diagnostics: [] } as VersionRefReadResult;
    }
    return degradedRef(null, [
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'readRef',
        'The version graph ref result did not contain a valid public ref.',
        {
          severity: 'error',
          recoverability: 'repair',
          payload: { refName: requestedName },
        },
      ),
    ]);
  }

  if (value.status === 'degraded' || value.status === 'failed') {
    return degradedRef(
      mapRef(value.ref),
      mapGraphDiagnostics(value.diagnostics, 'readRef', { refName: requestedName }),
    );
  }

  return degradedRef(null, [providerErrorDiagnostic('readRef', { refName: requestedName })]);
}

function mapCommitRef(value: unknown): WorkbookCommitRef | null {
  if (!isRecord(value)) return null;
  const id = toCommitId(value.id);
  if (!id) return null;

  const refName = toRefName(value.refName);
  const resolvedFrom = toRefSelector(value.resolvedFrom);
  const refRevision = toRevision(value.refRevision);

  return {
    id,
    ...(refName ? { refName } : {}),
    ...(resolvedFrom ? { resolvedFrom } : {}),
    ...(refRevision ? { refRevision } : {}),
  };
}

function mapRef(value: unknown): VersionRef | VersionSymbolicRef | null {
  if (!isRecord(value)) return null;

  if (value.name === VERSION_HEAD_REF) {
    const target = toRefName(value.target);
    const revision = toRevision(value.revision);
    if (!target || !revision) return null;
    return { name: VERSION_HEAD_REF, target, revision };
  }

  const name = toRefName(value.name);
  const commitId = toCommitId(value.commitId);
  const revision = toRevision(value.revision);
  if (!name || !commitId || !revision) return null;

  return {
    name,
    commitId,
    revision,
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
  };
}

function mapCommitSummaries(values: readonly unknown[]): {
  readonly items: readonly WorkbookCommitSummary[];
  readonly diagnostics: readonly VersionStoreDiagnostic[];
} {
  const items: WorkbookCommitSummary[] = [];
  const diagnostics: VersionStoreDiagnostic[] = [];

  values.forEach((value, index) => {
    const summary = mapCommitSummary(value);
    if (summary) {
      items.push(summary);
      return;
    }

    diagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'listCommits',
        'A version graph commit summary could not be safely projected.',
        {
          severity: 'error',
          recoverability: 'repair',
          payload: { itemIndex: index },
        },
      ),
    );
  });

  return { items, diagnostics };
}

function mapCommitSummary(value: unknown): WorkbookCommitSummary | null {
  if (!isRecord(value)) return null;

  const id = toCommitId(value.id);
  if (!id || typeof value.createdAt !== 'string') return null;

  const parents = Array.isArray(value.parents)
    ? value.parents.map(toCommitId).filter((parent): parent is WorkbookCommitId => Boolean(parent))
    : null;
  if (!parents || parents.length !== (value.parents as readonly unknown[]).length) return null;

  return {
    id,
    parents,
    createdAt: value.createdAt,
    author: redactAuthor(value.author),
  };
}

function redactAuthor(value: unknown): RedactedVersionAuthor {
  if (!isRecord(value)) return { redacted: true };
  return {
    ...(typeof value.actorKind === 'string' ? { actorKind: value.actorKind } : {}),
    ...(typeof value.displayName === 'string' ? { displayName: value.displayName } : {}),
    redacted: true,
  };
}

function mapGraphDiagnostics(
  value: unknown,
  operation: VersionPublicOperation,
  fallbackPayload: VersionDiagnosticPublicPayload = {},
): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [graphUninitializedDiagnostic(operation, fallbackPayload)];
  }

  return value.map((diagnosticValue) =>
    mapGraphDiagnostic(diagnosticValue, operation, fallbackPayload),
  );
}

function mapGraphDiagnostic(
  value: unknown,
  operation: VersionPublicOperation,
  fallbackPayload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  if (!isRecord(value)) {
    return providerErrorDiagnostic(operation, fallbackPayload);
  }

  const issueCode =
    typeof value.issueCode === 'string'
      ? value.issueCode
      : typeof value.code === 'string'
        ? value.code
        : 'VERSION_PROVIDER_ERROR';
  const severity = value.severity === 'corruption' ? 'error' : value.severity;

  return publicDiagnostic(issueCode, operation, safeMessageForIssue(issueCode, operation), {
    severity:
      severity === 'info' || severity === 'warning' || severity === 'error' || severity === 'fatal'
        ? severity
        : 'error',
    recoverability: recoverabilityForIssue(issueCode),
    payload: sanitizeDiagnosticPayload(value, operation, fallbackPayload),
  });
}

function sanitizeDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
  operation: VersionPublicOperation,
  fallbackPayload: VersionDiagnosticPublicPayload,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = {
    operation,
    ...fallbackPayload,
  };

  if (typeof value.operation === 'string') payload.operation = value.operation;
  if (typeof value.option === 'string') payload.option = value.option;
  const refName = value.refName;
  if (refName === VERSION_HEAD_REF || refName === VERSION_MAIN_REF) {
    payload.refName = refName;
  }

  const details = isRecord(value.details) ? value.details : null;
  if (details) {
    for (const key of [
      'min',
      'max',
      'pageSize',
      'receivedPageSize',
      'pageTokenUnsupported',
    ] as const) {
      const detailValue = details[key];
      if (isPayloadPrimitive(detailValue)) payload[key] = detailValue;
    }
  }

  return payload;
}

function serviceUnavailableDiagnostic(
  operation: VersionPublicOperation,
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    operation,
    'No document-scoped version graph read service is attached; no commit history is fabricated.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
      payload,
    },
  );
}

function graphUninitializedDiagnostic(
  operation: VersionPublicOperation,
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    operation,
    'The workbook version graph is not initialized for this document.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
      payload,
    },
  );
}

function providerErrorDiagnostic(
  operation: VersionPublicOperation,
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    operation,
    'The version graph read service failed before returning a usable public result.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

function publicDiagnostic(
  issueCode: string,
  operation: VersionPublicOperation,
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionDiagnosticPublicPayload;
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId: `version.${operation}.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: options.payload } : {}),
    redacted: true,
  };
}

function safeMessageForIssue(issueCode: string, operation: VersionPublicOperation): string {
  switch (issueCode) {
    case 'VERSION_GRAPH_UNINITIALIZED':
      return 'The workbook version graph is not initialized for this document.';
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'The version page token is stale or unsupported by this read slice.';
    case 'VERSION_UNSUPPORTED_PAGE_TOKEN':
      return 'The version graph cannot serve a follow-up page token in this slice.';
    case 'VERSION_INVALID_OPTIONS':
      return 'The version read options are invalid for this method.';
    case 'VERSION_PERMISSION_DENIED':
      return 'The requested version read is not exposed by this public slice.';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'The version graph could not validate the requested commit closure.';
    case 'VERSION_REF_CONFLICT':
      return 'The version ref changed while the read was in progress.';
    default:
      return `The version graph could not complete ${operation}.`;
  }
}

function recoverabilityForIssue(issueCode: string): VersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_STALE_PAGE_CURSOR':
    case 'VERSION_REF_CONFLICT':
      return 'retry';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'repair';
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_UNSUPPORTED_PAGE_TOKEN':
    case 'VERSION_PERMISSION_DENIED':
      return 'unsupported';
    default:
      return 'none';
  }
}

function degradedHead(
  diagnostics: readonly VersionStoreDiagnostic[],
  ref?: VersionRef | VersionSymbolicRef,
): VersionDegradedHeadResult {
  return {
    status: 'degraded',
    ...(ref ? { ref } : {}),
    diagnostics,
  };
}

function degradedCommitPage(diagnostics: readonly VersionStoreDiagnostic[]): VersionCommitPage {
  return {
    status: 'degraded',
    items: [],
    order: 'topological-newest',
    diagnostics,
  };
}

function degradedRef(
  ref: VersionRef | VersionSymbolicRef | null,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionRefReadResult {
  return {
    status: 'degraded',
    ref,
    diagnostics,
  };
}

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function toRevision(value: unknown): VersionRecordRevision | undefined {
  if (isRecord(value) && value.kind === 'counter' && typeof value.value === 'string') {
    return { kind: 'counter', value: value.value };
  }
  if (isRecord(value) && value.kind === 'opaque' && typeof value.value === 'string') {
    return { kind: 'opaque', value: value.value };
  }
  if (typeof value === 'string') return { kind: 'opaque', value };
  return undefined;
}

function toRefSelector(value: unknown): VersionRefSelector | undefined {
  if (value === VERSION_HEAD_REF) return VERSION_HEAD_REF;
  return toRefName(value);
}

function toRefName(value: unknown): VersionMainRefName | VersionRefName | undefined {
  if (value === VERSION_MAIN_REF) return VERSION_MAIN_REF;
  if (typeof value === 'string' && value.startsWith('refs/heads/')) {
    return value as VersionRefName;
  }
  return undefined;
}

function legacyBranchNameToRefName(
  value: unknown,
): VersionMainRefName | VersionRefName | undefined {
  if (value === undefined) return undefined;
  if (value === 'main') return VERSION_MAIN_REF;
  if (typeof value === 'string' && value.startsWith('refs/heads/')) return value as VersionRefName;
  if (typeof value === 'string' && value.length > 0) return `refs/heads/${value}` as VersionRefName;
  return undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function formatPrimitiveForPayload(value: unknown): string | number | boolean | null {
  return isPayloadPrimitive(value) ? value : String(value);
}
