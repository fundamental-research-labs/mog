import { jest } from '@jest/globals';

import type { WorkbookConfig } from '../types';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  createCheckpointManagerMock,
  createMockCtx,
  createMockEventBus,
} from './version-diff-provider-test-utils-mocks';

const { WorkbookImpl } = await import('../workbook-impl');

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

  const versioning = overrides?.versioning as Record<string, unknown> | undefined;
  return new WorkbookImpl({
    ctx: createMockCtx(),
    eventBus: createMockEventBus(),
    ...overrides,
    ...(versioning ? { versioning: withVersionManifest(versioning) } : {}),
  });
}

export type DiffProviderTestWorkbook = ReturnType<typeof createWorkbook>;
