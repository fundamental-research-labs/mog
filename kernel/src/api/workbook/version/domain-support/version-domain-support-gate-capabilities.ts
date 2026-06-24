import type { DocumentContext } from '../../../../context';
import {
  hasAttachedVersionReviewReadService,
  hasAttachedVersionReviewWriteService,
} from '../review/version-review-service-discovery';
import {
  hasMethod,
  isRecord,
  type MaybeDomainSupportManifestContext,
  type VersionDomainSupportManifestGateOperation,
} from './version-domain-support-gate-types';

export function isVersionDomainSupportManifestRequired(
  ctx: DocumentContext,
  operation: VersionDomainSupportManifestGateOperation,
): boolean {
  const runtime = ctx as MaybeDomainSupportManifestContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return false;

  switch (operation) {
    case 'commit':
      return hasCommitService(services);
    case 'diff':
      return hasDiffService(services);
    case 'checkout':
      return hasCheckoutService(services);
    case 'merge':
      return hasMergeService(services);
    case 'applyMerge':
      return hasApplyMergeService(services) || hasMergeService(services);
    case 'review':
    case 'reviewAccess':
      return (
        hasAttachedVersionReviewReadService(services) ||
        hasAttachedVersionReviewWriteService(services)
      );
    case 'import':
      return hasImportService(services);
    case 'export':
      return hasVersionOperationService(services);
    case 'revert':
    case 'undo':
    case 'redo':
      return hasRevertService(services);
  }
}

function hasVersionOperationService(services: Readonly<Record<string, unknown>>): boolean {
  if (
    hasCommitService(services) ||
    hasCheckoutService(services) ||
    hasMergeService(services) ||
    hasApplyMergeService(services)
  ) {
    return true;
  }

  for (const candidate of [
    services.provider,
    services.readService,
    services.refService,
    services.refsService,
    services.branchService,
    services.publicService,
    services.graphService,
    services.graphStore,
    services.graph,
    services,
  ]) {
    if (isRawGraphStore(candidate)) return true;
    if (
      hasMethod(candidate, 'getHead') ||
      hasMethod(candidate, 'listCommits') ||
      hasMethod(candidate, 'listRefs') ||
      hasMethod(candidate, 'readCommit') ||
      hasMethod(candidate, 'readCommitClosure') ||
      hasMethod(candidate, 'getCommit')
    ) {
      return true;
    }
  }

  return false;
}

function hasCommitService(services: Readonly<Record<string, unknown>>): boolean {
  for (const candidate of [
    services.writeService,
    services.commitService,
    services.versionWriteService,
    services.publicService,
    services.graphService,
    services,
  ]) {
    if (isRawGraphStore(candidate)) continue;
    if (hasMethod(candidate, 'commit') || hasMethod(candidate, 'commitVersion')) return true;
  }
  return false;
}

function hasCheckoutService(services: Readonly<Record<string, unknown>>): boolean {
  for (const candidate of [
    services.checkoutService,
    services.checkoutMaterializationService,
    services.materializationService,
    services.versionCheckoutService,
    services.publicCheckoutService,
    services,
  ]) {
    if (hasMethod(candidate, 'planCheckout') || hasMethod(candidate, 'checkout')) return true;
  }
  return false;
}

function hasMergeService(services: Readonly<Record<string, unknown>>): boolean {
  for (const candidate of [
    services.mergeService,
    services.versionMergeService,
    services.publicService,
    services.readService,
    services.graphService,
    services.graphStore,
    services.graph,
    services,
  ]) {
    if (
      hasMethod(candidate, 'merge') ||
      hasMethod(candidate, 'mergeVersions') ||
      hasMethod(candidate, 'mergeCommits')
    ) {
      return true;
    }
  }
  return false;
}

function hasDiffService(services: Readonly<Record<string, unknown>>): boolean {
  for (const candidate of [
    services.diffService,
    services.versionDiffService,
    services.publicService,
    services.readService,
    services.graphService,
    services.graphStore,
    services.graph,
    services,
  ]) {
    if (
      hasMethod(candidate, 'diff') ||
      hasMethod(candidate, 'diffVersions') ||
      hasMethod(candidate, 'diffCommits') ||
      hasMethod(candidate, 'getDiff')
    ) {
      return true;
    }
  }
  return false;
}

function hasApplyMergeService(services: Readonly<Record<string, unknown>>): boolean {
  for (const candidate of [
    services.applyMergeService,
    services.versionApplyMergeService,
    services.writeService,
    services.versionWriteService,
    services.commitService,
    services.publicService,
    services,
  ]) {
    if (
      hasMethod(candidate, 'mergeCommit') ||
      hasMethod(candidate, 'applyMerge') ||
      hasMethod(candidate, 'applyMergeVersion') ||
      hasMethod(candidate, 'applyMergeCommit') ||
      hasMethod(candidate, 'fastForwardMerge') ||
      hasMethod(candidate, 'fastForward') ||
      hasMethod(candidate, 'fastForwardApplyMerge') ||
      hasMethod(candidate, 'applyMergeFastForward') ||
      hasMethod(candidate, 'applyFastForwardMerge')
    ) {
      return true;
    }
  }
  return false;
}

function hasRevertService(services: Readonly<Record<string, unknown>>): boolean {
  for (const candidate of [
    services.revertService,
    services.versionRevertService,
    services.publicService,
    services.writeService,
    services.commitService,
    services,
  ]) {
    if (
      hasMethod(candidate, 'revert') ||
      hasMethod(candidate, 'revertVersion') ||
      hasMethod(candidate, 'revertCommit') ||
      hasMethod(candidate, 'revertCommits') ||
      hasMethod(candidate, 'undo') ||
      hasMethod(candidate, 'redo')
    ) {
      return true;
    }
  }
  return false;
}

function hasImportService(services: Readonly<Record<string, unknown>>): boolean {
  for (const candidate of [
    services.importService,
    services.versionImportService,
    services.syncImportService,
    services.publicService,
    services,
  ]) {
    if (
      hasMethod(candidate, 'import') ||
      hasMethod(candidate, 'importWorkbook') ||
      hasMethod(candidate, 'importXlsx') ||
      hasMethod(candidate, 'importVersion') ||
      hasMethod(candidate, 'syncImport') ||
      hasMethod(candidate, 'recordImport')
    ) {
      return true;
    }
  }
  return false;
}

function isRawGraphStore(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.commit === 'function' &&
    typeof value.initializeGraph === 'function' &&
    typeof value.readCommitClosure === 'function'
  );
}
