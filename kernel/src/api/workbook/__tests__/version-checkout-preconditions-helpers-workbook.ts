import { jest } from '@jest/globals';
import type { Workbook, WorkbookStateProvider } from '@mog-sdk/contracts/api';

import { NO_HOST_OPERATION_GATE } from '../../../document/host-operation-gate';
import type { CheckoutSnapshotMaterializer } from '../../../document/version-store/checkout-apply';
import {
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';
import { SHEET_ID, SHEET_NAME } from './version-checkout-preconditions-helpers-constants';
import type { TestVersionStoreProvider } from './version-checkout-preconditions-helpers-types';

type MockEventBus = ReturnType<typeof createMockEventBus>;

const worksheetImplMock = jest.fn().mockImplementation((sheetId: string, ctx: any, meta: any) => {
  const cells = new Map<string, unknown>();
  return {
    _sheetId: sheetId,
    name: meta.name,
    index: meta.index,
    _syncMetadata: jest.fn(),
    dispose: jest.fn(),
    setCell: jest.fn(async (address: string, value: unknown) => {
      cells.set(address, value);
      ctx.eventBus.emit({ type: 'test:cell:set', sheetId, address });
    }),
    getCell: jest.fn(async (address: string) => ({
      address,
      value: cells.has(address) ? cells.get(address) : null,
    })),
  };
});

jest.unstable_mockModule('../../worksheet/worksheet-impl', () => ({
  WorksheetImpl: worksheetImplMock,
}));

const { WorkbookImpl } = await import('../workbook-impl');

export function resetCheckoutPreconditionMocks(): void {
  worksheetImplMock.mockClear();
}

export function createWorkbook(input: {
  readonly provider: TestVersionStoreProvider;
  readonly checkoutSnapshotMaterializer: CheckoutSnapshotMaterializer;
}): Workbook {
  const eventBus = createMockEventBus();
  const wb = new WorkbookImpl({
    ctx: createMockCtx(eventBus),
    eventBus,
    stateProvider: createStateProvider(),
    versioning: withVersionManifest({
      provider: input.provider,
      checkoutSnapshotMaterializer: input.checkoutSnapshotMaterializer,
    }),
  }) as Workbook;
  installVersionDomainDetectorNoopsOnWorkbook(wb);
  return wb;
}

export function failingMaterializer(): CheckoutSnapshotMaterializer {
  return {
    applySnapshot: jest.fn(async () => {
      throw new Error('checkout materialization should not run for rejected preconditions');
    }),
  };
}

export function versioningRuntimeForWorkbook(wb: Workbook): Record<string, unknown> {
  const version = wb.version as unknown as {
    readonly ctx?: { readonly versioning?: unknown };
    readonly versionContext?: { readonly versioning?: unknown };
  };
  const versioning = version.ctx?.versioning ?? version.versionContext?.versioning;
  if (!isMutableRecord(versioning)) throw new Error('expected attached versioning runtime');
  return versioning;
}

export function setSurfaceStatusService(
  wb: Workbook,
  service: {
    readonly readDirtyStatus: () => unknown;
    readonly readActiveCheckoutSession: () => unknown;
  },
): void {
  const runtime = versioningRuntimeForWorkbook(wb);
  runtime.surfaceStatusService = service;
  runtime.versionSurfaceStatusService = service;
}

export function spyOnCheckoutService(runtime: Record<string, unknown>) {
  const checkoutService = runtime.checkoutService;
  if (!isMutableRecord(checkoutService) || typeof checkoutService.checkout !== 'function') {
    throw new Error('expected attached checkout service');
  }
  return jest.spyOn(checkoutService as { checkout: (...args: unknown[]) => unknown }, 'checkout');
}

function createMockEventBus() {
  const allHandlers: Array<(event: unknown) => void> = [];
  return {
    on: jest.fn().mockReturnValue(() => undefined),
    onAll: jest.fn((handler?: unknown) => {
      if (typeof handler === 'function') {
        allHandlers.push(handler as (event: unknown) => void);
      }
      return () => undefined;
    }),
    onMany: jest.fn(),
    emit: jest.fn((event: unknown) => {
      allHandlers.forEach((handler) => handler(event));
    }),
    emitBatch: jest.fn(),
    clear: jest.fn(),
  };
}

function createMockCtx(eventBus: MockEventBus) {
  return {
    clock: {
      now: () => 0,
      dateNow: () => 0,
    },
    eventBus,
    computeBridge: {
      getAllSheetIds: jest.fn(async () => [SHEET_ID]),
      getSheetName: jest.fn(async () => SHEET_NAME),
      isSheetHidden: jest.fn(async () => false),
    },
    mirror: {
      getSheetIds: () => [SHEET_ID],
      getSheetMeta: () => ({ name: SHEET_NAME, hidden: false }),
    },
    writeGate: {
      assertWritable: jest.fn(),
    },
    operationGate: NO_HOST_OPERATION_GATE,
    services: {
      undo: {},
    },
    floatingObjectManager: {
      dispose: jest.fn(),
    },
    workbookLinks: {},
    workbookLinkScope: () => 'all',
    awaitMaterialized: jest.fn(async () => undefined),
    getMaterializationState: jest.fn(() => ({ status: 'ready' })),
    setPendingSelectionCheckpoint: jest.fn(),
    getPendingSelectionCheckpoint: jest.fn(() => null),
    clearPendingSelectionCheckpoint: jest.fn(),
  } as any;
}

function createStateProvider(): WorkbookStateProvider {
  return {
    getActiveSheetId: () => SHEET_ID,
    setActiveSheetId: jest.fn(),
    getActiveCell: () => null,
    getSelectedRanges: () => [],
    getActiveObjectId: () => null,
    getActiveObjectType: () => null,
  };
}

function isMutableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
