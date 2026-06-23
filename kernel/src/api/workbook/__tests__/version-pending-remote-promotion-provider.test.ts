import { jest } from '@jest/globals';

import {
  registerPendingRemotePromotionProviderBlockingScenarios,
  registerPendingRemotePromotionProviderBoundaryScenarios,
  registerPendingRemotePromotionProviderFacadeScenarios,
  registerPendingRemotePromotionProviderPromotionScenarios,
  registerPendingRemotePromotionProviderSourceBatchScenarios,
} from './version-pending-remote-promotion-provider-scenarios';

describe('WorkbookVersion pending remote promotion provider facade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  registerPendingRemotePromotionProviderFacadeScenarios();
  registerPendingRemotePromotionProviderPromotionScenarios();
  registerPendingRemotePromotionProviderBlockingScenarios();
  registerPendingRemotePromotionProviderSourceBatchScenarios();
  registerPendingRemotePromotionProviderBoundaryScenarios();
});
