import { beforeEach, describe, jest } from '@jest/globals';

import {
  registerProviderWriteActivityPreconditionScenario,
  registerProviderWritePendingRemotePromotionPreconditionScenario,
  registerProviderWritePendingRemoteSegmentPreconditionScenario,
} from './version-checkout-provider-write-preconditions-scenarios';

describe('WorkbookVersion checkout provider write preconditions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  registerProviderWritePendingRemoteSegmentPreconditionScenario();
  registerProviderWriteActivityPreconditionScenario();
  registerProviderWritePendingRemotePromotionPreconditionScenario();
});
