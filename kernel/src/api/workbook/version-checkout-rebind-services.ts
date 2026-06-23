import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { VersionSemanticStateReaderPort } from '../../document/version-store/semantic-state-reader';
import { isVersioningRecord } from './version-checkout-rebind-utils';

export function resetSemanticMutationCaptureAfterCheckout(
  versioning: Record<string, unknown>,
  semanticStateReader: VersionSemanticStateReaderPort,
  operationContext: VersionOperationContext | undefined,
): void {
  const semanticCapture = versioning.semanticMutationCapture;
  if (!isVersioningRecord(semanticCapture)) return;
  const reset = semanticCapture.resetNormalCaptureForCheckout;
  if (typeof reset !== 'function') return;
  const resetInput: Record<string, unknown> = { semanticStateReader };
  if (operationContext) resetInput.operationContext = operationContext;
  reset.call(semanticCapture, resetInput);
}

export function deleteAttachedVersionServices(config: Record<string, unknown>): void {
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
