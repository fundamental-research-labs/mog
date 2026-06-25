import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

import type {
  CapabilityArea,
  VersionSurfaceCapabilityAvailability,
  VersionSurfaceCapabilityBlock,
  VersionSurfaceCapabilityBlocks,
} from './version-surface-status-derivation-types';
import { isRecord } from './version-surface-status-derivation-utils';

export function deriveProviderCapabilityBlocks(
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
  const writeRefs =
    !provider.readOnlyHistory && providerCapability(provider, 'writes', 'updateRefs');

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
  if (availability.revert && (!readGraph || !writeCommits)) {
    blocks['version:revert'] = providerBlock(
      'version.surfaceStatus.revertUnavailable',
      readGraph
        ? 'The attached version storage provider is read-only for revert writes.'
        : 'Version revert requires provider graph reads.',
      !readGraph,
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

function providerBlock(
  code: VersionDiagnostic['code'],
  reason: string,
  retryable: boolean,
): VersionSurfaceCapabilityBlock {
  return { dependency: 'storage', reason, retryable, code };
}
