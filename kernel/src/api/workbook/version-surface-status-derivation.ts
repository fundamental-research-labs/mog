import type {
  VersionCapabilityDependency,
  VersionDiagnostic,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { validateVersionDomainSupportManifestGate } from './version-domain-support-gate';
import type { SurfaceVersionCapability } from './version-surface-status-service';

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly featureGates?: unknown;
  readonly hostFeatureGates?: unknown;
  readonly gates?: unknown;
};

type CapabilityArea = 'reads' | 'writes';
type VersionDomainSupportOperation = 'commit' | 'checkout' | 'merge' | 'applyMerge';

export type VersionSurfaceCapabilityAvailability = {
  readonly read: boolean;
  readonly diff: boolean;
  readonly commit: boolean;
  readonly branch: boolean;
  readonly checkout: boolean;
  readonly reviewRead: boolean;
  readonly reviewWrite: boolean;
  readonly proposal: boolean;
  readonly mergePreview: boolean;
  readonly mergeApply: boolean;
  readonly refAdmin: boolean;
  readonly provenance: boolean;
  readonly remotePromote: boolean;
};

export type VersionSurfaceCapabilityBlock = {
  readonly dependency: VersionCapabilityDependency;
  readonly reason: string;
  readonly retryable: boolean;
  readonly code: VersionDiagnostic['code'];
  readonly diagnostics?: readonly VersionDiagnostic[];
};

export type VersionSurfaceCapabilityBlocks = Partial<
  Record<SurfaceVersionCapability, VersionSurfaceCapabilityBlock>
>;

export type VersionSurfaceOperationFeatureGates = {
  readonly checkoutEnabled: boolean;
  readonly checkoutDiscovered: boolean;
  readonly revertEnabled: boolean;
  readonly revertDiscovered: boolean;
};

export async function deriveVersionSurfaceCapabilityBlocks(input: {
  readonly ctx: DocumentContext;
  readonly services: unknown;
  readonly availability: VersionSurfaceCapabilityAvailability;
}): Promise<VersionSurfaceCapabilityBlocks> {
  const blocks: VersionSurfaceCapabilityBlocks = {
    ...deriveProviderCapabilityBlocks(input.services, input.availability),
  };
  const domainBlocks = await deriveDomainSupportCapabilityBlocks(input.ctx, input.availability);
  return { ...blocks, ...domainBlocks };
}

export function getVersionSurfaceOperationFeatureGates(
  ctx: DocumentContext,
): VersionSurfaceOperationFeatureGates {
  const runtime = ctx as MaybeVersionRuntimeContext;
  let checkout: boolean | undefined;
  let revert: boolean | undefined;
  for (const candidate of [runtime.featureGates, runtime.hostFeatureGates, runtime.gates]) {
    checkout ??= readOperationFeatureGate(candidate, 'checkout');
    revert ??= readOperationFeatureGate(candidate, 'revert');
  }
  return {
    checkoutEnabled: checkout ?? true,
    checkoutDiscovered: checkout !== undefined,
    revertEnabled: revert ?? true,
    revertDiscovered: revert !== undefined,
  };
}

