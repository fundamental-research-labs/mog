import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

import type {
  VersionSurfaceCapabilityAvailability,
  VersionSurfaceCapabilityBlock,
  VersionSurfaceCapabilityBlocks,
} from './version-surface-status-derivation-types';
import { isRecord } from './version-surface-status-derivation-utils';

export function deriveSemanticCaptureCapabilityBlocks(
  services: unknown,
  availability: VersionSurfaceCapabilityAvailability,
): VersionSurfaceCapabilityBlocks {
  if (!availability.commit || !requiresProviderBackedNormalCommitCapture(services)) {
    return {};
  }
  if (hasSemanticStateReader(services)) return {};
  return {
    'version:commit': semanticCaptureBlock(
      'version.surfaceStatus.semanticStateReaderUnavailable',
      'Normal provider-backed commits require a Rust semantic state reader.',
    ),
  };
}

function requiresProviderBackedNormalCommitCapture(services: unknown): boolean {
  return (
    hasProvider(services) && hasSnapshotRootByteSyncPort(services) && hasSemanticCapture(services)
  );
}

function hasProvider(services: unknown): boolean {
  return isRecord(services) && isRecord(services.provider);
}

function hasSnapshotRootByteSyncPort(services: unknown): boolean {
  return (
    isRecord(services) &&
    isRecord(services.snapshotRootByteSyncPort) &&
    typeof services.snapshotRootByteSyncPort.encodeDiff === 'function'
  );
}

function hasSemanticCapture(services: unknown): boolean {
  return (
    isRecord(services) &&
    isRecord(services.semanticMutationCapture) &&
    typeof services.semanticMutationCapture.captureNormalCommit === 'function'
  );
}

function hasSemanticStateReader(services: unknown): boolean {
  return (
    isRecord(services) &&
    isRecord(services.semanticStateReader) &&
    typeof services.semanticStateReader.readCurrentSemanticState === 'function' &&
    typeof services.semanticStateReader.diffSemanticStates === 'function'
  );
}

function semanticCaptureBlock(
  code: VersionDiagnostic['code'],
  reason: string,
): VersionSurfaceCapabilityBlock {
  return { dependency: 'storage', reason, retryable: true, code };
}
