import { jest } from '@jest/globals';

import type { WorkbookConfig } from '../types';
import { versioningWithDomainSupportManifest } from './version-domain-support-test-utils';
import { createMockCtx, createMockEventBus } from './version-status-workbook-test-utils-context';
import {
  WorkbookImpl,
  createCheckpointManagerMock,
} from './version-status-workbook-test-utils-mocks';

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
    ...(versioning ? { versioning: versioningWithDomainSupportManifest(versioning) } : {}),
  });
}