function deriveProviderCapabilityBlocks(
  services: unknown,
  availability: VersionSurfaceCapabilityAvailability,
): VersionSurfaceCapabilityBlocks {
  const provider = readProviderCapabilities(services);
  if (!provider) return {};

  const blocks: VersionSurfaceCapabilityBlocks = {};
  const readGraph = providerCapability(provider, 'reads', 'graphRegistry');
  const readObjects = providerCapability(provider, 'reads', 'objects');
  const readRefs = providerCapability(provider, 'reads', 'refs');
  const readCommits = providerCapability(provider, 'reads', 'commits');
  const writeCommits =
    !provider.readOnlyHistory &&
    providerCapability(provider, 'writes', 'commitGraphWrite') &&
    providerCapability(provider, 'writes', 'putObjects');
  const writeRefs = !provider.readOnlyHistory && providerCapability(provider, 'writes', 'updateRefs');

  if (availability.diff && (!readGraph || !readCommits || !readObjects)) {
    blocks['version:diff'] = providerBlock(
      'version.surfaceStatus.diffUnavailable',
      'Semantic diff requires provider graph, commit, and object reads.',
      true,
    );
  }
  if (availability.commit && (!readGraph || !writeCommits)) {
    blocks['version:commit'] = providerBlock(
      'version.surfaceStatus.commitUnavailable',
      readGraph
        ? 'The attached version storage provider is read-only for commit writes.'
        : 'Version commits require provider graph reads.',
      !readGraph,
    );
  }
  if (availability.branch && (!readGraph || !readRefs || !writeRefs)) {
    blocks['version:branch'] = providerBlock(
      'version.surfaceStatus.branchUnavailable',
      writeRefs
        ? 'Version branch lifecycle requires provider graph and ref reads.'
        : 'The attached version storage provider is read-only for ref writes.',
      !readGraph || !readRefs,
    );
  }
  if (availability.checkout && (!readGraph || !readCommits)) {
    blocks['version:checkout'] = providerBlock(
      'version.surfaceStatus.checkoutUnavailable',
      'Version checkout requires provider graph and commit reads.',
      true,
    );
  }
  if (availability.mergePreview && (!readGraph || !readCommits || !readObjects)) {
    blocks['version:mergePreview'] = providerBlock(
      'version.surfaceStatus.mergePreviewUnavailable',
      'Version merge preview requires provider graph, commit, and object reads.',
      true,
    );
  }
  if (availability.mergeApply && (!readGraph || !writeCommits)) {
    blocks['version:mergeApply'] = providerBlock(
      'version.surfaceStatus.mergeApplyUnavailable',
      readGraph
        ? 'The attached version storage provider is read-only for merge-apply writes.'
        : 'Version merge apply requires provider graph reads.',
      !readGraph,
    );
  }
  if (availability.refAdmin && (!readGraph || !readRefs || !writeRefs)) {
    blocks['version:refAdmin'] = providerBlock(
      'version.surfaceStatus.refAdminUnavailable',
      writeRefs
        ? 'Version ref admin requires provider graph and ref reads.'
        : 'The attached version storage provider is read-only for ref-admin writes.',
      !readGraph || !readRefs,
    );
  }
  if (availability.remotePromote && (!readGraph || !writeCommits)) {
    blocks['version:remotePromote'] = providerBlock(
      'version.surfaceStatus.remotePromoteUnavailable',
      readGraph
        ? 'The attached version storage provider is read-only for pending remote promotion.'
        : 'Pending remote promotion requires provider graph reads.',
      !readGraph,
    );
  }
  return blocks;
}

async function deriveDomainSupportCapabilityBlocks(
  ctx: DocumentContext,
  availability: VersionSurfaceCapabilityAvailability,
): Promise<VersionSurfaceCapabilityBlocks> {
  const entries: readonly {
    readonly capability: SurfaceVersionCapability;
    readonly operation: VersionDomainSupportOperation;
    readonly available: boolean;
  }[] = [
    { capability: 'version:commit', operation: 'commit', available: availability.commit },
    { capability: 'version:checkout', operation: 'checkout', available: availability.checkout },
    { capability: 'version:mergePreview', operation: 'merge', available: availability.mergePreview },
    { capability: 'version:mergeApply', operation: 'applyMerge', available: availability.mergeApply },
  ];
  const blocks: VersionSurfaceCapabilityBlocks = {};
  await Promise.all(
    entries
      .filter((entry) => entry.available)
      .map(async (entry) => {
        const diagnostics = await validateVersionDomainSupportManifestGate(ctx, entry.operation);
        if (diagnostics.length === 0) return;
        blocks[entry.capability] = domainSupportBlock(entry.operation, diagnostics);
      }),
  );
  return blocks;
}

function providerBlock(
  code: VersionDiagnostic['code'],
  reason: string,
  retryable: boolean,
): VersionSurfaceCapabilityBlock {
  return { dependency: 'storage', reason, retryable, code };
}

