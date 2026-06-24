import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { DocumentContext } from '../../../../context';
import { createComputeBridgeSemanticStateReader } from '../../../../document/version-store/semantic-state-reader';
import type { WorkbookVersioningConfig } from '../../types';
import {
  assertMaterializedContextIsUnbound,
  providerRebindIdentity,
  seedMaterializedContextRebindIdentity,
  validateCurrentRebindIdentity,
} from './version-checkout-rebind-identity';
import { checkoutResetOperationContext } from './version-checkout-rebind-operation-context';
import { validatePriorCheckoutRefs } from './version-checkout-rebind-prior-refs';
import {
  deleteAttachedVersionServices,
  resetSemanticMutationCaptureAfterCheckout,
} from './version-checkout-rebind-services';
import { isVersioningRecord } from './version-checkout-rebind-utils';

export { checkoutRebindIdentityDiagnosticDetails } from './version-checkout-rebind-errors';

export function rebindVersioningAfterCheckout(input: {
  readonly versioning: unknown;
  readonly nextContext: DocumentContext;
  readonly operationContext?: VersionOperationContext;
}): WorkbookVersioningConfig {
  if (!isVersioningRecord(input.versioning)) return {};
  const identity = providerRebindIdentity(input.versioning);
  validateCurrentRebindIdentity(input.versioning, identity);
  validatePriorCheckoutRefs(input.versioning);
  assertMaterializedContextIsUnbound(input.nextContext, identity);
  seedMaterializedContextRebindIdentity(input.nextContext, identity);

  const semanticStateReader = createComputeBridgeSemanticStateReader(
    input.nextContext.computeBridge,
  );
  resetSemanticMutationCaptureAfterCheckout(
    input.versioning,
    semanticStateReader,
    checkoutResetOperationContext(input.operationContext, input.versioning),
  );
  const config = {
    ...input.versioning,
    snapshotRootByteSyncPort: {
      encodeDiff: (stateVector: Uint8Array) =>
        input.nextContext.computeBridge.encodeDiff(stateVector),
    },
    semanticStateReader,
  } as Record<string, unknown>;
  deleteAttachedVersionServices(config);
  return config as WorkbookVersioningConfig;
}
