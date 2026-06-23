import { expect, it } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  createMockCtx,
  createWorkbook,
  DOCUMENT_SCOPE,
} from './version-pending-remote-promotion-provider-test-utils';

export function registerPendingRemotePromotionProviderFacadeScenarios(): void {
  it('attaches a provider-backed pending remote promotion service', () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const ctx = createMockCtx();

    createWorkbook({
      ctx,
      versioning: { provider },
    });

    expect(ctx.versioning).toMatchObject({
      provider,
      pendingRemotePromotionService: {
        promotePendingRemoteSegments: expect.any(Function),
      },
      promotePendingRemoteSegments: expect.any(Function),
    });
  });
}