function domainSupportBlock(
  operation: VersionDomainSupportOperation,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionSurfaceCapabilityBlock {
  const issueCodes = new Set(diagnostics.map((diagnostic) => diagnostic.issueCode));
  const invalidDiagnosticCodes = new Set(
    diagnostics
      .map((diagnostic) => diagnostic.payload?.diagnosticCode)
      .filter((code): code is string => typeof code === 'string'),
  );
  const readFailed = issueCodes.has('VERSION_DOMAIN_SUPPORT_MANIFEST_READ_FAILED');
  const missing = issueCodes.has('VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING');
  const stale = invalidDiagnosticCodes.has('manifest-stale');
  return {
    dependency: 'storage',
    reason: domainSupportBlockReason({ readFailed, missing, stale }),
    retryable: readFailed || missing || stale,
    code: readFailed
      ? 'version.surfaceStatus.domainSupportManifestReadFailed'
      : missing
        ? 'version.surfaceStatus.domainSupportManifestMissing'
        : 'version.surfaceStatus.domainSupportManifestInvalid',
    diagnostics: diagnostics.map((diagnostic) =>
      projectDomainSupportDiagnostic(operation, diagnostic),
    ),
  };
}

function domainSupportBlockReason(input: {
  readonly readFailed: boolean;
  readonly missing: boolean;
  readonly stale: boolean;
}): string {
  if (input.readFailed) {
    return 'The document domain support manifest could not be read for this version capability.';
  }
  if (input.missing) {
    return 'A required document domain support manifest is not attached for this version capability.';
  }
  if (input.stale) {
    return 'The attached document domain support manifest is stale for this version capability.';
  }
  return 'The attached document domain support manifest is invalid for this version capability.';
}

function projectDomainSupportDiagnostic(
  operation: VersionDomainSupportOperation,
  diagnostic: VersionStoreDiagnostic,
): VersionDiagnostic {
  return {
    code: 'version.surfaceStatus.domainSupportManifestDiagnostic',
    severity: diagnostic.severity === 'fatal' ? 'error' : diagnostic.severity,
    message: diagnostic.safeMessage,
    dependency: 'storage',
    data: {
      operation,
      issueCode: diagnostic.issueCode,
      recoverability: diagnostic.recoverability,
      redacted: diagnostic.redacted,
      ...(diagnostic.mutationGuarantee
        ? { mutationGuarantee: diagnostic.mutationGuarantee }
        : {}),
      ...(diagnostic.payload ? { payload: diagnostic.payload } : {}),
    },
  };
}

function readProviderCapabilities(services: unknown): Readonly<Record<string, unknown>> | null {
  if (!isRecord(services)) return null;
  const provider = [
    services.provider,
    services.storageProvider,
    services.objectStore,
    services.refStore,
    services.graphStore,
    services.graphService,
    services.graph,
    services.publicService,
    services,
  ].find((candidate) => isRecord(candidate) && isRecord(candidate.capabilities));
  return isRecord(provider) && isRecord(provider.capabilities) ? provider.capabilities : null;
}

function providerCapability(
  capabilities: Readonly<Record<string, unknown>>,
  area: CapabilityArea,
  key: string,
): boolean {
  const scoped = isRecord(capabilities[area]) ? capabilities[area] : null;
  return scoped?.[key] !== false;
}

function readOperationFeatureGate(value: unknown, operation: 'checkout' | 'revert'): boolean | undefined {
  if (!isRecord(value)) return undefined;
  const pascal = operation[0].toUpperCase() + operation.slice(1);
  const keys = [`versionControl${pascal}`, `versionControl.${operation}`];
  const capabilities = isRecord(value.capabilities) ? value.capabilities : null;
  const capabilityGate = readBoolean(capabilities, keys);
  if (capabilityGate !== undefined) return capabilityGate;
  const directGate = readBoolean(value, keys);
  if (directGate !== undefined) return directGate;
  const versionControl = isRecord(value.versionControl) ? value.versionControl : null;
  const nestedVersionGate = readBoolean(versionControl, [operation, `${operation}Enabled`]);
  if (nestedVersionGate !== undefined) return nestedVersionGate;
  const operationGate = isRecord(value[operation]) ? value[operation] : null;
  const nestedOperationGate = readBoolean(operationGate, ['enabled']);
  if (nestedOperationGate !== undefined) return nestedOperationGate;
  const disabled = readBoolean(value, [`versionControl${pascal}Disabled`]);
  return disabled === undefined ? undefined : !disabled;
}

function readBoolean(
  value: Readonly<Record<string, unknown>> | null,
  keys: readonly string[],
): boolean | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    if (typeof value[key] === 'boolean') return value[key] as boolean;
  }
  return undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
