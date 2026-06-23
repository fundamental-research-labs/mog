import { jest } from '@jest/globals';

import type { WorkbookConfig } from '../types';
import {
  PROMOTION_POLICY,
  PROVENANCE_TRUTH_SERVICE,
} from './version-pending-remote-promotion-provider-helpers-constants';
import {
  createCheckpointManagerMock,
  WorkbookImpl,
} from './version-pending-remote-promotion-provider-helpers-jest-setup';

export function createMockEventBus() {
  return {
    on: jest.fn().mockReturnValue(() => undefined),
    onAll: jest.fn().mockReturnValue(() => undefined),
    onMany: jest.fn(),
    emit: jest.fn(),
    emitBatch: jest.fn(),
    clear: jest.fn(),
  };
}

export function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    computeBridge: {},
    writeGate: {
      assertWritable: jest.fn(),
    },
    services: {
      undo: {},
    },
    floatingObjectManager: {
      dispose: jest.fn(),
    },
    ...overrides,
  } as any;
}

export function createPromotionAuthorizedCtx(overrides: Record<string, unknown> = {}) {
  return createMockCtx({ policySnapshot: PROMOTION_POLICY, ...overrides });
}

export function createWorkbook(overrides?: Partial<WorkbookConfig>) {
  createCheckpointManagerMock.mockReturnValue({
    create: jest.fn(),
    createSync: jest.fn(),
    restore: jest.fn(),
    list: jest.fn().mockReturnValue([]),
    get: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
  });

  return new WorkbookImpl({
    ctx: createMockCtx(),
    eventBus: createMockEventBus(),
    ...overrides,
  });
}

export function createPromotionAuthorizedWorkbook(
  versioning: NonNullable<WorkbookConfig['versioning']>,
) {
  return createWorkbook({
    ctx: createPromotionAuthorizedCtx(),
    versioning: {
      provenanceTruthService: PROVENANCE_TRUTH_SERVICE,
      ...versioning,
    },
  });
}
