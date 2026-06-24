import type { VersionListCommitsOptions } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import {
  hasAttachedVersionReviewReadService,
  hasAttachedVersionReviewWriteService,
} from '../review/version-review-service-discovery';
import * as proposalServiceDiscovery from '../proposals/version-proposal-service-discovery';
import {
  hasAttachedVersionApplyMergeService,
  hasAttachedVersionDiffService,
} from './version-surface-status-storage';
import type { MaybePromise } from './version-surface-status-service-types';
import { bindMethod, isRecord } from './version-surface-status-utils';

type AttachedListCommitsOptions = Pick<VersionListCommitsOptions, 'ref' | 'from' | 'pageSize'>;

export type AttachedVersionReadService = {
  readHead?: () => MaybePromise<unknown>;
  getHead?: () => MaybePromise<unknown>;
  readRef?: (name: string) => MaybePromise<unknown>;
  listCommits?: (options?: AttachedListCommitsOptions) => MaybePromise<unknown>;
};

export type AttachedVersionServices = AttachedVersionReadService & {
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
  readonly reviewService?: unknown;
  readonly versionReviewService?: unknown;
  readonly reviewRecordService?: unknown;
  readonly reviewMetadataStore?: unknown;
  readonly proposalService?: unknown;
  readonly versionProposalService?: unknown;
  readonly agentProposalService?: unknown;
  readonly proposalWorkspaceService?: unknown;
  readonly proposalMetadataStore?: unknown;
  readonly proposalStore?: unknown;
  readonly pendingRemotePromotionService?: unknown;
  readonly promotePendingRemoteSegments?: unknown;
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
  readonly kernelHostContext?: unknown;
  readonly documentId?: unknown;
  readonly docId?: unknown;
};

export function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? (services as AttachedVersionServices) : null;
}

export function getAttachedVersionReadService(
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

export function hasAnyVersionAttachment(services: AttachedVersionServices): boolean {
  return Boolean(
    services.provider ||
    services.storageProvider ||
    services.objectStore ||
    services.refStore ||
    getAttachedVersionReadService(services) ||
    hasAttachedVersionDiffService(services) ||
    hasAttachedVersionReviewReadService(services) ||
    hasAttachedVersionReviewWriteService(services) ||
    proposalServiceDiscovery.hasAttachedVersionProposalService(services) ||
    hasAttachedVersionApplyMergeService(services) ||
    bindMethod(services.pendingRemotePromotionService, 'promotePendingRemoteSegments') ||
    bindMethod(services.publicService, 'promotePendingRemoteSegments') ||
    bindMethod(services, 'promotePendingRemoteSegments') ||
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

export function getDocumentId(
  ctx: DocumentContext,
  services: AttachedVersionServices | null,
): string {
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
    ...(listCommits
      ? { listCommits: (options?: AttachedListCommitsOptions) => listCommits(options) }
      : {}),
  };
}

function readNestedString(value: unknown, path: readonly string[]): string | null {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === 'string' && current.length > 0 ? current : null;
}
