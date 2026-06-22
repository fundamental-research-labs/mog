import type { DocumentContext } from '../../context';
import { createComputeBridgeSemanticStateReader } from '../../document/version-store/semantic-state-reader';
import type { WorkbookVersioningConfig } from './types';

export function rebindVersioningAfterCheckout(input: {
  readonly versioning: unknown;
  readonly nextContext: DocumentContext;
}): WorkbookVersioningConfig {
  if (!isVersioningRecord(input.versioning)) return {};
  const semanticStateReader = createComputeBridgeSemanticStateReader(input.nextContext.computeBridge);
  resetSemanticMutationCaptureAfterCheckout(input.versioning, semanticStateReader);
  const config = {
    ...input.versioning,
    snapshotRootByteSyncPort: {
      encodeDiff: (stateVector: Uint8Array) => input.nextContext.computeBridge.encodeDiff(stateVector),
    },
    semanticStateReader,
  } as Record<string, unknown>;
  deleteAttachedVersionServices(config);
  return config as WorkbookVersioningConfig;
}

function resetSemanticMutationCaptureAfterCheckout(
  versioning: Record<string, unknown>,
  semanticStateReader: ReturnType<typeof createComputeBridgeSemanticStateReader>,
): void {
  const semanticCapture = versioning.semanticMutationCapture;
  if (!isVersioningRecord(semanticCapture)) return;
  const reset = semanticCapture.resetNormalCaptureForCheckout;
  if (typeof reset !== 'function') return;
  reset.call(semanticCapture, { semanticStateReader });
}

function deleteAttachedVersionServices(config: Record<string, unknown>): void {
  delete config.writeService;
  delete config.readService;
  delete config.commitService;
  delete config.publicService;
  delete config.checkoutService;
  delete config.checkoutMaterializationService;
  delete config.mergeService;
  delete config.versionMergeService;
  delete config.diffService;
  delete config.versionDiffService;
  delete config.branchService;
  delete config.branchRefService;
  delete config.refLifecycleService;
}

function isVersioningRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
