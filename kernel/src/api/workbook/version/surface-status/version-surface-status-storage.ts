import type { VersionDiagnostic, VersionSurfaceStatus } from '@mog-sdk/contracts/api';

import {
  bindMethod,
  isRecord,
  normalizeBackend,
  surfaceDiagnostic,
} from './version-surface-status-utils';

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

function firstRecord(values: readonly unknown[]): Readonly<Record<string, unknown>> | null {
  return values.find(isRecord) ?? null;
}
