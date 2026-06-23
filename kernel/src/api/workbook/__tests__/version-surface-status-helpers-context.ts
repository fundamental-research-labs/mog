import { jest } from '@jest/globals';

export function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    computeBridge: {
      getAllSheetIds: jest.fn(async () => []),
      getAllTablesInSheet: jest.fn(async () => []),
      getFiltersInSheet: jest.fn(async () => []),
      namedRangeCount: jest.fn(async () => 0),
      getAllNamedRangesWire: jest.fn(async () => []),
      getHyperlinks: jest.fn(async () => []),
      getRangeSchemasForSheet: jest.fn(async () => []),
    },
    writeGate: {
      assertWritable: jest.fn(),
    },
    services: {
      undo: {},
    },
    floatingObjectManager: {
      dispose: jest.fn(),
    },
    workbookLinkScope: () => ({
      requestingDocumentId: 'document-1',
      requestingSessionId: 'session-1',
      actor: 'user-1',
      principal: { tags: ['host:trusted'] },
    }),
    ...overrides,
  } as any;
}
